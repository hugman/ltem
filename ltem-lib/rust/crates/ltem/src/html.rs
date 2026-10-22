//! HTML output for LTEM tables (spec Section 6).

use std::collections::BTreeMap;

use crate::model::{Cell, Table};

/// Whether a character is ASCII punctuation, which CommonMark lets a backslash escape.
pub(crate) fn is_ascii_punctuation(c: char) -> bool {
    c.is_ascii_punctuation()
}

/// Escape `&`, `<`, `>` and `"` for HTML text and attribute values.
pub(crate) fn escape_html(out: &mut String, c: char) {
    match c {
        '&' => out.push_str("&amp;"),
        '<' => out.push_str("&lt;"),
        '>' => out.push_str("&gt;"),
        '"' => out.push_str("&quot;"),
        c => out.push(c),
    }
}

/// Render inline text with only CommonMark backslash escapes and HTML escaping.
///
/// Emphasis, links and code are left as text. This is the default inline renderer of
/// [`render_html`]; pass `commonmark_inline` (feature `commonmark-inline`) or a renderer
/// of your own for full CommonMark inlines.
pub fn plain_inline(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(mut c) = chars.next() {
        if c == '\\' {
            if let Some(&next) = chars.peek().filter(|&&n| is_ascii_punctuation(n)) {
                c = next;
                chars.next();
            }
        }
        escape_html(&mut out, c);
    }
    out
}

/// Render a table as HTML, in the format of the specification's examples.
///
/// `inline` renders one line of cell text (inline Markdown) as HTML; the lines of a cell
/// are joined with `<br />`. It defaults to [`plain_inline`].
pub fn render_html(table: &Table, inline: Option<&dyn Fn(&str) -> String>) -> String {
    let inline: &dyn Fn(&str) -> String = inline.unwrap_or(&plain_inline);
    let mut by_row: BTreeMap<usize, Vec<&Cell>> = BTreeMap::new();
    for cell in &table.cells {
        by_row.entry(cell.row).or_default().push(cell);
    }

    let row_html = |r: usize, parts: &mut Vec<String>| {
        let tag = if r < table.header_rows { "th" } else { "td" };
        parts.push("<tr>".to_string());
        let mut cells = by_row.get(&r).cloned().unwrap_or_default();
        cells.sort_by_key(|c| c.col);
        for cell in cells {
            let mut attrs = String::new();
            if cell.colspan > 1 {
                attrs += &format!(" colspan=\"{}\"", cell.colspan);
            }
            if cell.rowspan > 1 {
                attrs += &format!(" rowspan=\"{}\"", cell.rowspan);
            }
            if let Some(Some(align)) = table.align.get(cell.col) {
                attrs += &format!(" align=\"{}\"", align.as_str());
            }
            let content: Vec<String> = cell.text.split('\n').map(inline).collect();
            parts.push(format!("<{tag}{attrs}>{}</{tag}>", content.join("<br />")));
        }
        parts.push("</tr>".to_string());
    };

    let mut parts = vec!["<table>".to_string(), "<thead>".to_string()];
    for r in 0..table.header_rows {
        row_html(r, &mut parts);
    }
    parts.push("</thead>".to_string());
    if table.rows > table.header_rows {
        parts.push("<tbody>".to_string());
        for r in table.header_rows..table.rows {
            row_html(r, &mut parts);
        }
        parts.push("</tbody>".to_string());
    }
    parts.push("</table>".to_string());
    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain() {
        assert_eq!(
            plain_inline(r#"a \* <b> & "q" 'x' \a \"#),
            "a * &lt;b&gt; &amp; &quot;q&quot; 'x' \\a \\"
        );
    }
}
