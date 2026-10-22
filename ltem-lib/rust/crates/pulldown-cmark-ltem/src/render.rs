//! HTML for LTEM tables, laid out like pulldown-cmark's GFM tables.

use ltem::{Align, Table};
use pulldown_cmark::{html, BrokenLink, CowStr, Event, Options, Parser, RefDefs, Tag, TagEnd};

/// A no-break space put before a line of cell text. No block can start after it, so the
/// line stays a paragraph, and CommonMark counts it as whitespace, like the start of a
/// line, when it decides what can open emphasis or a quote.
const GUARD: char = '\u{a0}';

/// The options for cell text and for text that is parsed again: the host's options
/// without tables (LTEM finds the tables) and without metadata blocks (which only exist
/// at the start of the whole document).
pub(crate) fn fragment_options(options: Options) -> Options {
    options
        - Options::ENABLE_TABLES
        - Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
        - Options::ENABLE_PLUSES_DELIMITED_METADATA_BLOCKS
}

/// A broken-link callback that resolves references with the document's definitions, so
/// that text parsed on its own sees them as the host's parse does.
pub(crate) fn resolver<'r>(
    refdefs: &'r RefDefs<'r>,
) -> impl for<'x> FnMut(BrokenLink<'x>) -> Option<(CowStr<'x>, CowStr<'x>)> + 'r {
    move |link: BrokenLink<'_>| {
        refdefs.get(&link.reference).map(|def| {
            let title = def.title.as_deref().unwrap_or_default();
            (
                CowStr::from(def.dest.to_string()),
                CowStr::from(title.to_string()),
            )
        })
    }
}

/// Renders one line of cell text as inlines with pulldown-cmark.
pub(crate) fn cell_inline(text: &str, options: Options, refdefs: &RefDefs<'_>) -> String {
    if text.is_empty() {
        return String::new();
    }
    let source = format!("{GUARD}{text}");
    let parser = Parser::new_with_broken_link_callback(
        &source,
        fragment_options(options),
        Some(resolver(refdefs)),
    );
    let mut guarded = true;
    let events = parser.filter_map(|event| match event {
        Event::Start(Tag::Paragraph) | Event::End(TagEnd::Paragraph) => None,
        Event::Text(text) if guarded => {
            guarded = false;
            let rest = text.strip_prefix(GUARD).unwrap_or(&text);
            (!rest.is_empty()).then(|| Event::Text(CowStr::from(rest.to_string())))
        }
        event => {
            guarded = false;
            Some(event)
        }
    });
    let mut out = String::with_capacity(text.len() + 16);
    html::push_html(&mut out, events);
    // A cell is one line of HTML, so that the table can be written as a single line
    // (mdBook needs that). Inline HTML of one source line holds no line feed anyway.
    out.replace('\n', " ")
}

/// Writes a table as HTML: `<thead>` with every header row, `<tbody>` only if there are
/// body rows, `colspan` and `rowspan` above 1, and alignment as pulldown-cmark writes it
/// (`style="text-align: ..."`). `inline` renders one line of cell text; the lines of a
/// cell are joined with `<br />`. Line feeds only come between tags.
pub(crate) fn table_html(table: &Table, inline: &mut dyn FnMut(&str) -> String) -> String {
    let mut out = String::from("<table><thead>");
    let mut cells = table.cells.iter().peekable();
    for row in 0..table.rows {
        if row == table.header_rows {
            out.push_str("</thead><tbody>\n");
        } else if row > 0 {
            out.push('\n');
        }
        let tag = if row < table.header_rows { "th" } else { "td" };
        out.push_str("<tr>");
        while let Some(cell) = cells.next_if(|c| c.row == row) {
            out.push('<');
            out.push_str(tag);
            if cell.colspan > 1 {
                out.push_str(&format!(" colspan=\"{}\"", cell.colspan));
            }
            if cell.rowspan > 1 {
                out.push_str(&format!(" rowspan=\"{}\"", cell.rowspan));
            }
            if let Some(Some(align)) = table.align.get(cell.col) {
                out.push_str(match align {
                    Align::Left => " style=\"text-align: left\"",
                    Align::Center => " style=\"text-align: center\"",
                    Align::Right => " style=\"text-align: right\"",
                });
            }
            out.push('>');
            for (i, line) in cell.text.split('\n').enumerate() {
                if i > 0 {
                    out.push_str("<br />");
                }
                out.push_str(&inline(line));
            }
            out.push_str("</");
            out.push_str(tag);
            out.push('>');
        }
        out.push_str("</tr>");
    }
    if table.rows > table.header_rows {
        out.push_str("\n</tbody></table>\n");
    } else {
        out.push_str("</thead></table>\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inline(text: &str) -> String {
        cell_inline(text, Options::empty(), &RefDefs::default())
    }

    #[test]
    fn cell_text() {
        assert_eq!(inline("**Revenue**"), "<strong>Revenue</strong>");
        assert_eq!(inline("- 2x faster"), "- 2x faster");
        assert_eq!(inline("# not a heading"), "# not a heading");
        assert_eq!(inline("1. one"), "1. one");
        assert_eq!(inline("<div>"), "<div>");
        assert_eq!(inline("6.1\" < 7"), "6.1\" &lt; 7");
        assert_eq!(
            inline("`x|y` [a](b)"),
            "<code>x|y</code> <a href=\"b\">a</a>"
        );
        assert_eq!(inline("x \\"), "x \\");
        assert_eq!(inline(""), "");
        let smart = cell_inline(
            "\"a\" -- b",
            Options::ENABLE_SMART_PUNCTUATION,
            &RefDefs::default(),
        );
        assert_eq!(smart, "\u{201c}a\u{201d} \u{2013} b");
    }

    #[test]
    fn layout() {
        let result = ltem::parse_table("| A {c:2} |\n| b | c |\n|:-|-:|\n| 1 | 2 |", 0);
        let html = table_html(&result.table.unwrap(), &mut |t| t.to_string());
        assert_eq!(
            html,
            "<table><thead><tr><th colspan=\"2\" style=\"text-align: left\">A</th></tr>\n\
             <tr><th style=\"text-align: left\">b</th><th style=\"text-align: right\">c</th></tr></thead><tbody>\n\
             <tr><td style=\"text-align: left\">1</td><td style=\"text-align: right\">2</td></tr>\n\
             </tbody></table>\n"
        );
        let result = ltem::parse_table("| a \\\\ b |\n|---|", 0);
        let html = table_html(&result.table.unwrap(), &mut |t| t.to_string());
        assert_eq!(
            html,
            "<table><thead><tr><th>a<br />b</th></tr></thead></table>\n"
        );
    }
}
