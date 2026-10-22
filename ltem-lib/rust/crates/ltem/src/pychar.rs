//! Character classes and conversions as Python defines them.
//!
//! The HTML converter and the problem messages follow the Python implementation of
//! LTEM exactly. These helpers reproduce the few Python string operations they rely on:
//! `str.isspace`, `str.isalpha`, `str.isalnum`, `str.strip()` and `repr()`.

use crate::pychar_tables::{ALNUM_EXTRA, ALPHA, PRINTABLE};

fn in_ranges(table: &[(u32, u32)], c: char) -> bool {
    let cp = u32::from(c);
    table
        .binary_search_by(|&(lo, hi)| {
            if hi < cp {
                std::cmp::Ordering::Less
            } else if lo > cp {
                std::cmp::Ordering::Greater
            } else {
                std::cmp::Ordering::Equal
            }
        })
        .is_ok()
}

/// `str.isspace()` for one character, which is also what `\s` matches in `re`.
pub(crate) fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t'..='\r'
            | '\x1c'..='\x20'
            | '\u{85}'
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
    )
}

/// `str.isalpha()` for one character.
pub(crate) fn is_alpha(c: char) -> bool {
    if c.is_ascii() {
        return c.is_ascii_alphabetic();
    }
    in_ranges(ALPHA, c)
}

/// `str.isalnum()` for one character.
pub(crate) fn is_alnum(c: char) -> bool {
    if c.is_ascii() {
        return c.is_ascii_alphanumeric();
    }
    in_ranges(ALPHA, c) || in_ranges(ALNUM_EXTRA, c)
}

fn is_printable(c: char) -> bool {
    if c.is_ascii() {
        return (' '..='~').contains(&c);
    }
    in_ranges(PRINTABLE, c)
}

/// `str.strip()` without arguments: remove leading and trailing whitespace.
pub(crate) fn strip(s: &str) -> &str {
    s.trim_matches(is_space)
}

/// `repr(s)` for a string, as shown in problem messages.
pub(crate) fn repr(s: &str) -> String {
    let quote = if s.contains('\'') && !s.contains('"') {
        '"'
    } else {
        '\''
    };
    let mut out = String::with_capacity(s.len() + 2);
    out.push(quote);
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            c if c == quote => {
                out.push('\\');
                out.push(c);
            }
            c if is_printable(c) => out.push(c),
            c if u32::from(c) <= 0xff => out.push_str(&format!("\\x{:02x}", u32::from(c))),
            c if u32::from(c) <= 0xffff => out.push_str(&format!("\\u{:04x}", u32::from(c))),
            c => out.push_str(&format!("\\U{:08x}", u32::from(c))),
        }
    }
    out.push(quote);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classes() {
        assert!(is_alpha('가') && is_alnum('가') && !is_alpha('1') && is_alnum('١'));
        assert!(!is_alnum('\u{e34}') && !is_alpha('Ⓐ'));
        assert!(is_space('\u{3000}') && is_space('\x1f') && !is_space('\u{200b}'));
    }

    #[test]
    fn reprs() {
        assert_eq!(repr("ab"), "'ab'");
        assert_eq!(repr("it's"), "\"it's\"");
        assert_eq!(repr("'\""), "'\\'\"'");
        assert_eq!(repr("a\tb\\"), "'a\\tb\\\\'");
        assert_eq!(repr("\u{3000}x\u{7f}가"), "'\\u3000x\\x7f가'");
    }
}
