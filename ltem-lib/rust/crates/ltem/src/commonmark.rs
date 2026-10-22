//! CommonMark inline rendering of cell text with pulldown-cmark (feature
//! `commonmark-inline`).

use pulldown_cmark::{html, Options, Parser};

/// A no-break space put before the text: it keeps the line a paragraph (no heading,
/// list item or other block can start after it), and CommonMark treats it as
/// whitespace, like the start of a line, when it decides what can open emphasis.
const GUARD: char = '\u{a0}';

/// Render one line of cell text as CommonMark inlines.
///
/// pulldown-cmark has no inline-only mode, so the text is rendered as a paragraph
/// behind a no-break space, and the paragraph tags and the space are removed again.
pub fn commonmark_inline(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    let source = format!("{GUARD}{text}");
    let mut out = String::with_capacity(text.len() + 16);
    html::push_html(&mut out, Parser::new_ext(&source, Options::empty()));
    let inner = out
        .strip_prefix("<p>")
        .and_then(|s| s.strip_suffix("</p>\n"))
        .unwrap_or(&out);
    inner.strip_prefix(GUARD).unwrap_or(inner).to_string()
}

#[cfg(test)]
mod tests {
    use super::commonmark_inline;

    #[test]
    fn inlines() {
        assert_eq!(commonmark_inline("**Revenue**"), "<strong>Revenue</strong>");
        assert_eq!(
            commonmark_inline("_a_ and *b*"),
            "<em>a</em> and <em>b</em>"
        );
        assert_eq!(commonmark_inline("- 2x faster"), "- 2x faster");
        assert_eq!(commonmark_inline("# not a heading"), "# not a heading");
        assert_eq!(commonmark_inline("1. one"), "1. one");
        assert_eq!(commonmark_inline("6.1\" < 7"), "6.1\" &lt; 7");
        assert_eq!(commonmark_inline("$|r| < 1$"), "$|r| &lt; 1$");
        assert_eq!(
            commonmark_inline("`x|y` [a](b)"),
            "<code>x|y</code> <a href=\"b\">a</a>"
        );
        assert_eq!(commonmark_inline(""), "");
    }
}
