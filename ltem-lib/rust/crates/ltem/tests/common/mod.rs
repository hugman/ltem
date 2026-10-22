//! Shared helpers for the integration tests.
#![allow(dead_code)]

use std::path::PathBuf;

use ltem::{Align, Cell, Table};
use serde_json::Value;

/// The LTEM repository root (four levels above this crate).
pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../..")
}

/// The examples of `conformance/cases/spec-examples.json`.
pub fn examples() -> Vec<Value> {
    let path = repo_root().join("conformance/cases/spec-examples.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let data: Value = serde_json::from_str(&text).expect("valid JSON");
    data["examples"].as_array().expect("examples").clone()
}

/// The table models expected by all examples.
pub fn example_tables() -> Vec<Table> {
    examples()
        .iter()
        .flat_map(|ex| ex["tables"].as_array().unwrap().clone())
        .map(|t| serde_json::from_value(t).expect("valid table model"))
        .collect()
}

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

/// Model texts: what a parser produces, so LTEM escapes are already removed.
pub const TEXTS: [&str; 15] = [
    "",
    "x",
    "Revenue",
    "**Q1**",
    "a | b",
    "line 1\nline 2",
    "\u{3000}indent",
    "<<",
    "^^",
    "a << b",
    "{c:2}",
    "x {r:3}",
    "$5 ~ $10",
    "-",
    "100",
];

/// A random valid table: spans fill free rectangles and stay within header or body.
pub fn random_table(rng: &mut Rng, rows: usize, cols: usize, header_rows: usize) -> Table {
    let mut taken = vec![vec![false; cols]; rows];
    let mut cells = Vec::new();
    for r in 0..rows {
        for c in 0..cols {
            if taken[r][c] {
                continue;
            }
            let bottom = if r < header_rows { header_rows } else { rows };
            let mut max_cs = 1;
            while c + max_cs < cols && !taken[r][c + max_cs] && max_cs < 4 {
                max_cs += 1;
            }
            let cs = if rng.random() < 0.3 {
                rng.randint(1, max_cs)
            } else {
                1
            };
            let mut rs = if rng.random() < 0.3 {
                rng.randint(1, 3.min(bottom - r))
            } else {
                1
            };
            while rs > 1 && taken[r + rs - 1][c..c + cs].iter().any(|&t| t) {
                rs -= 1;
            }
            for row in taken.iter_mut().skip(r).take(rs) {
                for slot in row.iter_mut().skip(c).take(cs) {
                    *slot = true;
                }
            }
            cells.push(Cell::new(r, c, rs, cs, *rng.choice(&TEXTS)));
        }
    }
    let aligns = [
        None,
        Some(Align::Left),
        Some(Align::Center),
        Some(Align::Right),
    ];
    let align = (0..cols).map(|_| *rng.choice(&aligns)).collect();
    Table::new(rows, cols, header_rows, align, cells)
}

/// The table with the CommonMark escapes the writer may add (`\-`, `\:`, `\#`) removed.
///
/// The writer escapes a header row made only of hyphen cells, and a first row that would
/// read as a reserved identifier line. Those escapes are ordinary CommonMark escapes, so
/// they stay in the text; they do not change how it renders.
pub fn normalized(mut table: Table) -> Table {
    for cell in &mut table.cells {
        if ["\\-", "\\:", "\\#"]
            .iter()
            .any(|p| cell.text.starts_with(p))
        {
            cell.text.remove(0);
        }
    }
    table
}

/// An HTML token for comparison, as `conformance/tools/run.py` normalizes HTML.
#[derive(Debug, PartialEq, Eq)]
pub enum Token {
    Start(String, Vec<(String, String)>),
    End(String),
    Text(String),
}

fn decode(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let end = rest.find(';').filter(|&e| e <= 10);
        let decoded = end.and_then(|e| {
            let name = &rest[1..e];
            let c = match name {
                "amp" => '&',
                "lt" => '<',
                "gt" => '>',
                "quot" => '"',
                "apos" => '\'',
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

fn text_token(raw: &str, tokens: &mut Vec<Token>) {
    let text = decode(raw);
    let words: Vec<&str> = text
        .split([' ', '\t', '\n', '\r', '\x0c'])
        .filter(|w| !w.is_empty())
        .collect();
    if !words.is_empty() {
        tokens.push(Token::Text(words.join(" ")));
    }
}

/// Tokens of an HTML fragment, for the simple HTML of tables: whitespace between tags is
/// ignored, character references are decoded, attributes are a set, `text-align`
/// styles count as `align`, and `<br>` equals `<br />`.
pub fn normalize(html: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find('<') {
        text_token(&rest[..i], &mut tokens);
        let end = rest[i..].find('>').map(|e| i + e).expect("closed tag");
        let inner = rest[i + 1..end].trim_end_matches('/').trim();
        rest = &rest[end + 1..];
        if let Some(name) = inner.strip_prefix('/') {
            if name != "br" {
                tokens.push(Token::End(name.to_string()));
            }
            continue;
        }
        let (name, mut attr_text) = inner.split_once(char::is_whitespace).unwrap_or((inner, ""));
        let mut attrs = Vec::new();
        loop {
            attr_text = attr_text.trim_start();
            if attr_text.is_empty() {
                break;
            }
            let (key, after) = attr_text.split_once('=').expect("attribute value");
            let after = &after[1..];
            let close = after.find('"').expect("quoted value");
            let (mut key, mut value) = (key.trim().to_string(), decode(&after[..close]));
            if key == "style" {
                if let Some(v) = value.strip_prefix("text-align:") {
                    (key, value) = (
                        "align".to_string(),
                        v.trim().trim_end_matches(';').to_string(),
                    );
                }
            }
            attrs.push((key, value));
            attr_text = &after[close + 1..];
        }
        attrs.sort();
        tokens.push(Token::Start(name.to_string(), attrs));
        if name == "br" {
            tokens.push(Token::End("br".to_string()));
        }
    }
    text_token(rest, &mut tokens);
    tokens
}

/// The `<table>` elements of an HTML document.
pub fn tables_only(html: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find("<table>") {
        let end = rest[i..]
            .find("</table>")
            .map(|e| i + e + "</table>".len())
            .expect("closed table");
        out.push(&rest[i..end]);
        rest = &rest[end..];
    }
    out
}
