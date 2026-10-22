//! Where LTEM tables are in pulldown-cmark's block structure, and what replaces them.
//!
//! pulldown-cmark parses the document first, with GFM tables on, so that its own rules
//! decide the block structure: fenced and indented code, HTML blocks, block quotes,
//! lists and so on. A table can only be made of paragraph lines (spec 2.3), so the
//! candidates are runs of sibling blocks that pulldown-cmark made from such lines:
//! paragraphs (also the tight ones of tight lists, which have no paragraph tags), GFM
//! tables and setext headings, on consecutive lines. The lines of a run, with their
//! container prefixes removed, go to the LTEM core, which finds the tables. Where the
//! LTEM reading differs from pulldown-cmark's, the run's events are replaced:
//!
//! - an LTEM table becomes one HTML block, unless pulldown-cmark read exactly the same
//!   lines as a GFM table that uses no LTEM notation; then its own events stay.
//! - text between tables keeps pulldown-cmark's events where it is a whole block, or a
//!   part of a paragraph that can be cut at line ends. Otherwise, for example where a
//!   line that begins a block ends a table, the text is parsed again on its own.

use std::collections::HashMap;
use std::ops::Range;

use ltem::{Align, ParseResult};
use pulldown_cmark::{Alignment, CowStr, Event, Options, Parser, RefDefs, Tag, TagEnd};

use crate::lines::Lines;
use crate::render::{cell_inline, fragment_options, resolver, table_html};
use crate::scan::{list_item_indent, scan_prefixes, Container, Link, Prefix};
use crate::TableBlock;

/// An event and its range in the document.
pub(crate) type Spanned<'a> = (Event<'a>, Range<usize>);

/// The events of a document with LTEM tables in place, and the tables.
pub(crate) struct Analysis<'a> {
    pub(crate) events: Vec<Spanned<'a>>,
    pub(crate) tables: Vec<TableBlock>,
}

/// Parse `text` with pulldown-cmark and replace what LTEM reads differently.
pub(crate) fn analyze(text: &str, options: Options) -> Analysis<'_> {
    let mut host = Parser::new_ext(text, options | Options::ENABLE_TABLES).into_offset_iter();
    let events: Vec<Spanned<'_>> = host.by_ref().collect();
    let lines = Lines::new(text);
    let nodes = Walker::new(&events, &lines).walk();
    let mut planner = Planner {
        text,
        events: &events,
        lines: &lines,
        nodes: &nodes,
        options,
        refdefs: host.reference_definitions(),
        replacements: Vec::new(),
        tables: Vec::new(),
    };
    for id in 0..nodes.len() {
        planner.plan_node(id);
    }
    let Planner {
        replacements,
        mut tables,
        ..
    } = planner;
    tables.sort_by_key(|t| t.range.start);
    Analysis {
        events: splice(events, replacements),
        tables,
    }
}

// -- the block structure ---------------------------------------------------------------

/// A container of pulldown-cmark's block structure, or the document.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NodeKind {
    Root,
    BlockQuote,
    List,
    /// A list item and the content indentation of its lines.
    Item(usize),
    /// A footnote definition or a part of a definition list: tables in them are left
    /// to pulldown-cmark.
    Unsupported,
}

struct Node {
    kind: NodeKind,
    first_line: usize,
    /// The block quotes and list items from the outermost one to this node: the
    /// containers whose prefixes the lines of its blocks carry.
    chain: Vec<usize>,
    /// Whether LTEM tables are looked for in this node: it and its ancestors are
    /// supported containers, and their prefixes could be read.
    supported: bool,
    /// For a list item, its list.
    list: Option<usize>,
    /// For a list, whether it is tight, once a paragraph in it tells.
    tight: Option<bool>,
    /// The source of the node.
    range: Range<usize>,
    children: Vec<Block>,
}

/// What a block is, for finding tables.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Paragraph,
    /// The text of an item in a tight list, which has no paragraph tags.
    TightParagraph,
    Table,
    SetextHeading,
    Other,
}

impl Kind {
    /// Blocks made of paragraph lines, which may hold or be part of an LTEM table.
    fn is_candidate(self) -> bool {
        self != Kind::Other
    }
}

struct Block {
    kind: Kind,
    /// Indices of the block's events (from its start event to its end event).
    events: Range<usize>,
    /// First and last line.
    first: usize,
    last: usize,
    /// Byte offset of the block's content on its first line.
    start: usize,
    /// For a GFM table, the alignment of its columns.
    align: Vec<Alignment>,
}

enum Frame {
    Node(usize),
    /// A leaf block, from its start event.
    Leaf(Kind, usize),
    /// An event nested in a leaf block.
    Nested,
    /// An inline tag directly in a container, inside a tight paragraph.
    TightInline,
}

/// The inline events directly in a container (a tight paragraph) seen so far.
struct TightRun {
    node: usize,
    first_event: usize,
    /// Byte offset of the first event that is not a task list marker.
    content: Option<usize>,
    end: usize,
}

struct Walker<'e, 'a> {
    events: &'e [Spanned<'a>],
    lines: &'e Lines<'e>,
    nodes: Vec<Node>,
    stack: Vec<Frame>,
    tight: Option<TightRun>,
}

fn is_inline_tag(tag: &Tag<'_>) -> bool {
    matches!(
        tag,
        Tag::Emphasis
            | Tag::Strong
            | Tag::Strikethrough
            | Tag::Superscript
            | Tag::Subscript
            | Tag::Link { .. }
            | Tag::Image { .. }
    )
}

impl<'e, 'a> Walker<'e, 'a> {
    fn new(events: &'e [Spanned<'a>], lines: &'e Lines<'e>) -> Walker<'e, 'a> {
        let root = Node {
            kind: NodeKind::Root,
            first_line: 0,
            chain: Vec::new(),
            supported: true,
            list: None,
            tight: None,
            range: 0..usize::MAX,
            children: Vec::new(),
        };
        Walker {
            events,
            lines,
            nodes: vec![root],
            stack: Vec::new(),
            tight: None,
        }
    }

    fn walk(mut self) -> Vec<Node> {
        for (i, (event, range)) in self.events.iter().enumerate() {
            let in_leaf = matches!(self.stack.last(), Some(Frame::Leaf(..) | Frame::Nested));
            match event {
                Event::Start(_) if in_leaf => self.stack.push(Frame::Nested),
                Event::Start(tag) if is_inline_tag(tag) => {
                    self.tight_event(i, range);
                    self.stack.push(Frame::TightInline);
                }
                Event::Start(tag) => {
                    self.close_tight(i);
                    let frame = match tag {
                        Tag::Paragraph => Frame::Leaf(Kind::Paragraph, i),
                        Tag::Heading { .. } => Frame::Leaf(Kind::SetextHeading, i),
                        Tag::Table(_) => Frame::Leaf(Kind::Table, i),
                        Tag::BlockQuote(_) => self.open(NodeKind::BlockQuote, range),
                        Tag::List(_) => self.open(NodeKind::List, range),
                        Tag::Item => self.open(NodeKind::Item(0), range),
                        Tag::FootnoteDefinition(_)
                        | Tag::DefinitionList
                        | Tag::DefinitionListTitle
                        | Tag::DefinitionListDefinition => self.open(NodeKind::Unsupported, range),
                        _ => Frame::Leaf(Kind::Other, i),
                    };
                    self.stack.push(frame);
                }
                Event::End(_) => {
                    if matches!(self.stack.last(), Some(Frame::Node(_))) {
                        self.close_tight(i);
                    }
                    match self.stack.pop() {
                        Some(Frame::Leaf(kind, first)) => self.add_block(kind, first..i + 1),
                        Some(Frame::TightInline) => self.tight_event(i, range),
                        Some(Frame::Node(_) | Frame::Nested) | None => {}
                    }
                }
                _ if in_leaf => {}
                Event::Rule => {
                    self.close_tight(i);
                    self.add_block(Kind::Other, i..i + 1);
                }
                _ => self.tight_event(i, range),
            }
        }
        self.nodes
    }

    /// The innermost container on the stack.
    fn current(&self) -> usize {
        self.stack
            .iter()
            .rev()
            .find_map(|f| match f {
                Frame::Node(id) => Some(*id),
                _ => None,
            })
            .unwrap_or(0)
    }

    fn open(&mut self, kind: NodeKind, range: &Range<usize>) -> Frame {
        let parent = self.current();
        let id = self.nodes.len();
        let first_line = self.lines.line_of(range.start);
        let mut chain = self.nodes[parent].chain.clone();
        let mut supported = self.nodes[parent].supported && kind != NodeKind::Unsupported;
        let kind = match kind {
            NodeKind::Item(_) => {
                let links = links(&self.nodes, &chain, first_line);
                match list_item_indent(self.lines.text(first_line), &links) {
                    Some(indent) => NodeKind::Item(indent),
                    None => {
                        supported = false;
                        kind
                    }
                }
            }
            kind => kind,
        };
        if matches!(kind, NodeKind::BlockQuote | NodeKind::Item(_)) {
            chain.push(id);
        }
        let list = matches!(kind, NodeKind::Item(_)).then_some(parent);
        self.nodes.push(Node {
            kind,
            first_line,
            chain,
            supported,
            list,
            tight: None,
            range: range.clone(),
            children: Vec::new(),
        });
        Frame::Node(id)
    }

    fn add_block(&mut self, kind: Kind, events: Range<usize>) {
        let (event, range) = &self.events[events.start];
        let (first, last) = self.lines.span(range);
        let kind = match kind {
            // An ATX heading is one line; a setext heading has its underline too.
            Kind::SetextHeading if first == last => Kind::Other,
            kind => kind,
        };
        let align = match event {
            Event::Start(Tag::Table(align)) => align.clone(),
            _ => Vec::new(),
        };
        let start = range.start;
        self.push_block(Block {
            kind,
            events,
            first,
            last,
            start,
            align,
        });
    }

    fn push_block(&mut self, block: Block) {
        let parent = self.current();
        if let Some(list) = self.nodes[parent].list {
            match block.kind {
                Kind::Paragraph => self.nodes[list].tight = Some(false),
                Kind::TightParagraph => self.nodes[list].tight = Some(true),
                _ => {}
            }
        }
        self.nodes[parent].children.push(block);
    }

    fn tight_event(&mut self, i: usize, range: &Range<usize>) {
        let content = match self.events[i].0 {
            Event::TaskListMarker(_) => None,
            _ => Some(range.start),
        };
        match &mut self.tight {
            Some(run) => {
                run.content = run.content.or(content);
                run.end = run.end.max(range.end);
            }
            None => {
                self.tight = Some(TightRun {
                    node: self.current(),
                    first_event: i,
                    content,
                    end: range.end,
                });
            }
        }
    }

    fn close_tight(&mut self, i: usize) {
        let Some(run) = self.tight.take() else {
            return;
        };
        let block = match run.content {
            Some(start) => Block {
                kind: Kind::TightParagraph,
                events: run.first_event..i,
                first: self.lines.line_of(start),
                last: self.lines.line_of(run.end.max(start + 1) - 1),
                start,
                align: Vec::new(),
            },
            None => Block {
                kind: Kind::Other,
                events: run.first_event..i,
                first: self.lines.line_of(self.events[run.first_event].1.start),
                last: self.lines.line_of(self.events[run.first_event].1.start),
                start: self.events[run.first_event].1.start,
                align: Vec::new(),
            },
        };
        debug_assert_eq!(run.node, self.current());
        self.push_block(block);
    }
}

/// The containers of `chain` as the prefix scanner sees them on `line`.
fn links(nodes: &[Node], chain: &[usize], line: usize) -> Vec<Link> {
    chain
        .iter()
        .map(|&id| Link {
            container: match nodes[id].kind {
                NodeKind::Item(indent) => Container::ListItem(indent),
                _ => Container::BlockQuote,
            },
            opens: nodes[id].first_line == line,
        })
        .collect()
}

// -- planning --------------------------------------------------------------------------

/// A line of a run, with its container prefixes removed.
struct Stripped {
    /// The line as the LTEM core reads it: its indentation inside the containers, as
    /// spaces (tabs count to the next multiple of four columns of the document line, as
    /// the host counts them), then the rest of the line from its first other character.
    text: String,
    /// Byte offset in the document of the line's first character that is not a space
    /// or tab (byte `indent` of `text`).
    doc: usize,
    indent: usize,
    /// A lazy continuation line: it does not carry all prefixes. It cannot be part of
    /// a table; laziness only continues paragraph text.
    lazy: bool,
}

impl Stripped {
    /// The line `text`, whose content after its container prefixes starts at byte
    /// `content` with `spaces` columns of a partly used tab before it.
    fn new(text: &str, line_start: usize, prefix: Prefix, lazy: bool) -> Stripped {
        let column = |upto: usize| {
            text.as_bytes()[..upto]
                .iter()
                .fold(0, |c, &b| if b == b'\t' { c + 4 - c % 4 } else { c + 1 })
        };
        let rest = &text[prefix.content..];
        let first = prefix.content + rest.len() - rest.trim_start_matches([' ', '\t']).len();
        let indent = column(first) - (column(prefix.content) - prefix.spaces);
        Stripped {
            text: format!("{}{}", " ".repeat(indent), &text[first..]),
            doc: line_start + first,
            indent,
            lazy,
        }
    }

    /// The document offset of byte `col` of `text`.
    fn offset(&self, col: usize) -> usize {
        self.doc + col.saturating_sub(self.indent)
    }
}

/// What the run's events become: some of pulldown-cmark's own, and new ones.
enum Piece<'a> {
    Host(Range<usize>),
    New(Spanned<'a>),
}

struct Replacement<'a> {
    /// The events replaced.
    span: Range<usize>,
    pieces: Vec<Piece<'a>>,
}

enum Segment {
    Table(Range<usize>, Box<ParseResult>),
    Text(Range<usize>),
}

struct Planner<'p, 'a> {
    text: &'a str,
    events: &'p [Spanned<'a>],
    lines: &'p Lines<'a>,
    nodes: &'p [Node],
    options: Options,
    refdefs: &'p RefDefs<'p>,
    replacements: Vec<Replacement<'a>>,
    tables: Vec<TableBlock>,
}

impl<'p, 'a> Planner<'p, 'a> {
    fn plan_node(&mut self, id: usize) {
        let node = &self.nodes[id];
        if !node.supported {
            return;
        }
        let blocks = &node.children;
        let mut i = 0;
        while i < blocks.len() {
            if !blocks[i].kind.is_candidate() {
                i += 1;
                continue;
            }
            let mut j = i + 1;
            while j < blocks.len()
                && blocks[j].kind.is_candidate()
                && blocks[j].first == blocks[j - 1].last + 1
            {
                j += 1;
            }
            self.plan_run(id, &blocks[i..j]);
            i = j;
        }
    }

    fn plan_run(&mut self, id: usize, run: &[Block]) {
        let first = run[0].first;
        let last = run[run.len() - 1].last;
        let has_host_table = run.iter().any(|b| b.kind == Kind::Table);
        // Every table needs a pipe, in LTEM as in pulldown-cmark.
        let source = &self.text[self.lines.start(first)..self.lines.next_start(last)];
        if !has_host_table && !source.contains('|') {
            return;
        }
        let Some(lines) = self.strip(id, run) else {
            return;
        };
        let tables = find_tables(&lines);
        if tables.is_empty() && !has_host_table {
            return;
        }

        let mut segments = Vec::new();
        let mut cursor = 0;
        for (range, result) in tables {
            if cursor < range.start {
                segments.push(Segment::Text(cursor..range.start));
            }
            cursor = range.end;
            segments.push(Segment::Table(range, Box::new(result)));
        }
        if cursor < lines.len() {
            segments.push(Segment::Text(cursor..lines.len()));
        }

        let tight = self.is_tight(id);
        let mut breaks = HashMap::new();
        let mut pieces = Vec::new();
        for (n, segment) in segments.into_iter().enumerate() {
            match segment {
                Segment::Table(range, result) => {
                    let native = self.native_table(run, &range, &result, &lines);
                    let block = self.table_block(first, &range, *result, &lines, native.is_some());
                    match native {
                        Some(events) => pieces.push(Piece::Host(events)),
                        None => {
                            if n == 0 {
                                self.task_marker(&run[0], &mut pieces);
                            }
                            let html = CowStr::from(block.html.clone());
                            let span = block.range.clone();
                            pieces.push(Piece::New((Event::Start(Tag::HtmlBlock), span.clone())));
                            pieces.push(Piece::New((Event::Html(html), span.clone())));
                            pieces.push(Piece::New((Event::End(TagEnd::HtmlBlock), span)));
                        }
                    }
                    self.tables.push(block);
                }
                Segment::Text(range) => {
                    if let Some(blocks) = whole_blocks(run, first, &range) {
                        pieces.extend(blocks.into_iter().map(Piece::Host));
                    } else if let Some(events) = self.slice(run, first, &range, &lines, &mut breaks)
                    {
                        pieces.extend(events.into_iter().map(Piece::New));
                    } else {
                        if n == 0 {
                            self.task_marker(&run[0], &mut pieces);
                        }
                        let events = self.reparse(&lines[range], tight);
                        pieces.extend(events.into_iter().map(Piece::New));
                    }
                }
            }
        }
        self.replacements.push(Replacement {
            span: run[0].events.start..run[run.len() - 1].events.end,
            pieces,
        });
    }

    /// The lines of a run without their container prefixes, or `None` if the prefixes
    /// do not agree with where pulldown-cmark says the blocks start.
    fn strip(&self, id: usize, run: &[Block]) -> Option<Vec<Stripped>> {
        let node = &self.nodes[id];
        let first = run[0].first;
        let last = run[run.len() - 1].last;
        let mut lines = Vec::with_capacity(last - first + 1);
        for line in first..=last {
            let text = self.lines.text(line);
            let prefix = scan_prefixes(text, &links(self.nodes, &node.chain, line))?;
            let lazy = prefix.matched < node.chain.len();
            lines.push(Stripped::new(text, self.lines.start(line), prefix, lazy));
        }
        for block in run {
            let line = &mut lines[block.first - first];
            if line.lazy {
                return None;
            }
            let at = line.doc;
            // The first event of a tight paragraph that starts with a backslash escape
            // starts after the backslash.
            let escaped =
                block.kind == Kind::TightParagraph && self.text.get(at..block.start) == Some("\\");
            if at == block.start || escaped {
                continue;
            }
            // pulldown-cmark leaves out a task list marker that follows the list marker.
            let opens_item =
                matches!(node.kind, NodeKind::Item(_)) && node.first_line == block.first;
            if !(opens_item && at < block.start && is_task_marker(&self.text[at..block.start])) {
                return None;
            }
            line.text = self.text[block.start..self.lines.end(block.first)].to_string();
            line.doc = block.start;
            line.indent = 0;
        }
        Some(lines)
    }

    /// Whether the run's container is a tight list item, whose paragraphs have no tags.
    fn is_tight(&self, id: usize) -> bool {
        let Some(list) = self.nodes[id].list else {
            return false;
        };
        let list = &self.nodes[list];
        list.tight.unwrap_or_else(|| {
            // A list without paragraphs: pulldown-cmark makes it loose if blank lines
            // separate its parts. Blank lines in containers inside it are counted too,
            // which is rarely different.
            let (first, last) = self.lines.span(&list.range);
            !(first..=last).any(|l| {
                self.lines
                    .text(l)
                    .bytes()
                    .all(|b| matches!(b, b' ' | b'\t' | b'>'))
            })
        })
    }

    /// pulldown-cmark's events for an LTEM table, if it read exactly the same lines as
    /// a GFM table without LTEM notation: one header row, no spans, and cell text that
    /// is the cell's source with `\|` read as `|`.
    fn native_table(
        &self,
        run: &[Block],
        range: &Range<usize>,
        result: &ParseResult,
        lines: &[Stripped],
    ) -> Option<Range<usize>> {
        let first = run[0].first;
        let block = run.iter().find(|b| {
            b.kind == Kind::Table
                && b.first - first == range.start
                && b.last - first + 1 == range.end
        })?;
        let table = result.table.as_ref()?;
        let same_align = table.align.len() == block.align.len()
            && table.align.iter().zip(&block.align).all(|(a, h)| {
                matches!(
                    (a, h),
                    (None, Alignment::None)
                        | (Some(Align::Left), Alignment::Left)
                        | (Some(Align::Center), Alignment::Center)
                        | (Some(Align::Right), Alignment::Right)
                )
            });
        let plain_cells = table
            .cells
            .iter()
            .zip(&result.sources)
            .all(|(cell, source)| {
                let raw = &lines[source.line].text[source.start..source.end];
                cell.rowspan == 1 && cell.colspan == 1 && cell.text == raw.replace("\\|", "|")
            });
        (table.header_rows == 1 && same_align && plain_cells).then(|| block.events.clone())
    }

    fn table_block(
        &self,
        first: usize,
        range: &Range<usize>,
        result: ParseResult,
        lines: &[Stripped],
        native: bool,
    ) -> TableBlock {
        let table = result.table.expect("only tables are segments");
        let html = table_html(&table, &mut |line| {
            cell_inline(line, self.options, self.refdefs)
        });
        let cells = result
            .sources
            .iter()
            .map(|s| {
                let line = &lines[s.line];
                line.offset(s.start)..line.offset(s.end)
            })
            .collect();
        let last = first + range.end - 1;
        TableBlock {
            range: lines[range.start].doc..self.lines.next_start(last),
            lines: first + range.start..first + range.end,
            table,
            problems: result.problems,
            cells,
            html,
            native,
        }
    }

    /// A task list marker that starts the run's first block, for when its events are
    /// not kept.
    fn task_marker(&self, block: &Block, pieces: &mut Vec<Piece<'a>>) {
        let marker = self.events[block.events.clone()]
            .iter()
            .take(2)
            .find(|(event, _)| matches!(event, Event::TaskListMarker(_)));
        if let Some(marker) = marker {
            pieces.push(Piece::New(marker.clone()));
        }
    }

    /// The events of paragraph lines `range` (run coordinates) cut out of the one
    /// paragraph that holds them, if inline markup does not run across the cuts.
    fn slice(
        &self,
        run: &[Block],
        first: usize,
        range: &Range<usize>,
        lines: &[Stripped],
        breaks: &mut HashMap<usize, Vec<(usize, usize)>>,
    ) -> Option<Vec<Spanned<'a>>> {
        let (from, to) = (first + range.start, first + range.end - 1);
        let block = run.iter().find(|b| b.first <= from && to <= b.last)?;
        let paragraph = match block.kind {
            Kind::Paragraph => true,
            Kind::TightParagraph => false,
            _ => return None,
        };
        // A line that ends a table by beginning a block is the start of that block.
        let line = &lines[range.start].text;
        if from > block.first && (ltem::starts_block(line) || ltem::indentation(line) >= 4) {
            return None;
        }
        let inner = if paragraph {
            block.events.start + 1..block.events.end - 1
        } else {
            block.events.clone()
        };
        let breaks = breaks
            .entry(block.events.start)
            .or_insert_with(|| self.line_breaks(&inner));
        // The break that ends the line before `line`.
        let before = |line: usize| {
            let k = breaks.binary_search_by_key(&(line - 1), |&(l, _)| l).ok()?;
            Some(breaks[k].1)
        };
        let start = if from == block.first {
            inner.start
        } else {
            before(from)? + 1
        };
        let end = if to == block.last {
            inner.end
        } else {
            before(to + 1)?
        };
        if start >= end {
            return None;
        }
        let span = lines[range.start].doc..self.lines.next_start(to);
        let mut out = Vec::with_capacity(end - start + 2);
        if paragraph {
            out.push((Event::Start(Tag::Paragraph), span.clone()));
        }
        out.extend(self.events[start..end].iter().cloned());
        if paragraph {
            out.push((Event::End(TagEnd::Paragraph), span));
        }
        Some(out)
    }

    /// The soft and hard line breaks of a paragraph where no inline markup is open:
    /// the line each ends and the index of its event.
    fn line_breaks(&self, inner: &Range<usize>) -> Vec<(usize, usize)> {
        let mut depth = 0usize;
        let mut breaks = Vec::new();
        for i in inner.clone() {
            let (event, range) = &self.events[i];
            match event {
                Event::Start(_) => depth += 1,
                Event::End(_) => depth = depth.saturating_sub(1),
                Event::SoftBreak | Event::HardBreak if depth == 0 => {
                    breaks.push((self.lines.line_of(range.start), i));
                }
                _ => {}
            }
        }
        breaks
    }

    /// Parse text lines again on their own, with the document's link definitions.
    fn reparse(&self, lines: &[Stripped], tight: bool) -> Vec<Spanned<'a>> {
        let mut source = String::new();
        let mut starts = Vec::with_capacity(lines.len());
        for line in lines {
            starts.push(source.len());
            source.push_str(&line.text);
            source.push('\n');
        }
        let map = |offset: usize| {
            let k = starts.partition_point(|&s| s <= offset) - 1;
            let line = &lines[k];
            line.offset((offset - starts[k]).min(line.text.len()))
        };
        let parser = Parser::new_with_broken_link_callback(
            &source,
            fragment_options(self.options),
            Some(resolver(self.refdefs)),
        );
        let mut depth = 0usize;
        let mut out = Vec::new();
        for (event, range) in parser.into_offset_iter() {
            let top_paragraph = depth == 0 && matches!(event, Event::Start(Tag::Paragraph));
            match &event {
                Event::Start(_) => depth += 1,
                Event::End(_) => depth = depth.saturating_sub(1),
                _ => {}
            }
            let closes_top_paragraph = depth == 0 && matches!(event, Event::End(TagEnd::Paragraph));
            if tight && (top_paragraph || closes_top_paragraph) {
                continue;
            }
            out.push((event.into_static(), map(range.start)..map(range.end)));
        }
        out
    }
}

/// `[ ]`, `[x]` or `[X]` followed by spaces or tabs.
fn is_task_marker(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() >= 4
        && b[0] == b'['
        && matches!(b[1], b' ' | b'\t' | b'x' | b'X')
        && b[2] == b']'
        && b[3..].iter().all(|&c| c == b' ' || c == b'\t')
}

/// The LTEM tables of a run's lines, read by the core as `ltem::find_tables` reads a
/// block, table after table. A lazy line cannot be part of a table, and neither can a
/// line that ends a table body (it begins a block or is indented as code), so the lines
/// are read in pieces that end before such a line; a line that ends a body starts the
/// next piece, where it still counts as the line above a header row (spec 2.3). Each
/// piece holds at most one table, whose body runs to the piece's end, so the core reads
/// every line once.
fn find_tables(lines: &[Stripped]) -> Vec<(Range<usize>, ParseResult)> {
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
            tables.push((result.start..result.end, result));
        }
        start = end;
    }
    tables
}

/// The events of the blocks that make up text lines `range` (run coordinates) exactly,
/// if they are not GFM tables (which LTEM did not read as tables).
fn whole_blocks(run: &[Block], first: usize, range: &Range<usize>) -> Option<Vec<Range<usize>>> {
    let inside: Vec<&Block> = run
        .iter()
        .filter(|b| b.last - first >= range.start && b.first - first < range.end)
        .collect();
    let exact = inside.first()?.first - first == range.start
        && inside.last()?.last - first + 1 == range.end
        && inside.iter().all(|b| b.kind != Kind::Table);
    exact.then(|| inside.iter().map(|b| b.events.clone()).collect())
}

/// Put the replacements into the event list.
fn splice<'a>(
    events: Vec<Spanned<'a>>,
    mut replacements: Vec<Replacement<'a>>,
) -> Vec<Spanned<'a>> {
    if replacements.is_empty() {
        return events;
    }
    replacements.sort_by_key(|r| r.span.start);
    let len = events.len();
    let mut slots: Vec<Option<Spanned<'a>>> = events.into_iter().map(Some).collect();
    let mut out = Vec::with_capacity(len);
    let mut take = |out: &mut Vec<Spanned<'a>>, range: Range<usize>| {
        out.extend(range.filter_map(|i| slots[i].take()));
    };
    let mut pos = 0;
    for replacement in replacements {
        take(&mut out, pos..replacement.span.start);
        for piece in replacement.pieces {
            match piece {
                Piece::Host(range) => take(&mut out, range),
                Piece::New(event) => out.push(event),
            }
        }
        pos = replacement.span.end;
    }
    take(&mut out, pos..len);
    out
}
