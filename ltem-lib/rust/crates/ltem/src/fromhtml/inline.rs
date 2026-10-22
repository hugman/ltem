//! Cell content: HTML elements to inline Markdown, one line per line break.

use super::tree::{Child, Tree};
use super::InlineFormat;
use crate::pychar::{is_alnum, is_alpha, is_space, strip};

/// Elements that start a new line.
const BLOCK: [&str; 23] = [
    "p",
    "div",
    "li",
    "ul",
    "ol",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "pre",
    "section",
    "article",
    "header",
    "footer",
    "dl",
    "dt",
    "dd",
    "figure",
    "figcaption",
    "table",
];

/// HTML's ASCII whitespace. HTML collapses only these; other spaces, such as U+3000, are
/// content (spec 2.1).
fn is_html_space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\x0c' | '\r')
}

/// Remove leading and trailing HTML whitespace.
fn strip_html_spaces(s: &str) -> &str {
    s.trim_matches(is_html_space)
}

/// Replace each run of HTML whitespace by one space.
fn collapse_html_spaces(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_space = false;
    for c in s.chars() {
        if is_html_space(c) {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    out
}

/// `&` followed by what CommonMark reads as a character reference:
/// `&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);`.
fn starts_char_reference(chars: &[char]) -> bool {
    let rest = &chars[1..];
    let (body, digit): (&[char], fn(&char) -> bool) = match rest {
        ['#', 'x' | 'X', body @ ..] if body.first().is_some_and(char::is_ascii_hexdigit) => {
            (body, char::is_ascii_hexdigit)
        }
        ['#', body @ ..] => (body, char::is_ascii_digit),
        [first, ..] if first.is_ascii_alphabetic() => (rest, char::is_ascii_alphanumeric),
        _ => return false,
    };
    let len = body.iter().take_while(|c| digit(c)).count();
    len > 0 && body.get(len) == Some(&';')
}

/// Escape text so that CommonMark reads it literally and LTEM sees no line break.
pub(crate) fn escape_text(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    for (i, &ch) in chars.iter().enumerate() {
        let next = chars.get(i + 1).copied();
        let prev = i.checked_sub(1).map(|p| chars[p]);
        match ch {
            // A backslash before punctuation would be an escape, and "\\" an LTEM line break.
            // At the end of the text, what follows is not known yet (`cell_text` undoes this
            // at the end of a line).
            '\\' if next.is_none_or(|n| !is_alnum(n) && !is_space(n)) => out.push_str("&#92;"),
            '*' | '`' | '[' | ']' => {
                out.push('\\');
                out.push(ch);
            }
            '_' if !(prev.is_some_and(is_alnum) && next.is_some_and(is_alnum)) => {
                out.push_str("\\_")
            }
            '<' if next.is_some_and(|n| is_alpha(n) || matches!(n, '/' | '!' | '?')) => {
                out.push_str("\\<")
            }
            '&' if starts_char_reference(&chars[i..]) => out.push_str("\\&"),
            _ => out.push(ch),
        }
    }
    out
}

/// Put `mark` around the text, outside its leading and trailing whitespace.
///
/// Unicode whitespace (U+3000 too) goes outside the marks, because CommonMark does not
/// open or close emphasis next to it; the whitespace itself is kept.
fn wrap(mark: &str, text: &str) -> String {
    let stripped = strip(text);
    if stripped.is_empty() {
        return text.to_string();
    }
    let lead = &text[..text.len() - text.trim_start_matches(is_space).len()];
    let trail = &text[text.trim_end_matches(is_space).len()..];
    format!("{lead}{mark}{stripped}{mark}{trail}")
}

/// What to do with the inline Markdown of an element once it is complete.
enum Wrap {
    /// Use it as it is.
    Plain,
    /// Put it on lines of its own.
    Block,
    /// A list item with this bullet.
    Item(String),
    /// Emphasis, strong emphasis or strikethrough.
    Mark(&'static str),
    /// A link to this destination.
    Link(String),
    /// `<sup>` or `<sub>`, kept as raw HTML.
    Tag(&'static str),
}

/// The inline Markdown of an element, being built.
struct ElementFrame {
    node: usize,
    next: usize,
    /// List items among the children visited so far.
    items: usize,
    out: String,
    wrap: Wrap,
}

/// A table inside a cell, being flattened to one line per row.
struct TableFrame {
    rows: Vec<Vec<usize>>,
    row: usize,
    col: usize,
    cells: Vec<String>,
    lines: Vec<String>,
}

enum Frame {
    Element(ElementFrame),
    Table(TableFrame),
}

fn element(node: usize, wrap: Wrap) -> Frame {
    Frame::Element(ElementFrame {
        node,
        next: 0,
        items: 0,
        out: String::new(),
        wrap,
    })
}

impl ElementFrame {
    fn finish(self) -> String {
        match self.wrap {
            Wrap::Plain => self.out,
            Wrap::Block => format!("\n{}\n", self.out),
            Wrap::Item(bullet) => format!("\n{bullet}{}\n", strip_html_spaces(&self.out)),
            Wrap::Mark(mark) => wrap(mark, &self.out),
            Wrap::Link(href) => {
                format!("[{}]({})", strip_html_spaces(&self.out), destination(&href))
            }
            Wrap::Tag(tag) => format!("<{tag}>{}</{tag}>", strip_html_spaces(&self.out)),
        }
    }
}

/// Inline Markdown for the children of `node`. Line breaks are `"\n"`.
///
/// The elements are visited with an explicit stack, so deep nesting is safe.
fn inline(tree: &Tree, node: usize, format: InlineFormat, warnings: &mut Vec<String>) -> String {
    let markdown = format == InlineFormat::Markdown;
    let mut stack = vec![element(node, Wrap::Plain)];
    loop {
        let top = stack
            .last_mut()
            .expect("the stack holds the cell until it is done");
        let push = match top {
            Frame::Element(f) => {
                let parent = tree.node(f.node);
                let Some(child) = parent.children.get(f.next) else {
                    let done = match stack.pop() {
                        Some(Frame::Element(f)) => f.finish(),
                        _ => unreachable!(),
                    };
                    match stack.last_mut() {
                        None => return done,
                        Some(Frame::Element(p)) => p.out.push_str(&done),
                        Some(Frame::Table(t)) => {
                            t.cells
                                .push(strip_html_spaces(&done.replace('\n', " ")).to_string());
                            t.col += 1;
                        }
                    }
                    continue;
                };
                f.next += 1;
                let c = match child {
                    Child::Text(s) => {
                        f.out.push_str(&escape_text(&collapse_html_spaces(s)));
                        continue;
                    }
                    Child::Node(c) => *c,
                };
                let el = tree.node(c);
                match el.tag.as_str() {
                    "br" => {
                        f.out.push('\n');
                        None
                    }
                    "table" => {
                        warnings.push(
                            "a table inside a cell was flattened to text (not supported in LTEM 1.0)".to_string(),
                        );
                        let rows = tree
                            .find_all(c, "tr", &[])
                            .into_iter()
                            .map(|tr| tree.cells(tr))
                            .collect();
                        Some(Frame::Table(TableFrame {
                            rows,
                            row: 0,
                            col: 0,
                            cells: Vec::new(),
                            lines: Vec::new(),
                        }))
                    }
                    "li" => {
                        f.items += 1;
                        let bullet = if parent.tag == "ol" {
                            format!("{}. ", f.items)
                        } else {
                            "- ".to_string()
                        };
                        Some(element(c, Wrap::Item(bullet)))
                    }
                    tag if BLOCK.contains(&tag) => Some(element(c, Wrap::Block)),
                    "strong" | "b" if markdown => Some(element(c, Wrap::Mark("**"))),
                    "em" | "i" if markdown => Some(element(c, Wrap::Mark("*"))),
                    "s" | "del" | "strike" if markdown => Some(element(c, Wrap::Mark("~~"))),
                    "code" if markdown => {
                        let text = tree.text_content(c);
                        if text.contains("\\\\") {
                            // A code span cannot escape a backslash, and LTEM 1.0 reads "\\"
                            // as a line break.
                            warnings.push(
                                "a code span with two backslashes in a row became plain text; \
                                 LTEM 1.0 cell text cannot hold \\\\"
                                    .to_string(),
                            );
                            f.out.push_str(&escape_text(&text));
                        } else if !text.is_empty() {
                            let fence = if text.contains('`') { "``" } else { "`" };
                            f.out.push_str(&format!("{fence}{text}{fence}"));
                        }
                        None
                    }
                    "a" if markdown && el.attr("href").is_some_and(|h| !h.is_empty()) => {
                        Some(element(
                            c,
                            Wrap::Link(el.attr("href").unwrap_or_default().to_string()),
                        ))
                    }
                    "img" => {
                        let alt = escape_text(el.attr("alt").unwrap_or_default());
                        if markdown {
                            f.out.push_str(&format!(
                                "![{alt}]({})",
                                destination(el.attr("src").unwrap_or_default())
                            ));
                        } else {
                            f.out.push_str(&alt);
                        }
                        None
                    }
                    "code" => {
                        // Plain text: the code's text, escaped so that it reads literally.
                        f.out.push_str(&escape_text(&tree.text_content(c)));
                        None
                    }
                    "sup" if markdown => Some(element(c, Wrap::Tag("sup"))),
                    "sub" if markdown => Some(element(c, Wrap::Tag("sub"))),
                    _ => Some(element(c, Wrap::Plain)),
                }
            }
            Frame::Table(t) => {
                if let Some(cells) = t.rows.get(t.row) {
                    if let Some(&td) = cells.get(t.col) {
                        Some(element(td, Wrap::Plain))
                    } else {
                        t.lines.push(t.cells.join("; "));
                        t.cells.clear();
                        t.row += 1;
                        t.col = 0;
                        None
                    }
                } else {
                    let done = match stack.pop() {
                        Some(Frame::Table(t)) => format!("\n{}\n", t.lines.join("\n")),
                        _ => unreachable!(),
                    };
                    match stack.last_mut() {
                        Some(Frame::Element(p)) => p.out.push_str(&done),
                        // A table frame only ever sits on an element frame.
                        _ => unreachable!(),
                    }
                    None
                }
            }
        };
        if let Some(frame) = push {
            stack.push(frame);
        }
    }
}

/// Model text of a cell: inline Markdown, one line per line break, no empty lines.
pub(crate) fn cell_text(
    tree: &Tree,
    td: usize,
    format: InlineFormat,
    warnings: &mut Vec<String>,
) -> String {
    let text = inline(tree, td, format, warnings);
    let lines: Vec<String> = text
        .split('\n')
        .map(|line| line_end(strip_html_spaces(&collapse_html_spaces(line))))
        .filter(|l| !l.is_empty())
        .collect();
    lines.join("\n")
}

/// Write a backslash that ends a line as itself: nothing follows it there.
fn line_end(line: &str) -> String {
    match line.strip_suffix("&#92;") {
        Some(rest) if !rest.ends_with('\\') => format!("{rest}\\"),
        _ => line.to_string(),
    }
}

/// A link destination with its backslashes as character references. CommonMark reads a
/// backslash in a destination as an escape, and LTEM reads `\\` as a line break; a
/// character reference keeps the backslash.
fn destination(url: &str) -> String {
    url.replace('\\', "&#92;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes() {
        assert_eq!(
            escape_text(r"a*b* _c_ snake_case [x] <b> &amp; C:\dir \* $5"),
            r"a\*b\* \_c\_ snake_case \[x\] \<b> \&amp; C:\dir &#92;\* $5"
        );
        assert_eq!(
            escape_text("&#12; &#x1F; &#xg; &a1;"),
            "\\&#12; \\&#x1F; &#xg; \\&a1;"
        );
    }
}
