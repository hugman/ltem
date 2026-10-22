//! Cell text and text parsed again, rendered by comrak in the document's context, and
//! the HTML of LTEM tables, laid out like comrak's GFM tables.
//!
//! comrak resolves reference links with the definitions of the whole document but does
//! not expose them. So the texts to be parsed (each line of cell text, and the text
//! that LTEM reads differently) are put in front of the document, each followed by a
//! separator paragraph, and the result is parsed once with the same options (but
//! without the table extension: LTEM decides where tables are): every text sees the
//! document's definitions. Should that fail to come apart cleanly into
//! the texts (a text that opens a block which runs on, such as an unclosed HTML
//! comment), each text is parsed on its own instead.

use std::ops::Range;

use comrak::nodes::{Node, NodeValue, Sourcepos};
use comrak::{Arena, Options};
use ltem::{Align, ParseResult, Table};

use crate::analysis::{Document, Output, Stripped};
use crate::lines::Lines;

/// A no-break space put before a line of cell text. No block can start after it, so the
/// line stays a paragraph, and CommonMark counts it as whitespace, like the start of a
/// line, when it decides what can open emphasis or a quote.
const GUARD: char = '\u{a0}';

/// The paragraph that follows each text in the combined source.
const SEPARATOR: &str = "\u{a0}LTEM-CHUNK-END\u{a0}";

/// A text to be parsed by comrak.
pub(crate) enum Chunk {
    /// A line of cell text, rendered as inlines.
    Cell(String),
    /// Lines of Markdown, parsed as blocks.
    Text(String),
}

impl Chunk {
    fn source(&self) -> String {
        match self {
            Chunk::Cell(text) => format!("{GUARD}{text}"),
            Chunk::Text(text) => text.clone(),
        }
    }
}

/// Parse the chunks in the context of the document `md`, whose AST is `root`.
pub(crate) fn parse_chunks<'a>(
    arena: &'a Arena<'a>,
    md: &str,
    root: Node<'a>,
    lines: &Lines<'_>,
    chunks: &[Chunk],
    options: &Options,
) -> Vec<Output<'a>> {
    if chunks.is_empty() {
        return Vec::new();
    }
    // LTEM decides where tables are: text that LTEM does not read as a table is parsed
    // without comrak's table extension.
    let mut options = options.clone();
    options.extension.table = false;
    let options = &options;
    // Front matter only counts at the start of a document, so the texts go after it.
    let head = root
        .first_child()
        .filter(|n| matches!(n.data().value, NodeValue::FrontMatter(_)))
        .map_or(0, |n| {
            lines.next_start(n.data().sourcepos.end.line.max(1) - 1)
        });
    parse_together(arena, &md[..head], &md[head..], chunks, options).unwrap_or_else(|| {
        chunks
            .iter()
            .map(|chunk| {
                parse_together(arena, "", "", std::slice::from_ref(chunk), options)
                    .and_then(|mut outputs| outputs.pop())
                    .unwrap_or(Output::Text(Vec::new(), 0))
            })
            .collect()
    })
}

/// Parse `head`, the chunks with their separators, and `tail` as one document; `None`
/// if the result does not come apart into the chunks.
fn parse_together<'a>(
    arena: &'a Arena<'a>,
    head: &str,
    tail: &str,
    chunks: &[Chunk],
    options: &Options,
) -> Option<Vec<Output<'a>>> {
    let mut source = String::from(head);
    let mut line =
        head.matches('\n').count() + head.matches('\r').count() - head.matches("\r\n").count();
    let mut spans: Vec<Range<usize>> = Vec::with_capacity(chunks.len());
    for chunk in chunks {
        let text = chunk.source();
        let count = text.split('\n').count();
        spans.push(line..line + count);
        source.push_str(&text);
        source.push_str("\n\n");
        source.push_str(SEPARATOR);
        source.push_str("\n\n");
        line += count + 3;
    }
    source.push_str(tail);

    let root = comrak::parse_document(arena, &source, options);
    let mut children = root
        .children()
        .filter(|n| !matches!(n.data().value, NodeValue::FrontMatter(_)));
    let mut outputs = Vec::with_capacity(chunks.len());
    for (chunk, span) in chunks.iter().zip(spans) {
        let mut blocks = Vec::new();
        loop {
            let node = children.next()?;
            if is_separator(node) {
                break;
            }
            let Sourcepos { start, end } = node.data().sourcepos;
            if start.line == 0
                || !span.contains(&(start.line - 1))
                || !span.contains(&(end.line - 1))
            {
                return None;
            }
            blocks.push(node);
        }
        outputs.push(match chunk {
            Chunk::Cell(_) => match blocks.as_slice() {
                [paragraph] if matches!(paragraph.data().value, NodeValue::Paragraph) => {
                    Output::Cell(cell_html(paragraph, options))
                }
                _ => return None,
            },
            Chunk::Text(_) => {
                for block in &blocks {
                    block.detach();
                }
                Output::Text(blocks, span.start)
            }
        });
    }
    Some(outputs)
}

fn is_separator(node: Node<'_>) -> bool {
    matches!(node.data().value, NodeValue::Paragraph)
        && node.first_child().is_some_and(|child| {
            child.next_sibling().is_none()
                && matches!(&child.data().value, NodeValue::Text(text) if text == SEPARATOR)
        })
}

/// The HTML of the inlines of a paragraph of cell text.
fn cell_html(paragraph: Node<'_>, options: &Options) -> String {
    // A footnote reference stays text: its number would be that of the combined
    // source, not of the document.
    for node in paragraph.descendants() {
        let name = match &node.data().value {
            NodeValue::FootnoteReference(reference) => reference.name.clone(),
            _ => continue,
        };
        node.data_mut().value = NodeValue::Text(format!("[^{name}]").into());
    }
    let mut options = options.clone();
    // Positions in the combined source mean nothing in the document.
    options.render.sourcepos = false;
    let mut html = String::new();
    if comrak::format_html(paragraph, &options, &mut html).is_err() {
        return String::new();
    }
    let inner = html.trim_end_matches('\n');
    let inner = inner.strip_prefix("<p>").unwrap_or(inner);
    let inner = inner.strip_suffix("</p>").unwrap_or(inner);
    // A cell is written as one line of HTML.
    inner
        .strip_prefix(GUARD)
        .unwrap_or(inner)
        .replace('\n', " ")
}

/// An LTEM table and where its rows and cells are, to write it as HTML.
pub(crate) struct TableHtml {
    table: Table,
    /// For each row and each cell: its document line (0-based) and byte range.
    rows: Vec<(usize, Range<usize>)>,
    cells: Vec<(usize, Range<usize>)>,
}

impl TableHtml {
    /// The table found at lines `range` of a run whose lines are `lines`.
    pub(crate) fn new(range: &Range<usize>, result: ParseResult, lines: &[Stripped]) -> TableHtml {
        let table = result.table.expect("only tables are rendered");
        let rows = (0..table.rows)
            .map(|r| {
                // Body rows follow the delimiter row.
                let line = &lines[range.start + r + usize::from(r >= table.header_rows)];
                let end = line.offset(line.text.trim_end_matches([' ', '\t']).len());
                (line.line, line.doc..end)
            })
            .collect();
        let cells = result
            .sources
            .iter()
            .map(|s| {
                let line = &lines[s.line];
                (line.line, line.offset(s.start)..line.offset(s.end))
            })
            .collect();
        TableHtml { table, rows, cells }
    }

    /// The source span of the whole table.
    pub(crate) fn sourcepos(&self, doc: &Document<'_>) -> Sourcepos {
        let (first, start) = &self.rows[0];
        let (last, end) = &self.rows[self.rows.len() - 1];
        span(doc, *first, start.start, *last, end.end)
    }

    /// The table as HTML, with `inline` rendering a line of cell text. With `sourcepos`,
    /// the table, its rows and cells get `data-sourcepos` attributes, as comrak writes
    /// them for its own tables.
    pub(crate) fn render(
        &self,
        inline: &dyn Fn(&str) -> String,
        sourcepos: Option<&Document<'_>>,
    ) -> String {
        let position = |line: usize, range: &Range<usize>| match sourcepos {
            Some(doc) => format!(
                " data-sourcepos=\"{}\"",
                span(doc, line, range.start, line, range.end)
            ),
            None => String::new(),
        };
        let table = &self.table;
        let mut out = String::from("<table");
        if let Some(doc) = sourcepos {
            out.push_str(&format!(" data-sourcepos=\"{}\"", self.sourcepos(doc)));
        }
        out.push_str(">\n<thead>\n");
        let mut cells = table.cells.iter().zip(&self.cells).peekable();
        for (row, (line, range)) in self.rows.iter().enumerate() {
            if row == table.header_rows {
                out.push_str("</thead>\n<tbody>\n");
            }
            let tag = if row < table.header_rows { "th" } else { "td" };
            out.push_str(&format!("<tr{}>\n", position(*line, range)));
            while let Some((cell, (line, range))) = cells.next_if(|(c, _)| c.row == row) {
                out.push('<');
                out.push_str(tag);
                out.push_str(&position(*line, range));
                if cell.colspan > 1 {
                    out.push_str(&format!(" colspan=\"{}\"", cell.colspan));
                }
                if cell.rowspan > 1 {
                    out.push_str(&format!(" rowspan=\"{}\"", cell.rowspan));
                }
                if let Some(Some(align)) = table.align.get(cell.col) {
                    out.push_str(match align {
                        Align::Left => " align=\"left\"",
                        Align::Center => " align=\"center\"",
                        Align::Right => " align=\"right\"",
                    });
                }
                out.push('>');
                for (i, text) in cell.text.split('\n').enumerate() {
                    if i > 0 {
                        out.push_str("<br />\n");
                    }
                    out.push_str(&inline(text));
                }
                out.push_str(&format!("</{tag}>\n"));
            }
            out.push_str("</tr>\n");
        }
        out.push_str(if table.rows > table.header_rows {
            "</tbody>\n</table>\n"
        } else {
            "</thead>\n</table>\n"
        });
        out
    }
}

/// The source span from byte `start` of line `first` to the last character before byte
/// `end` of line `last` (comrak's spans include their last character).
fn span(doc: &Document<'_>, first: usize, start: usize, last: usize, end: usize) -> Sourcepos {
    Sourcepos {
        start: doc.position(first, start),
        end: doc.last_position(last, start, end),
    }
}
