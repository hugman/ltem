//! Line-level syntax: rows, delimiter rows, cell kinds and span attributes (spec Section 2).

use crate::model::Align;

/// The colspan marker (spec 2.5).
pub(crate) const COLSPAN_MARKER: &str = "<<";
/// The rowspan marker (spec 2.5).
pub(crate) const ROWSPAN_MARKER: &str = "^^";

fn is_space_or_tab(c: char) -> bool {
    c == ' ' || c == '\t'
}

/// Remove leading and trailing spaces and tabs, and no other whitespace (spec 2.1).
pub(crate) fn strip_spaces(s: &str) -> &str {
    s.trim_matches(is_space_or_tab)
}

fn rstrip_spaces(s: &str) -> &str {
    s.trim_end_matches(is_space_or_tab)
}

/// The number of leading spaces (not tabs).
fn leading_spaces(s: &str) -> usize {
    s.bytes().take_while(|&b| b == b' ').count()
}

/// Whether byte `i` of `s` is where a regular expression `$` matches: the end of the
/// string or just before a final line feed.
fn at_end(s: &str, i: usize) -> bool {
    i == s.len() || (i + 1 == s.len() && s.as_bytes()[i] == b'\n')
}

/// Whether byte `i` of `s` is a space or tab, or where `$` matches.
fn space_or_end(s: &str, i: usize) -> bool {
    matches!(s.as_bytes().get(i), Some(b' ' | b'\t')) || at_end(s, i)
}

/// Split a row into cells, as GFM does (spec 2.1), keeping where each cell is.
///
/// Each cell is `(text, start, end)`. `text` is trimmed of spaces and tabs, and a pipe
/// preceded by a backslash becomes a literal pipe. `start` and `end` are UTF-8 byte
/// offsets into `line` (so `&line[start..end]` is the cell's source) and cover the
/// cell's source without the spaces and tabs around it; for an empty cell both are the
/// end of its space between the pipes.
pub fn split_row_spans(line: &str) -> Vec<(String, usize, usize)> {
    let bytes = line.as_bytes();
    let space = |i: usize| matches!(bytes[i], b' ' | b'\t');
    let (mut b, mut e) = (0, bytes.len());
    while b < e && space(b) {
        b += 1;
    }
    while e > b && space(e - 1) {
        e -= 1;
    }
    if b < e && bytes[b] == b'|' {
        b += 1;
    }
    if e > b && bytes[e - 1] == b'|' && !(e >= b + 2 && bytes[e - 2] == b'\\') {
        e -= 1;
    }
    let cell = |start: usize, end: usize, text: &str| {
        let (mut start, mut end) = (start, end);
        while start < end && space(start) {
            start += 1;
        }
        while end > start && space(end - 1) {
            end -= 1;
        }
        (strip_spaces(text).to_string(), start, end)
    };
    let mut cells = Vec::new();
    let mut cur = String::new();
    let (mut cell_start, mut i) = (b, b);
    while i < e {
        match bytes[i] {
            b'\\' if i + 1 < e && bytes[i + 1] == b'|' => {
                cur.push('|');
                i += 2;
            }
            b'|' => {
                cells.push(cell(cell_start, i, &cur));
                cur.clear();
                i += 1;
                cell_start = i;
            }
            _ => {
                // Copy one whole character (the line is UTF-8; '|' and '\\' are ASCII).
                let len = line[i..].chars().next().map_or(1, char::len_utf8);
                cur.push_str(&line[i..i + len]);
                i += len;
            }
        }
    }
    cells.push(cell(cell_start, e, &cur));
    cells
}

/// Split a row into trimmed cell texts, as GFM does (spec 2.1).
///
/// A leading and a trailing pipe are optional. A pipe preceded by a backslash does not
/// split cells and becomes a literal pipe.
pub fn split_row(line: &str) -> Vec<String> {
    split_row_spans(line)
        .into_iter()
        .map(|(text, _, _)| text)
        .collect()
}

/// Width of the leading spaces and tabs, with tab stops every 4 columns.
pub fn indentation(line: &str) -> usize {
    let mut width = 0;
    for ch in line.chars() {
        match ch {
            ' ' => width += 1,
            '\t' => width += 4 - width % 4,
            _ => break,
        }
    }
    width
}

/// A delimiter cell: hyphens with an optional colon at either end (spec 2.2).
pub(crate) fn is_delimiter_cell(cell: &str) -> bool {
    let b = cell.as_bytes();
    let start = usize::from(b.first() == Some(&b':'));
    let mut end = b.len();
    if end > start && b[end - 1] == b':' {
        end -= 1;
    }
    start < end && b[start..end].iter().all(|&c| c == b'-')
}

/// A line that begins a list item with a dash, such as `- | -` (spec 2.2).
fn is_list_dash(line: &str) -> bool {
    let n = leading_spaces(line);
    let b = line.as_bytes();
    n <= 3 && b.get(n) == Some(&b'-') && matches!(b.get(n + 1), Some(b' ' | b'\t'))
}

/// A GFM delimiter row (spec 2.2).
///
/// It has at least one pipe, is indented less than 4 spaces, and does not begin a list
/// item: a line such as `- | -` is a list item, as in GFM.
pub fn is_delimiter_row(line: &str) -> bool {
    if !line.contains('|') || indentation(line) >= 4 || is_list_dash(line) {
        return false;
    }
    split_row(line).iter().all(|c| is_delimiter_cell(c))
}

/// A line that begins with a pipe after at most three spaces (spec 2.3).
fn is_pipe_led(line: &str) -> bool {
    let n = leading_spaces(line);
    n <= 3 && line.as_bytes().get(n) == Some(&b'|')
}

/// The reserved table-identifier line `| # identifier |` (spec Section 9).
pub(crate) fn is_identifier_row(line: &str) -> bool {
    let b = line.as_bytes();
    let blank = |i: &mut usize| {
        let start = *i;
        while matches!(b.get(*i), Some(b' ' | b'\t')) {
            *i += 1;
        }
        *i - start
    };
    let mut i = leading_spaces(line);
    if i > 3 || b.get(i) != Some(&b'|') {
        return false;
    }
    i += 1;
    blank(&mut i);
    if b.get(i) != Some(&b'#') {
        return false;
    }
    i += 1;
    if blank(&mut i) == 0 {
        return false;
    }
    if !matches!(b.get(i), Some(c) if c.is_ascii_alphabetic() || *c == b'_') {
        return false;
    }
    i += 1;
    while matches!(b.get(i), Some(c) if c.is_ascii_alphanumeric() || *c == b'_') {
        i += 1;
    }
    blank(&mut i);
    if b.get(i) != Some(&b'|') {
        return false;
    }
    i += 1;
    blank(&mut i);
    at_end(line, i)
}

/// Whether a line can be a header row above the last one (spec 2.3, 9).
///
/// It begins with a pipe, is not a reserved identifier line and does not look like a
/// delimiter row.
pub fn is_upper_header_row(line: &str) -> bool {
    is_pipe_led(line) && !is_identifier_row(line) && !is_delimiter_row(line)
}

/// `^ {0,3}(?:=+|-+)[ \t]*$`: a line of `=` or of `-` characters, which underlines a
/// paragraph line as a heading.
pub(crate) fn is_setext_underline(line: &str) -> bool {
    let n = leading_spaces(line);
    if n > 3 {
        return false;
    }
    let body = line[n..].trim_end_matches([' ', '\t']);
    let Some(&c) = body.as_bytes().first() else {
        return false;
    };
    matches!(c, b'=' | b'-') && body.bytes().all(|b| b == c)
}

/// Whether a line begins a block quote, ATX heading, fenced code block, thematic break
/// or list item, as CommonMark defines them (spec 2.3, 2.4).
pub fn starts_block(line: &str) -> bool {
    let n = leading_spaces(line);
    if n > 3 {
        return false;
    }
    let rest = &line[n..];
    let b = rest.as_bytes();
    let Some(&first) = b.first() else {
        return false;
    };
    let run = b.iter().take_while(|&&c| c == first).count();
    match first {
        b'>' => true,
        b'#' => run <= 6 && space_or_end(rest, run),
        b'`' | b'~' => run >= 3,
        _ => is_thematic_break(rest) || is_list_marker(rest),
    }
}

/// `([-*_])(?:[ \t]*\1){2,}[ \t]*$`: three or more of the same character, with spaces
/// and tabs between them.
fn is_thematic_break(rest: &str) -> bool {
    let body = rest.strip_suffix('\n').unwrap_or(rest);
    let Some(&c) = body.as_bytes().first() else {
        return false;
    };
    matches!(c, b'-' | b'*' | b'_')
        && body.bytes().all(|b| b == c || b == b' ' || b == b'\t')
        && body.bytes().filter(|&b| b == c).count() >= 3
}

/// `(?:[-+*]|[0-9]{1,9}[.)])(?:[ \t]|$)`: a bullet or ordered list marker.
fn is_list_marker(rest: &str) -> bool {
    let b = rest.as_bytes();
    match b.first() {
        Some(b'-' | b'+' | b'*') => space_or_end(rest, 1),
        _ => {
            let digits = b.iter().take_while(|c| c.is_ascii_digit()).count();
            (1..=9).contains(&digits)
                && matches!(b.get(digits), Some(b'.' | b')'))
                && space_or_end(rest, digits + 1)
        }
    }
}

/// Whether a table body ends before this line (spec 2.4): the line is blank, indented
/// as code, or begins another block.
pub fn ends_table_body(line: &str) -> bool {
    strip_spaces(line).is_empty() || indentation(line) >= 4 || starts_block(line)
}

/// The alignment a delimiter cell sets (spec 2.2).
pub(crate) fn alignment(cell: &str) -> Option<Align> {
    match (cell.starts_with(':'), cell.ends_with(':')) {
        (true, true) => Some(Align::Center),
        (false, true) => Some(Align::Right),
        (true, false) => Some(Align::Left),
        (false, false) => None,
    }
}

/// A span value from an attribute (spec 2.6).
#[derive(Clone, Debug)]
pub(crate) struct SpanValue {
    /// The value, saturated at `usize::MAX`.
    pub value: usize,
    /// The value in decimal, without leading zeros (shown in messages).
    pub shown: String,
}

/// A parsed span attribute (spec 2.6).
#[derive(Clone, Debug)]
pub(crate) struct Attribute {
    pub colspan: Option<SpanValue>,
    pub rowspan: Option<SpanValue>,
    /// V1 problems found in the attribute.
    pub problems: Vec<String>,
}

/// `[cr]:[0-9]+(?:,[cr]:[0-9]+)*`, the inside of a span attribute.
fn is_attribute_body(body: &str) -> bool {
    body.split(',').all(|spec| {
        let b = spec.as_bytes();
        b.len() >= 3
            && matches!(b[0], b'c' | b'r')
            && b[1] == b':'
            && b[2..].iter().all(u8::is_ascii_digit)
    })
}

/// The byte index of the `{` of a span-attribute-shaped suffix `{c:N,...}` of `text`,
/// without looking at what precedes it.
fn attribute_brace(text: &str) -> Option<usize> {
    if !text.ends_with('}') {
        return None;
    }
    let open = text.rfind('{')?;
    is_attribute_body(&text[open + 1..text.len() - 1]).then_some(open)
}

/// The byte index where a trailing span attribute begins: it ends the cell and is the
/// whole cell or follows a space or tab (spec 2.6).
pub(crate) fn find_span_attribute(text: &str) -> Option<usize> {
    let open = attribute_brace(text)?;
    (open == 0 || matches!(text.as_bytes()[open - 1], b' ' | b'\t')).then_some(open)
}

fn span_value(digits: &str) -> SpanValue {
    let trimmed = digits.trim_start_matches('0');
    let shown = if trimmed.is_empty() { "0" } else { trimmed };
    let value = shown.bytes().fold(0usize, |n, d| {
        n.saturating_mul(10).saturating_add(usize::from(d - b'0'))
    });
    SpanValue {
        value,
        shown: shown.to_string(),
    }
}

/// Remove a trailing span attribute from a content cell (spec 2.6).
///
/// Returns the remaining text and the attribute, or `(text, None)` if there is none.
pub(crate) fn split_attribute(text: &str) -> (&str, Option<Attribute>) {
    let Some(open) = find_span_attribute(text) else {
        return (text, None);
    };
    let mut attr = Attribute {
        colspan: None,
        rowspan: None,
        problems: Vec::new(),
    };
    for spec in text[open + 1..text.len() - 1].split(',') {
        let (key, digits) = spec.split_at(1);
        let digits = &digits[1..];
        let mut n = span_value(digits);
        if n.value < 1 {
            attr.problems.push(format!(
                "span value must be a positive integer, got {digits}"
            ));
            n = SpanValue {
                value: 1,
                shown: "1".to_string(),
            };
        }
        let slot = if key == "c" {
            &mut attr.colspan
        } else {
            &mut attr.rowspan
        };
        if slot.is_some() {
            attr.problems
                .push(format!("'{key}' appears more than once"));
            continue;
        }
        *slot = Some(n);
    }
    (rstrip_spaces(&text[..open]), Some(attr))
}

/// Remove the backslash of an LTEM escape (spec 4.3), as GFM does for `\|`.
fn unescape_ltem(line: &str) -> String {
    if line == "\\<<" || line == "\\^^" {
        return line[1..].to_string();
    }
    if let Some(open) = attribute_brace(line) {
        let b = line.as_bytes();
        if open >= 1 && b[open - 1] == b'\\' && (open == 1 || matches!(b[open - 2], b' ' | b'\t')) {
            return format!("{}{}", &line[..open - 1], &line[open..]);
        }
    }
    line.to_string()
}

/// Turn cell source into model text (spec Section 7).
///
/// Split at each `\\`, trim each line and remove LTEM escapes.
pub(crate) fn cell_lines(text: &str) -> String {
    text.split("\\\\")
        .map(|part| unescape_ltem(strip_spaces(part)))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_rows() {
        assert_eq!(split_row("| a | b |"), ["a", "b"]);
        assert_eq!(split_row("a | b"), ["a", "b"]);
        assert_eq!(split_row("| a \\| b |"), ["a | b"]);
        assert_eq!(split_row("| a \\|"), ["a |"]);
        assert_eq!(split_row("||"), [""]);
        assert_eq!(split_row("|　x |"), ["　x"]);
    }

    #[test]
    fn row_spans() {
        let line = "  | a | \\| b |  |{c:2}|";
        let spans = split_row_spans(line);
        let got: Vec<(&str, &str)> = spans
            .iter()
            .map(|(t, s, e)| (t.as_str(), &line[*s..*e]))
            .collect();
        assert_eq!(
            got,
            [("a", "a"), ("| b", "\\| b"), ("", ""), ("{c:2}", "{c:2}")]
        );
        assert_eq!((spans[2].1, spans[2].2), (16, 16)); // the end of the empty cell's space
        let line = "가 |　x ";
        let spans = split_row_spans(line);
        assert_eq!(&line[spans[1].1..spans[1].2], "　x");
    }

    #[test]
    fn delimiter_rows() {
        assert!(is_delimiter_row("|---|:-:|--:|"));
        assert!(is_delimiter_row("-|-"));
        assert!(!is_delimiter_row("- | -"));
        assert!(!is_delimiter_row("    |---|"));
        assert!(!is_delimiter_row("|---|x|"));
        assert!(!is_delimiter_row("|:|"));
        assert!(!is_delimiter_row("---"));
    }

    #[test]
    fn blocks() {
        for line in [
            "> q",
            "# h",
            "###### h",
            "#",
            "```",
            "~~~ x",
            "- - -",
            "***",
            "___ ",
            "- x",
            "-",
            "1. x",
            "123456789) x",
        ] {
            assert!(starts_block(line), "{line:?}");
        }
        for line in [
            "####### h",
            "#h",
            "``",
            "-x",
            "1234567890. x",
            "    > q",
            "\t> q",
            "--",
            "1.x",
            "| a |",
        ] {
            assert!(!starts_block(line), "{line:?}");
        }
    }

    #[test]
    fn identifier_rows() {
        assert!(is_identifier_row("| # orders |"));
        assert!(is_identifier_row("   |#\tx_1|  "));
        assert!(!is_identifier_row("| #orders |"));
        assert!(!is_identifier_row("| # 1x |"));
        assert!(!is_identifier_row("    | # x |"));
    }

    #[test]
    fn attributes() {
        let (text, attr) = split_attribute("Revenue {c:2,r:3}");
        let attr = attr.unwrap();
        assert_eq!(text, "Revenue");
        assert_eq!(attr.colspan.unwrap().value, 2);
        assert_eq!(attr.rowspan.unwrap().value, 3);
        assert!(split_attribute("x{c:2}").1.is_none());
        assert!(split_attribute("x {c: 2}").1.is_none());
        let (_, attr) = split_attribute("{c:0,c:3}");
        assert_eq!(attr.unwrap().problems.len(), 2);
        let (_, attr) = split_attribute("{c:99999999999999999999999}");
        let c = attr.unwrap().colspan.unwrap();
        assert_eq!(
            (c.value, c.shown.as_str()),
            (usize::MAX, "99999999999999999999999")
        );
    }

    #[test]
    fn cell_text() {
        assert_eq!(cell_lines("a \\\\ b"), "a\nb");
        assert_eq!(cell_lines("\\<<"), "<<");
        assert_eq!(cell_lines("x \\{c:2}"), "x {c:2}");
        assert_eq!(cell_lines("x\\{c:2}"), "x\\{c:2}");
        assert_eq!(cell_lines("\\{c:2}"), "{c:2}");
    }
}
