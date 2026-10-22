//! Shared helpers for the integration tests of the Rust host adapters (also used by
//! `mdbook-ltem` and `comrak-ltem`): the conformance cases, the HTML normalization of
//! `conformance/tools/run.py`, a seeded random number generator and a random LTEM
//! document generator.
#![allow(dead_code)]

use std::path::PathBuf;

use serde_json::Value;

/// One example of `conformance/cases/spec-examples.json`.
pub struct Example {
    pub number: u64,
    pub section: String,
    pub ltem: String,
    pub html: String,
}

/// The examples of the specification.
pub fn examples() -> Vec<Example> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../conformance/cases/spec-examples.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let data: Value = serde_json::from_str(&text).expect("valid JSON");
    data["examples"]
        .as_array()
        .expect("examples")
        .iter()
        .map(|ex| Example {
            number: ex["example"].as_u64().unwrap(),
            section: ex["section"].as_str().unwrap().to_string(),
            ltem: ex["ltem"].as_str().unwrap().to_string(),
            html: ex["html"].as_str().unwrap().to_string(),
        })
        .collect()
}

// -- HTML normalization ------------------------------------------------------------------

/// An HTML token for comparison (see "HTML is normalized" in conformance/README.md).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Token {
    Start(String, Vec<(String, Option<String>)>),
    End(String),
    Text(String),
}

const ASCII_WS: [char; 5] = [' ', '\t', '\n', '\r', '\x0c'];

/// Decode character references, as an HTML parser does for the references that
/// Markdown renderers write.
pub fn decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let decoded = rest.find(';').filter(|&e| e <= 12).and_then(|e| {
            let name = &rest[1..e];
            let c = match name {
                "amp" => '&',
                "lt" => '<',
                "gt" => '>',
                "quot" => '"',
                "apos" => '\'',
                "nbsp" => '\u{a0}',
                _ if name.starts_with("#x") || name.starts_with("#X") => {
                    char::from_u32(u32::from_str_radix(&name[2..], 16).ok()?)?
                }
                _ if name.starts_with('#') => char::from_u32(name[1..].parse().ok()?)?,
                _ => return None,
            };
            Some((c, e + 1))
        });
        match decoded {
            Some((c, len)) => {
                out.push(c);
                rest = &rest[len..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn push_text(raw: &str, pre: usize, tokens: &mut Vec<Token>) {
    let text = decode(raw);
    let trimmed = text.trim_matches(ASCII_WS);
    if trimmed.is_empty() {
        return;
    }
    let text = if pre > 0 {
        trimmed.to_string()
    } else {
        trimmed
            .split(ASCII_WS)
            .filter(|w| !w.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    };
    tokens.push(Token::Text(text));
}

/// The attributes of a start tag: names lowercased, values decoded, `style` holding
/// only a `text-align` declaration read as `align`, sorted.
fn attributes(mut s: &str) -> Vec<(String, Option<String>)> {
    let mut attrs = Vec::new();
    loop {
        s = s.trim_start_matches(|c: char| c.is_ascii_whitespace() || c == '/');
        if s.is_empty() {
            break;
        }
        let name_end = s
            .find(|c: char| c.is_ascii_whitespace() || c == '=' || c == '/')
            .unwrap_or(s.len());
        let name = s[..name_end].to_ascii_lowercase();
        s = s[name_end..].trim_start();
        let mut value = None;
        if let Some(rest) = s.strip_prefix('=') {
            let rest = rest.trim_start();
            let (v, after) = match rest.chars().next() {
                Some(q @ ('"' | '\'')) => {
                    let close = rest[1..].find(q).map_or(rest.len(), |e| e + 1);
                    (&rest[1..close], rest.get(close + 1..).unwrap_or(""))
                }
                _ => {
                    let end = rest
                        .find(|c: char| c.is_ascii_whitespace())
                        .unwrap_or(rest.len());
                    (&rest[..end], &rest[end..])
                }
            };
            value = Some(decode(v));
            s = after;
        }
        let align = (name == "style")
            .then(|| value.as_deref().and_then(text_align))
            .flatten();
        match align {
            Some(a) => attrs.push(("align".to_string(), Some(a))),
            None => attrs.push((name, value)),
        }
    }
    attrs.sort();
    attrs
}

/// `text-align: X` (with optional spaces and semicolon) as `X`.
fn text_align(style: &str) -> Option<String> {
    let rest = style.trim().strip_prefix("text-align")?.trim_start();
    let value = rest.strip_prefix(':')?.trim().trim_end_matches(';').trim();
    matches!(value, "left" | "center" | "right").then(|| value.to_string())
}

/// Token list of an HTML fragment. Comments are skipped, as Python's `HTMLParser`
/// does when it has no comment handler.
pub fn normalize(html: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut pre = 0usize;
    let mut rest = html;
    let mut text = String::new();
    while let Some(i) = rest.find('<') {
        text.push_str(&rest[..i]);
        rest = &rest[i..];
        if let Some(after) = rest.strip_prefix("<!--") {
            let end = after.find("-->").map_or(after.len(), |e| e + 3);
            rest = &after[end..];
            continue;
        }
        let bytes = rest.as_bytes();
        let closing = bytes.get(1) == Some(&b'/');
        let name_start = if closing { 2 } else { 1 };
        if !bytes.get(name_start).is_some_and(u8::is_ascii_alphabetic) {
            text.push('<');
            rest = &rest[1..];
            continue;
        }
        // The end of the tag, skipping quoted attribute values.
        let mut end = None;
        let mut quote = None;
        for (k, c) in rest.char_indices().skip(1) {
            match (quote, c) {
                (Some(q), c) if c == q => quote = None,
                (Some(_), _) => {}
                (None, '"' | '\'') => quote = Some(c),
                (None, '>') => {
                    end = Some(k);
                    break;
                }
                _ => {}
            }
        }
        let Some(end) = end else {
            text.push('<');
            rest = &rest[1..];
            continue;
        };
        push_text(&std::mem::take(&mut text), pre, &mut tokens);
        let inner = &rest[name_start..end];
        rest = &rest[end + 1..];
        let name_end = inner
            .find(|c: char| c.is_ascii_whitespace() || c == '/')
            .unwrap_or(inner.len());
        let name = inner[..name_end].to_ascii_lowercase();
        if closing {
            if name == "pre" {
                pre = pre.saturating_sub(1);
            }
            if name != "br" {
                tokens.push(Token::End(name));
            }
            continue;
        }
        if name == "pre" {
            pre += 1;
        }
        tokens.push(Token::Start(name.clone(), attributes(&inner[name_end..])));
        if name == "br" {
            tokens.push(Token::End(name));
        }
    }
    text.push_str(rest);
    push_text(&text, pre, &mut tokens);
    tokens
}

/// The `<table>` elements of an HTML document.
pub fn tables_only(html: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find("<table>") {
        let end = rest[i..]
            .find("</table>")
            .map_or(rest.len(), |e| i + e + "</table>".len());
        out.push(&rest[i..end]);
        rest = &rest[end..];
    }
    out
}

/// Tokens without empty `<tbody>` elements: some hosts write one for a GFM table
/// without body rows, the LTEM specification writes none.
pub fn drop_empty_tbody(tokens: Vec<Token>) -> Vec<Token> {
    let mut out: Vec<Token> = Vec::with_capacity(tokens.len());
    for token in tokens {
        if token == Token::End("tbody".to_string())
            && out.last() == Some(&Token::Start("tbody".to_string(), Vec::new()))
        {
            out.pop();
            continue;
        }
        out.push(token);
    }
    out
}

/// The normalized `<table>` elements of an HTML document, without empty `<tbody>`.
pub fn table_tokens(html: &str) -> Vec<Vec<Token>> {
    tables_only(html)
        .into_iter()
        .map(|t| drop_empty_tbody(normalize(t)))
        .collect()
}

// -- random numbers and documents ----------------------------------------------------------

/// A small deterministic random number generator (SplitMix64).
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// A float in [0, 1).
    pub fn random(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// An integer in lo..=hi.
    pub fn randint(&mut self, lo: usize, hi: usize) -> usize {
        lo + (self.next_u64() % (hi - lo + 1) as u64) as usize
    }

    pub fn choice<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.randint(0, items.len() - 1)]
    }
}

/// Cells of random rows: LTEM notation, escapes, line breaks and inline markup.
pub const CELLS: [&str; 37] = [
    "",
    "x",
    "Revenue",
    "<<",
    "^^",
    "<<",
    "^^",
    "a {c:2}",
    "{c:2}",
    "b {r:2}",
    "{r:3}",
    "c {c:2,r:2}",
    "d {r:2,c:3}",
    "{c:0}",
    "e {c:1,c:2}",
    "f {r:0}",
    "\\<<",
    "\\^^",
    "x \\{c:2}",
    "a \\\\ b",
    "l1 \\\\ l2 \\\\ l3",
    "p \\| q",
    "**b**",
    "-",
    ":-:",
    "# id",
    "a << b",
    "$5 ~ $10",
    "x\t{c:2}",
    "{c:99}",
    "{r:99}",
    "z {c:2}",
    "\\\\\\",
    "\u{3000}y\u{3000}",
    "*e*",
    "`a \\| b`",
    "[l](u)",
];
const SAFE_FIRST: [&str; 4] = ["x", "Revenue", "z {c:2}", "a {c:2}"];
const DELIMITERS: [&str; 5] = ["---", ":--", "--:", ":-:", "-"];

fn random_row(rng: &mut Rng, n: usize) -> String {
    let lead = rng.random() > 0.1;
    let cells: Vec<&str> = (0..n)
        .map(|i| {
            if i == 0 && !lead {
                *rng.choice(&SAFE_FIRST)
            } else {
                *rng.choice(&CELLS)
            }
        })
        .collect();
    let indent = *rng.choice(&["", "", "", " ", "   "]);
    let trail = if rng.random() > 0.1 { " |" } else { "" };
    format!(
        "{indent}{}{}{trail}",
        if lead { "| " } else { "" },
        cells.join(" | ")
    )
}

fn random_delimiter(rng: &mut Rng, n: usize) -> String {
    let cells: Vec<&str> = (0..n).map(|_| *rng.choice(&DELIMITERS)).collect();
    format!("|{}|", cells.join("|"))
}

fn random_table_lines(rng: &mut Rng) -> Vec<String> {
    let cols = rng.randint(1, 5);
    let width =
        |rng: &mut Rng| (cols as isize + *rng.choice(&[0, 0, 0, -1, 1, -2])).max(1) as usize;
    let mut lines = Vec::new();
    if rng.random() < 0.3 {
        lines.push(
            rng.choice(&["Some text", "| # orders |", "plain | pipe", "| p |"])
                .to_string(),
        );
    }
    for _ in 0..rng.randint(1, 3) {
        let n = width(rng);
        lines.push(random_row(rng, n));
        if rng.random() < 0.1 {
            let n = width(rng);
            lines.push(random_delimiter(rng, n)); // a delimiter row that may be rejected
        }
    }
    lines.push(random_delimiter(rng, cols));
    if rng.random() < 0.1 {
        let n = width(rng);
        lines.push(random_delimiter(rng, n));
    }
    for _ in 0..rng.randint(0, 5) {
        if rng.random() < 0.05 {
            lines.push("\u{3000}".to_string());
        } else {
            let n = width(rng);
            lines.push(random_row(rng, n));
        }
    }
    if rng.random() < 0.3 {
        lines.push(
            rng.choice(&[
                "# Next", "> quote", "- item", "1. item", "***", "- - -", "    code", "- | -",
            ])
            .to_string(),
        );
    }
    lines
}

/// A random document: blocks separated by blank lines, built from constructs on which
/// a full CommonMark parser and the core's light scan (`ltem::find_tables`) agree by
/// design: no HTML blocks, and a list is closed by a paragraph before the next block
/// (a list item would take in an indented block after a blank line).
pub fn random_document(rng: &mut Rng) -> String {
    let mut blocks: Vec<String> = Vec::new();
    for _ in 0..rng.randint(1, 5) {
        let kind = rng.random();
        if kind < 0.7 {
            let lines = random_table_lines(rng);
            let last = lines.last().unwrap().clone();
            blocks.push(lines.join("\n"));
            if last.starts_with("- ") || last.starts_with("1. ") {
                blocks.push("End of list".to_string());
            }
        } else if kind < 0.8 {
            blocks.push(
                rng.choice(&[
                    "```\n| a |\n|---|\n```",
                    "````\n```\n| a |\n|---|\n````",
                    "~~~\n```js\n| a |\n|---|\n~~~~  ",
                ])
                .to_string(),
            );
        } else if kind < 0.9 {
            blocks.push("# Heading\n| a | b |\n|---|---|".to_string());
        } else {
            blocks.push("Some text\nmore text".to_string());
        }
    }
    blocks.join("\n\n") + "\n"
}

/// Put every line of a document into containers: `first` prefixes the first line,
/// `rest` every other line, and `blank` replaces blank lines.
pub fn wrap(doc: &str, first: &str, rest: &str, blank: &str) -> String {
    let mut out = String::new();
    for (i, line) in doc.split_inclusive('\n').enumerate() {
        let (text, end) = match line.strip_suffix('\n') {
            Some(t) => (t, "\n"),
            None => (line, ""),
        };
        if text.trim_matches([' ', '\t']).is_empty() {
            out.push_str(blank);
        } else {
            out.push_str(if i == 0 { first } else { rest });
            out.push_str(text);
        }
        out.push_str(end);
    }
    out
}
