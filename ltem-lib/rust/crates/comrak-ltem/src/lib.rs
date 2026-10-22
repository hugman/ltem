//! [LTEM](https://github.com/hugman/ltem) tables for [comrak]: Markdown pipe tables with
//! merged cells (`<<`, `^^`, `{c:N}`, `{r:M}`) and several header rows.
//!
//! ```
//! let markdown = "\
//! | Region | Revenue | <<  |
//! | ^^     | Q1      | Q2  |
//! |--------|---------|-----|
//! | Asia   | 100     | 120 |
//! ";
//! let html = comrak_ltem::markdown_to_html(markdown, &comrak::Options::default());
//! assert!(html.contains("<th rowspan=\"2\">Region</th>\n<th colspan=\"2\">Revenue</th>"));
//! ```
//!
//! [`parse_document`] parses with comrak and then replaces the nodes that make up each
//! LTEM table with a `Raw` node holding the table's HTML. A GFM table without LTEM
//! notation keeps comrak's own `Table` node. Cell text is rendered by comrak with the
//! same options, in the context of the whole document. The result is an ordinary comrak
//! AST, which any of comrak's formatters and plugins can render.
//!
//! The document's block structure is comrak's: tables are found in paragraphs, also
//! inside block quotes, alerts and list items, and never in code blocks or HTML blocks.
//!
//! [comrak]: https://crates.io/crates/comrak

#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod analysis;
mod lines;
mod prefix;
mod render;

pub use comrak;
use comrak::nodes::Node;
use comrak::{Arena, Options};

/// Version of this crate.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Parse a Markdown document into a comrak AST in which each LTEM table is a `Raw` node
/// holding its HTML.
///
/// The table extension is always on: LTEM tables take the place of GFM tables.
pub fn parse_document<'a>(arena: &'a Arena<'a>, md: &str, options: &Options) -> Node<'a> {
    let mut options = options.clone();
    options.extension.table = true;
    let root = comrak::parse_document(arena, md, &options);
    analysis::transform(arena, root, md, &options);
    root
}

/// Render a Markdown document as HTML, with LTEM tables.
///
/// The same as [`parse_document`] followed by `comrak::format_html`.
pub fn markdown_to_html(md: &str, options: &Options) -> String {
    let arena = Arena::new();
    let root = parse_document(&arena, md, options);
    let mut html = String::new();
    // Writing to a String does not fail.
    let _ = comrak::format_html(root, options, &mut html);
    html
}
