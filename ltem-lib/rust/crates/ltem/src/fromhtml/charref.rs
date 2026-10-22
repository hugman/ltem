//! Decoding HTML character references, as the HTML Standard and Python's
//! `html.unescape` do.

use super::entities::ENTITIES;

/// The replacement for a named reference (with or without its `;`), if it exists.
fn named(name: &str) -> Option<&'static str> {
    ENTITIES
        .binary_search_by(|&(n, _)| n.cmp(name))
        .ok()
        .map(|i| ENTITIES[i].1)
}

/// Numeric references to code points that the HTML Standard replaces (0x80-0x9F are
/// read as Windows-1252).
fn invalid_charref(n: u64) -> Option<&'static str> {
    Some(match n {
        0x00 => "\u{fffd}",
        0x0d => "\r",
        0x80 => "\u{20ac}",
        0x81 => "\u{81}",
        0x82 => "\u{201a}",
        0x83 => "\u{192}",
        0x84 => "\u{201e}",
        0x85 => "\u{2026}",
        0x86 => "\u{2020}",
        0x87 => "\u{2021}",
        0x88 => "\u{2c6}",
        0x89 => "\u{2030}",
        0x8a => "\u{160}",
        0x8b => "\u{2039}",
        0x8c => "\u{152}",
        0x8d => "\u{8d}",
        0x8e => "\u{17d}",
        0x8f => "\u{8f}",
        0x90 => "\u{90}",
        0x91 => "\u{2018}",
        0x92 => "\u{2019}",
        0x93 => "\u{201c}",
        0x94 => "\u{201d}",
        0x95 => "\u{2022}",
        0x96 => "\u{2013}",
        0x97 => "\u{2014}",
        0x98 => "\u{2dc}",
        0x99 => "\u{2122}",
        0x9a => "\u{161}",
        0x9b => "\u{203a}",
        0x9c => "\u{153}",
        0x9d => "\u{9d}",
        0x9e => "\u{17e}",
        0x9f => "\u{178}",
        _ => return None,
    })
}

/// Code points that a numeric reference may not produce: they become nothing.
fn invalid_codepoint(n: u64) -> bool {
    matches!(n, 0x1..=0x8 | 0xb | 0xe..=0x1f | 0x7f..=0x9f | 0xfdd0..=0xfdef)
        || (n & 0xfffe == 0xfffe && n <= 0x10ffff)
}

fn numeric(out: &mut String, n: u64) {
    if let Some(s) = invalid_charref(n) {
        out.push_str(s);
    } else if (0xd800..=0xdfff).contains(&n) || n > 0x10ffff {
        out.push('\u{fffd}');
    } else if !invalid_codepoint(n) {
        out.extend(char::from_u32(n as u32));
    }
}

/// Parse digits in the given radix, saturating far above the Unicode range.
fn number(digits: &str, radix: u32) -> u64 {
    digits.chars().fold(0u64, |n, d| {
        n.saturating_mul(u64::from(radix))
            .saturating_add(u64::from(d.to_digit(radix).unwrap_or(0)))
            .min(1 << 40)
    })
}

/// Characters that may appear in the name part of a reference: `[^\t\n\f <&#;]`.
fn is_name_char(c: char) -> bool {
    !matches!(c, '\t' | '\n' | '\x0c' | ' ' | '<' | '&' | '#' | ';')
}

/// Decode one reference at the start of `s`, which begins with `&`. Returns the number
/// of bytes it takes, or `None` if `s` does not begin a reference.
fn decode_one(out: &mut String, s: &str) -> Option<usize> {
    let rest = &s[1..];
    if let Some(num) = rest.strip_prefix('#') {
        // &#[0-9]+;? and &#[xX][0-9a-fA-F]+;?
        let (radix, digits_from) = match num.as_bytes().first() {
            Some(b'x' | b'X') => (16, 1),
            _ => (10, 0),
        };
        let body = &num[digits_from..];
        let len = body
            .bytes()
            .take_while(|b| {
                if radix == 16 {
                    b.is_ascii_hexdigit()
                } else {
                    b.is_ascii_digit()
                }
            })
            .count();
        if len == 0 {
            // "&#x" without hex digits may still be "&#" + decimal digits: neither here.
            return None;
        }
        numeric(out, number(&body[..len], radix));
        let mut taken = 2 + digits_from + len;
        if s.as_bytes().get(taken) == Some(&b';') {
            taken += 1;
        }
        return Some(taken);
    }
    // [^\t\n\f <&#;]{1,32};?
    let name_len: usize = rest
        .chars()
        .take_while(|&c| is_name_char(c))
        .take(32)
        .map(char::len_utf8)
        .sum();
    if name_len == 0 {
        return None;
    }
    let mut name = &rest[..name_len];
    if rest.as_bytes().get(name_len) == Some(&b';') {
        name = &rest[..name_len + 1];
    }
    if let Some(value) = named(name) {
        out.push_str(value);
    } else {
        // The longest name that is a prefix of the reference, at least two characters
        // long; the rest stays text.
        let found = name
            .char_indices()
            .map(|(i, _)| i)
            .filter(|&i| i >= 2)
            .rev()
            .find_map(|i| named(&name[..i]).map(|value| (i, value)));
        match found {
            Some((i, value)) => {
                out.push_str(value);
                out.push_str(&name[i..]);
            }
            None => {
                out.push('&');
                out.push_str(name);
            }
        }
    }
    Some(1 + name.len())
}

/// Decode all character references in `s` (`html.unescape`).
pub(crate) fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while let Some(k) = s[i..].find('&') {
        out.push_str(&s[i..i + k]);
        i += k;
        match decode_one(&mut out, &s[i..]) {
            Some(taken) => i += taken,
            None => {
                out.push('&');
                i += 1;
            }
        }
    }
    out.push_str(&s[i..]);
    out
}

#[cfg(test)]
mod tests {
    use super::unescape;

    #[test]
    fn references() {
        assert_eq!(unescape("&amp; &lt;&gt &quot;"), "& <> \"");
        assert_eq!(
            unescape("&ampxyz &notit; &foo; &#65;&#x42 &#X43;"),
            "&xyz ¬it; &foo; AB C"
        );
        assert_eq!(
            unescape("&#0; &#128; &#1; &#xD800; &#99999999999; &#12a"),
            "\u{fffd} €  \u{fffd} \u{fffd} \u{c}a"
        );
        assert_eq!(unescape("&# &#x &; & x"), "&# &#x &; & x");
        assert_eq!(
            unescape("&NotNestedGreaterGreater; &nbsp"),
            "\u{2aa2}\u{338} \u{a0}"
        );
    }
}
