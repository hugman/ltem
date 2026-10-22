//! [LTEM](https://github.com/hugman/ltem) tables for [pulldown-cmark]: Markdown pipe
//! tables with merged cells (`<<`, `^^`, `{c:N}`, `{r:M}`) and several header rows.
//!
//! ```
//! let markdown = "\
//! | Region | Revenue | <<  |
//! | ^^     | Q1      | Q2  |
//! |--------|---------|-----|
//! | Asia   | 100     | 120 |
//! ";
//! let mut html = String::new();
//! pulldown_cmark_ltem::push_html(&mut html, markdown, pulldown_cmark::Options::empty());
//! assert!(html.contains(r#"<th rowspan="2">Region</th><th colspan="2">Revenue</th>"#));
//! ```
//!
//! [`Parser`] wraps pulldown-cmark's parser. It yields the same events, except that each
//! LTEM table is one HTML block (`Start(Tag::HtmlBlock)`, `Html`, `End(TagEnd::HtmlBlock)`)
//! holding the rendered table. A GFM table without LTEM notation keeps pulldown-cmark's
//! own table events. Cell text is rendered by pulldown-cmark with the parser's options
//! and the document's link reference definitions.
//!
//! The document's block structure is pulldown-cmark's: tables are found in paragraphs,
//! also inside block quotes and list items, and never in code blocks or HTML blocks.
//!
//! [pulldown-cmark]: https://crates.io/crates/pulldown-cmark

#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod analysis;
mod lines;
mod render;
mod scan;

use std::ops::Range;

pub use pulldown_cmark;
use pulldown_cmark::{html, Event, Options};

/// Version of this crate.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// An iterator over the events of a Markdown document, with LTEM tables as HTML blocks.
///
/// The whole document is parsed when the parser is created, because a table can only be
/// recognized by looking ahead. `ENABLE_TABLES` is always on: LTEM tables take the place
/// of GFM tables.
#[derive(Debug)]
pub struct Parser<'a> {
    events: std::vec::IntoIter<(Event<'a>, Range<usize>)>,
}

impl<'a> Parser<'a> {
    /// A parser with no pulldown-cmark extensions except tables.
    pub fn new(text: &'a str) -> Parser<'a> {
        Parser::new_ext(text, Options::empty())
    }

    /// A parser with the given pulldown-cmark options (`ENABLE_TABLES` is added).
    pub fn new_ext(text: &'a str, options: Options) -> Parser<'a> {
        Parser {
            events: analysis::analyze(text, options).events.into_iter(),
        }
    }

    /// The events with their byte ranges in the source, like pulldown-cmark's
    /// `into_offset_iter`. The events of an LTEM table have the table's range: from its
    /// first line's content to the end of its last line, line ending included.
    pub fn into_offset_iter(self) -> OffsetIter<'a> {
        OffsetIter {
            events: self.events,
        }
    }
}

impl<'a> Iterator for Parser<'a> {
    type Item = Event<'a>;

    fn next(&mut self) -> Option<Event<'a>> {
        self.events.next().map(|(event, _)| event)
    }
}

/// Events with their byte ranges in the source; see [`Parser::into_offset_iter`].
#[derive(Debug)]
pub struct OffsetIter<'a> {
    events: std::vec::IntoIter<(Event<'a>, Range<usize>)>,
}

impl<'a> Iterator for OffsetIter<'a> {
    type Item = (Event<'a>, Range<usize>);

    fn next(&mut self) -> Option<(Event<'a>, Range<usize>)> {
        self.events.next()
    }
}

/// Render a Markdown document as HTML, with LTEM tables, and append it to `out`.
///
/// The same as `pulldown_cmark::html::push_html(out, Parser::new_ext(text, options))`.
pub fn push_html(out: &mut String, text: &str, options: Options) {
    html::push_html(out, Parser::new_ext(text, options));
}

/// An LTEM table found in a document.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TableBlock {
    /// Where the table is in the document: from its first line's content (after any
    /// container prefix such as `> `) to the end of its last line, line ending included.
    pub range: Range<usize>,
    /// The table's lines, counted from 0 (lines end at `\n`, `\r\n` or `\r`).
    pub lines: Range<usize>,
    /// The table model.
    pub table: ltem::Table,
    /// Validation problems of the table (LTEM specification, Section 5).
    pub problems: Vec<ltem::Problem>,
    /// The byte range of each cell's source in the document, in the order of
    /// `table.cells`: without the spaces and tabs around it, with any span attribute
    /// and escapes. A cell added to fill a short row is empty, at the end of its line.
    pub cells: Vec<Range<usize>>,
    /// The table as HTML, laid out like pulldown-cmark's GFM tables, with cell text
    /// rendered by pulldown-cmark. Line feeds only come between tags.
    pub html: String,
    /// Whether pulldown-cmark reads the same lines as a GFM table that renders the
    /// same: one header row, no spans and no LTEM escapes or line breaks. [`Parser`]
    /// keeps pulldown-cmark's own events for such a table.
    pub native: bool,
}

/// Find the LTEM tables of a Markdown document, in document order.
///
/// The tables are those that [`Parser::new_ext`] renders with the same options.
pub fn find_tables(text: &str, options: Options) -> Vec<TableBlock> {
    analysis::analyze(text, options).tables
}
