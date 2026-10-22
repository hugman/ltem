//! Where LTEM tables are in comrak's AST, and what replaces them.
//!
//! comrak parses the document first, with its table extension on, so that its own
//! rules decide the block structure. A table can only be made of paragraph lines (spec
//! 2.3), so the candidates are runs of sibling blocks that comrak made from such lines:
//! paragraphs, GFM tables and setext headings, on consecutive lines. The lines of a run,
//! with their container prefixes removed, go to the LTEM core, which finds the tables.
//! Where the LTEM reading differs from comrak's, the run's nodes are replaced:
//!
//! - an LTEM table becomes a `Raw` node holding its HTML, unless comrak read exactly the
//!   same lines as a GFM table that uses no LTEM notation; then its own node stays.
//! - text between tables keeps comrak's nodes where it is a whole block, or a part of a
//!   paragraph that can be cut at a line break. Otherwise, for example where a line that
//!   begins a block ends a table, the text is parsed again.
//!
//! Cell text, and text parsed again, is parsed by comrak in the context of the whole
//! document (see [`crate::render`]), so that it sees the document's link reference
//! definitions.

use std::collections::HashMap;
use std::ops::Range;

use comrak::nodes::{Ast, AstNode, LineColumn, Node, NodeValue, Sourcepos, TableAlignment};
use comrak::{Arena, Options};
use ltem::{Align, ParseResult};

use crate::lines::Lines;
use crate::prefix::{item_content_indent, scan_prefixes, Container, Link, Prefix};
use crate::render::{parse_chunks, Chunk, TableHtml};

/// Replace what LTEM reads differently in the AST of `md` that comrak parsed.
pub(crate) fn transform<'a>(arena: &'a Arena<'a>, root: Node<'a>, md: &str, options: &Options) {
    let lines = Lines::new(md);
    let doc = Document {
        md,
        lines: &lines,
        chars: options.parse.sourcepos_chars,
    };
    let mut plans = Vec::new();
    let mut chunks = Chunks::default();
    let mut stack = vec![(root, Vec::new())];
    while let Some((node, chain)) = stack.pop() {
        let children: Vec<Node<'a>> = node.children().collect();
        for &child in &children {
            if let Some(chain) = doc.container_chain(child, &chain) {
                stack.push((child, chain));
            }
        }
        plan_children(&doc, node, &chain, &children, &mut plans, &mut chunks);
    }
    if plans.is_empty() {
        return;
    }
    let outputs = parse_chunks(arena, md, root, &lines, &chunks.list, options);
    let cells: HashMap<&str, &str> = chunks
        .cells
        .iter()
        .filter_map(|(text, &i)| match &outputs[i] {
            Output::Cell(html) => Some((text.as_str(), html.as_str())),
            Output::Text(..) => None,
        })
        .collect();
    for plan in plans {
        apply(arena, &doc, plan, &outputs, &cells, options);
    }
}

/// The source text and how comrak counts columns in it.
pub(crate) struct Document<'d> {
    md: &'d str,
    lines: &'d Lines<'d>,
    /// Columns count characters instead of bytes (`parse.sourcepos_chars`).
    chars: bool,
}

impl Document<'_> {
    /// The byte offset of a 1-based source position.
    fn offset(&self, at: LineColumn) -> usize {
        let line = at.line.saturating_sub(1).min(self.lines.count() - 1);
        let text = self.lines.text(line);
        let column = at.column.saturating_sub(1);
        let byte = if self.chars {
            text.char_indices()
                .nth(column)
                .map_or(text.len(), |(i, _)| i)
        } else {
            column.min(text.len())
        };
        self.lines.start(line) + byte
    }

    /// The 1-based source position of a byte offset on line `line` (0-based).
    pub(crate) fn position(&self, line: usize, offset: usize) -> LineColumn {
        let text = self.lines.text(line);
        let mut byte = offset
            .saturating_sub(self.lines.start(line))
            .min(text.len());
        let column = if self.chars {
            while !text.is_char_boundary(byte) {
                byte -= 1;
            }
            text[..byte].chars().count()
        } else {
            byte
        };
        LineColumn {
            line: line + 1,
            column: column + 1,
        }
    }

    /// The position of the last character before byte `end` on line `line`, or of
    /// `start` if there is none. Byte columns point at the character's last byte, as
    /// in cmark.
    pub(crate) fn last_position(&self, line: usize, start: usize, end: usize) -> LineColumn {
        if end <= start {
            return self.position(line, start);
        }
        let mut position = self.position(line, end - 1);
        if !self.chars {
            position.column = end - self.lines.start(line);
        }
        position
    }

    /// The chain of block quotes and list items of a child container, or `None` if
    /// it is not a container whose blocks may hold tables.
    fn container_chain(
        &self,
        node: Node<'_>,
        chain: &[(Container, usize)],
    ) -> Option<Vec<(Container, usize)>> {
        let first = node.data().sourcepos.start.line.saturating_sub(1);
        let container = match &node.data().value {
            NodeValue::List(_) => return Some(chain.to_vec()),
            NodeValue::BlockQuote => Container::BlockQuote,
            NodeValue::Alert(alert) if !alert.multiline => Container::BlockQuote,
            NodeValue::Item(list) => Container::Item(list.marker_offset + list.padding),
            NodeValue::TaskItem(_) => {
                let links = links(chain, first);
                Container::Item(item_content_indent(self.lines.text(first), &links)?)
            }
            _ => return None,
        };
        let mut chain = chain.to_vec();
        chain.push((container, first));
        Some(chain)
    }
}

/// The containers of a chain as the prefix scanner sees them on line `line`.
fn links(chain: &[(Container, usize)], line: usize) -> Vec<Link> {
    chain
        .iter()
        .map(|&(container, first)| Link {
            container,
            opens: first == line,
        })
        .collect()
}

// -- runs of blocks ------------------------------------------------------------------------

/// What a block is, for finding tables.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Paragraph,
    Table,
    SetextHeading,
}

struct Block<'a> {
    node: Node<'a>,
    kind: Kind,
    /// First and last line (0-based).
    first: usize,
    last: usize,
    /// Byte offset where the block starts.
    start: usize,
}

fn block<'a>(doc: &Document<'_>, node: Node<'a>) -> Option<Block<'a>> {
    let ast = node.data();
    let kind = match &ast.value {
        NodeValue::Paragraph => Kind::Paragraph,
        NodeValue::Table(_) => Kind::Table,
        NodeValue::Heading(h) if h.setext => Kind::SetextHeading,
        _ => return None,
    };
    let Sourcepos { start, end } = ast.sourcepos;
    (start.line > 0 && end.line >= start.line).then(|| Block {
        node,
        kind,
        first: start.line - 1,
        last: end.line - 1,
        start: doc.offset(start),
    })
}

/// A line of a run, with its container prefixes removed.
#[derive(Clone)]
pub(crate) struct Stripped {
    /// The line as the LTEM core reads it: its indentation inside the containers, as
    /// spaces, then the rest of the line from its first other character.
    pub(crate) text: String,
    /// The document line (0-based).
    pub(crate) line: usize,
    /// Byte offset in the document of the line's first character that is not a space
    /// or tab (byte `indent` of `text`).
    pub(crate) doc: usize,
    indent: usize,
    /// A lazy continuation line, which cannot be part of a table.
    lazy: bool,
}

impl Stripped {
    fn new(text: &str, line: usize, line_start: usize, prefix: Prefix, lazy: bool) -> Stripped {
        Stripped {
            text: format!("{}{}", " ".repeat(prefix.indent), &text[prefix.first..]),
            line,
            doc: line_start + prefix.first,
            indent: prefix.indent,
            lazy,
        }
    }

    /// The document offset of byte `col` of `text`.
    pub(crate) fn offset(&self, col: usize) -> usize {
        self.doc + col.saturating_sub(self.indent)
    }
}

/// What replaces a run of blocks.
struct Plan<'a> {
    run: Vec<Node<'a>>,
    items: Vec<Item<'a>>,
}

enum Item<'a> {
    /// A block of comrak's that stays.
    Keep(Node<'a>),
    /// An LTEM table.
    Table(TableHtml),
    /// Lines `from..=to` of a paragraph, cut out of it.
    Slice {
        paragraph: Node<'a>,
        from: usize,
        to: usize,
    },
    /// Text parsed again, as chunk `chunk`, from these lines.
    Reparse { chunk: usize, lines: Vec<Stripped> },
}

/// The texts to be parsed by comrak in the document's context: lines of cells and text
/// that is parsed again.
#[derive(Default)]
struct Chunks {
    list: Vec<Chunk>,
    cells: HashMap<String, usize>,
}

impl Chunks {
    fn cell(&mut self, text: &str) {
        if !text.is_empty() && !self.cells.contains_key(text) {
            self.cells.insert(text.to_string(), self.list.len());
            self.list.push(Chunk::Cell(text.to_string()));
        }
    }
}

fn plan_children<'a>(
    doc: &Document<'_>,
    parent: Node<'a>,
    chain: &[(Container, usize)],
    children: &[Node<'a>],
    plans: &mut Vec<Plan<'a>>,
    chunks: &mut Chunks,
) {
    // A list holds items, which are containers of their own.
    if !matches!(
        parent.data().value,
        NodeValue::Document
            | NodeValue::BlockQuote
            | NodeValue::Alert(_)
            | NodeValue::Item(_)
            | NodeValue::TaskItem(_)
    ) {
        return;
    }
    let blocks: Vec<Option<Block<'a>>> = children.iter().map(|&n| block(doc, n)).collect();
    let mut i = 0;
    while i < blocks.len() {
        if blocks[i].is_none() {
            i += 1;
            continue;
        }
        let mut j = i + 1;
        while j < blocks.len()
            && matches!((&blocks[j], &blocks[j - 1]), (Some(b), Some(a)) if b.first == a.last + 1)
        {
            j += 1;
        }
        let run: Vec<&Block<'a>> = blocks[i..j].iter().flatten().collect();
        if let Some(plan) = plan_run(doc, parent, chain, &run, chunks) {
            plans.push(plan);
        }
        i = j;
    }
}

fn plan_run<'a>(
    doc: &Document<'_>,
    parent: Node<'a>,
    chain: &[(Container, usize)],
    run: &[&Block<'a>],
    chunks: &mut Chunks,
) -> Option<Plan<'a>> {
    let first = run[0].first;
    let last = run[run.len() - 1].last;
    let has_host_table = run.iter().any(|b| b.kind == Kind::Table);
    // Every table needs a pipe, in LTEM as in comrak.
    let source = &doc.md[doc.lines.start(first)..doc.lines.next_start(last)];
    if !has_host_table && !source.contains('|') {
        return None;
    }
    let lines = strip(doc, parent, chain, run)?;
    let tables = find_tables(&lines);
    if tables.is_empty() && !has_host_table {
        return None;
    }

    let mut items = Vec::new();
    let mut cursor = 0;
    let text = |items: &mut Vec<Item<'a>>, range: Range<usize>, chunks: &mut Chunks| {
        if let Some(blocks) = whole_blocks(run, first, &range) {
            items.extend(blocks.into_iter().map(Item::Keep));
        } else if let Some(item) = slice(run, first, &range, &lines) {
            items.push(item);
        } else {
            let text: Vec<&str> = lines[range.clone()]
                .iter()
                .map(|l| l.text.as_str())
                .collect();
            chunks.list.push(Chunk::Text(text.join("\n")));
            items.push(Item::Reparse {
                chunk: chunks.list.len() - 1,
                lines: lines[range].to_vec(),
            });
        }
    };
    for (range, result) in tables {
        if cursor < range.start {
            text(&mut items, cursor..range.start, chunks);
        }
        cursor = range.end;
        match native_table(run, first, &range, &result, &lines) {
            Some(node) => items.push(Item::Keep(node)),
            None => {
                let table = result.table.as_ref().expect("only tables are found");
                for cell in &table.cells {
                    for line in cell.text.split('\n') {
                        chunks.cell(line);
                    }
                }
                items.push(Item::Table(TableHtml::new(&range, *result, &lines)));
            }
        }
    }
    if cursor < lines.len() {
        text(&mut items, cursor..lines.len(), chunks);
    }
    Some(Plan {
        run: run.iter().map(|b| b.node).collect(),
        items,
    })
}

/// The lines of a run without their container prefixes, or `None` if the prefixes do
/// not agree with where comrak says the blocks start.
fn strip(
    doc: &Document<'_>,
    parent: Node<'_>,
    chain: &[(Container, usize)],
    run: &[&Block<'_>],
) -> Option<Vec<Stripped>> {
    let first = run[0].first;
    let last = run[run.len() - 1].last;
    let mut lines = Vec::with_capacity(last - first + 1);
    for line in first..=last {
        let text = doc.lines.text(line);
        let prefix = scan_prefixes(text, &links(chain, line))?;
        let lazy = prefix.matched < chain.len();
        lines.push(Stripped::new(
            text,
            line,
            doc.lines.start(line),
            prefix,
            lazy,
        ));
    }
    let task_item = matches!(parent.data().value, NodeValue::TaskItem(_));
    for block in run {
        let line = &mut lines[block.first - first];
        if line.lazy {
            return None;
        }
        if line.doc == block.start {
            continue;
        }
        // comrak takes the task list marker out of the item's first paragraph.
        let opens_item = task_item && chain.last().is_some_and(|&(_, l)| l == block.first);
        if !(opens_item && line.doc < block.start && is_task_marker(&doc.md[line.doc..block.start]))
        {
            return None;
        }
        let end = doc.lines.start(block.first) + doc.lines.text(block.first).len();
        line.text = doc.md[block.start..end].to_string();
        line.doc = block.start;
        line.indent = 0;
    }
    Some(lines)
}

/// `[ ]`, `[x]` or a similar one-character task marker, followed by spaces or tabs.
fn is_task_marker(text: &str) -> bool {
    let mut chars = text.chars();
    chars.next() == Some('[')
        && chars.next().is_some()
        && chars.next() == Some(']')
        && chars.clone().next().is_some()
        && chars.all(|c| c == ' ' || c == '\t')
}

/// The LTEM tables of a run's lines, read by the core as `ltem::find_tables` reads a
/// block, table after table. A lazy line cannot be part of a table, and neither can a
/// line that ends a table body (it begins a block or is indented as code), so the lines
/// are read in pieces that end before such a line; a line that ends a body starts the
/// next piece, where it still counts as the line above a header row (spec 2.3). Each
/// piece holds at most one table, whose body runs to the piece's end, so the core reads
/// every line once.
fn find_tables(lines: &[Stripped]) -> Vec<(Range<usize>, Box<ParseResult>)> {
    let mut tables = Vec::new();
    let mut start = 0;
    while start < lines.len() {
        if lines[start].lazy {
            start += 1;
            continue;
        }
        let mut end = start + 1;
        while end < lines.len() && !lines[end].lazy && !ltem::ends_table_body(&lines[end].text) {
            end += 1;
        }
        let mut offset = start;
        while offset < end {
            let piece: Vec<&str> = lines[offset..end].iter().map(|l| l.text.as_str()).collect();
            let result = ltem::parse_table(&piece, offset);
            if result.table.is_none() {
                break;
            }
            offset = result.end;
            tables.push((result.start..result.end, Box::new(result)));
        }
        start = end;
    }
    tables
}

/// The blocks that make up text lines `range` (run coordinates) exactly, if they are
/// not GFM tables (which LTEM did not read as tables).
fn whole_blocks<'a>(
    run: &[&Block<'a>],
    first: usize,
    range: &Range<usize>,
) -> Option<Vec<Node<'a>>> {
    let inside: Vec<&&Block<'a>> = run
        .iter()
        .filter(|b| b.last - first >= range.start && b.first - first < range.end)
        .collect();
    let exact = inside.first()?.first - first == range.start
        && inside.last()?.last - first + 1 == range.end
        && inside.iter().all(|b| b.kind != Kind::Table);
    exact.then(|| inside.iter().map(|b| b.node).collect())
}

/// Text lines `range` (run coordinates) as a cut of the one paragraph that holds them,
/// if inline markup does not run across the cuts.
fn slice<'a>(
    run: &[&Block<'a>],
    first: usize,
    range: &Range<usize>,
    lines: &[Stripped],
) -> Option<Item<'a>> {
    let (from, to) = (first + range.start, first + range.end - 1);
    let block = run.iter().find(|b| b.first <= from && to <= b.last)?;
    if block.kind != Kind::Paragraph {
        return None;
    }
    // A line that ends a table by beginning a block is the start of that block.
    let text = &lines[range.start].text;
    if from > block.first && (ltem::starts_block(text) || ltem::indentation(text) >= 4) {
        return None;
    }
    let cuts_ok = (from == block.first || line_break(block.node, from - 1).is_some())
        && (to == block.last || line_break(block.node, to).is_some());
    cuts_ok.then_some(Item::Slice {
        paragraph: block.node,
        from,
        to,
    })
}

/// The soft or hard line break that ends line `line` (0-based) of a paragraph, as a
/// child of the paragraph: no inline markup is open there.
fn line_break<'a>(paragraph: Node<'a>, line: usize) -> Option<Node<'a>> {
    paragraph.children().find(|child| {
        let ast = child.data();
        matches!(ast.value, NodeValue::SoftBreak | NodeValue::LineBreak)
            && ast.sourcepos.start.line == line + 1
    })
}

/// comrak's node for an LTEM table, if it read exactly the same lines as a GFM table
/// without LTEM notation: one header row, no spans, and cell text that is the cell's
/// source with `\|` read as `|`.
fn native_table<'a>(
    run: &[&Block<'a>],
    first: usize,
    range: &Range<usize>,
    result: &ParseResult,
    lines: &[Stripped],
) -> Option<Node<'a>> {
    let block = run.iter().find(|b| {
        b.kind == Kind::Table && b.first - first == range.start && b.last - first + 1 == range.end
    })?;
    let table = result.table.as_ref()?;
    let same_align = match &block.node.data().value {
        NodeValue::Table(t) => {
            t.alignments.len() == table.align.len()
                && t.alignments.iter().zip(&table.align).all(|(h, a)| {
                    matches!(
                        (h, a),
                        (TableAlignment::None, None)
                            | (TableAlignment::Left, Some(Align::Left))
                            | (TableAlignment::Center, Some(Align::Center))
                            | (TableAlignment::Right, Some(Align::Right))
                    )
                })
        }
        _ => false,
    };
    let plain_cells = table
        .cells
        .iter()
        .zip(&result.sources)
        .all(|(cell, source)| {
            let raw = &lines[source.line].text[source.start..source.end];
            cell.rowspan == 1 && cell.colspan == 1 && cell.text == raw.replace("\\|", "|")
        });
    (table.header_rows == 1 && same_align && plain_cells).then_some(block.node)
}

// -- applying a plan ---------------------------------------------------------------------------

/// What the chunks became.
pub(crate) enum Output<'a> {
    /// The HTML of a line of cell text.
    Cell(String),
    /// The blocks of text parsed again, and the line of the augmented source where the
    /// chunk starts.
    Text(Vec<Node<'a>>, usize),
}

fn apply<'a>(
    arena: &'a Arena<'a>,
    doc: &Document<'_>,
    plan: Plan<'a>,
    outputs: &[Output<'a>],
    cells: &HashMap<&str, &str>,
    options: &Options,
) {
    let cell = |text: &str| {
        cells
            .get(text)
            .map_or_else(String::new, |html| html.to_string())
    };
    let mut nodes: Vec<Node<'a>> = Vec::new();
    for item in plan.items {
        match item {
            Item::Keep(node) => nodes.push(node),
            Item::Table(table) => {
                let mut html = table.render(&cell, options.render.sourcepos.then_some(doc));
                // Line feeds in the table's HTML only come between tags.
                if options.render.compact_html {
                    html.retain(|c| c != '\n');
                }
                let raw = Ast::new_with_sourcepos(NodeValue::Raw(html), table.sourcepos(doc));
                nodes.push(arena.alloc(AstNode::from(raw)));
            }
            Item::Slice {
                paragraph,
                from,
                to,
            } => {
                let start = (from > paragraph.data().sourcepos.start.line - 1)
                    .then(|| line_break(paragraph, from - 1))
                    .flatten();
                let end = (to < paragraph.data().sourcepos.end.line - 1)
                    .then(|| line_break(paragraph, to))
                    .flatten();
                let children: Vec<Node<'a>> = paragraph.children().collect();
                let first = start.map_or(0, |s| position(&children, s) + 1);
                let last = end.map_or(children.len(), |e| position(&children, e));
                let span = Sourcepos {
                    start: children
                        .get(first)
                        .map_or(paragraph.data().sourcepos.start, |c| {
                            c.data().sourcepos.start
                        }),
                    end: children[..last]
                        .last()
                        .map_or(paragraph.data().sourcepos.end, |c| c.data().sourcepos.end),
                };
                let new = arena.alloc(AstNode::from(Ast::new_with_sourcepos(
                    NodeValue::Paragraph,
                    span,
                )));
                for &child in &children[first..last] {
                    new.append(child);
                }
                nodes.push(new);
            }
            Item::Reparse { chunk, lines } => {
                if let Output::Text(blocks, start) = &outputs[chunk] {
                    for &block in blocks {
                        remap(doc, block, *start, &lines);
                        nodes.push(block);
                    }
                }
            }
        }
    }
    let Some(&last) = plan.run.last() else {
        return;
    };
    let parent = last.parent().expect("a block has a parent");
    let anchor = last.next_sibling();
    for node in &plan.run {
        node.detach();
    }
    for node in nodes {
        match anchor {
            Some(anchor) => anchor.insert_before(node),
            None => parent.append(node),
        }
    }
}

/// The index of `node` among `nodes`.
fn position<'a>(nodes: &[Node<'a>], node: Node<'a>) -> usize {
    nodes
        .iter()
        .position(|n| n.same_node(node))
        .unwrap_or(nodes.len())
}

/// Move the source positions of text parsed again (a chunk that starts at line
/// `start`, 0-based, of the source it was parsed in) to where its lines are in the
/// document.
fn remap(doc: &Document<'_>, node: Node<'_>, start: usize, lines: &[Stripped]) {
    let map = |at: LineColumn| -> LineColumn {
        if at.line == 0 || lines.is_empty() {
            return at;
        }
        let line = &lines[(at.line - 1).saturating_sub(start).min(lines.len() - 1)];
        let column = at.column.saturating_sub(1);
        let byte = if doc.chars {
            line.text
                .char_indices()
                .nth(column)
                .map_or(line.text.len(), |(i, _)| i)
        } else {
            column.min(line.text.len())
        };
        doc.position(line.line, line.offset(byte))
    };
    for n in node.descendants() {
        let mut ast = n.data_mut();
        let Sourcepos { start, end } = ast.sourcepos;
        ast.sourcepos = Sourcepos {
            start: map(start),
            end: map(end),
        };
    }
}
