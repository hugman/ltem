//! A forgiving HTML tokenizer.
//!
//! It reads HTML the way Python's `html.parser.HTMLParser` (with `convert_charrefs`)
//! does, so that the converter gives the same result as the Python implementation of
//! LTEM: start tags, end tags and text are reported in order; comments, declarations
//! and processing instructions are skipped; character references in text and attribute
//! values are decoded; the content of `script`, `style` and similar elements is raw
//! text; an unterminated construct at the end of the input is dropped.

use super::charref::unescape;
use crate::pychar;

/// Receives the tokens of a document.
pub(crate) trait Sink {
    /// `<tag ...>`. Names are lowercase; an attribute without a value has `None`.
    fn start_tag(&mut self, tag: String, attrs: Vec<(String, Option<String>)>);
    /// `<tag .../>`.
    fn start_end_tag(&mut self, tag: String, attrs: Vec<(String, Option<String>)>);
    /// `</tag>`.
    fn end_tag(&mut self, tag: String);
    /// Text, with character references decoded (except in raw text elements).
    fn data(&mut self, text: String);
}

/// Elements whose content is raw text, up to their end tag.
const RAW_TEXT: [&str; 6] = ["script", "style", "xmp", "iframe", "noembed", "noframes"];
/// Elements whose content is text with character references, up to their end tag.
const ESCAPABLE_RAW_TEXT: [&str; 2] = ["textarea", "title"];

/// `[\t\n\r\f ]`
fn is_space(b: u8) -> bool {
    matches!(b, b'\t' | b'\n' | b'\r' | b'\x0c' | b' ')
}

/// `[\t\n\r\f /]`
fn is_space_or_slash(b: u8) -> bool {
    is_space(b) || b == b'/'
}

/// Characters that end a tag or attribute name: `[\t\n\r\f />]`.
fn ends_name(b: u8) -> bool {
    is_space_or_slash(b) || b == b'>'
}

/// Characters after which an attribute name may begin: `['"\t\n\r\f /]`.
fn precedes_attr(b: u8) -> bool {
    b == b'\'' || b == b'"' || is_space_or_slash(b)
}

/// An attribute found by `attr_find`: byte ranges of its name and value.
struct AttrMatch {
    name: (usize, usize),
    value: Option<(usize, usize)>,
    end: usize,
}

struct Tokenizer<'a, S: Sink> {
    raw: &'a str,
    b: &'a [u8],
    sink: &'a mut S,
    /// The raw text element whose end tag is awaited.
    cdata_elem: Option<&'static str>,
    /// Whether character references are decoded in text.
    escapable: bool,
}

/// Tokenize a whole HTML document into `sink`.
pub(crate) fn tokenize<S: Sink>(html: &str, sink: &mut S) {
    let mut t = Tokenizer {
        raw: html,
        b: html.as_bytes(),
        sink,
        cdata_elem: None,
        escapable: true,
    };
    t.run();
}

impl<S: Sink> Tokenizer<'_, S> {
    fn n(&self) -> usize {
        self.b.len()
    }

    fn starts(&self, i: usize, prefix: &str) -> bool {
        self.b[i..].starts_with(prefix.as_bytes())
    }

    fn find_byte(&self, byte: u8, from: usize) -> Option<usize> {
        self.b
            .get(from..)?
            .iter()
            .position(|&c| c == byte)
            .map(|p| p + from)
    }

    fn find_str(&self, needle: &str, from: usize) -> Option<usize> {
        self.raw.get(from..)?.find(needle).map(|p| p + from)
    }

    fn text(&mut self, i: usize, j: usize) {
        let s = &self.raw[i..j];
        let text = if self.escapable {
            unescape(s)
        } else {
            s.to_string()
        };
        self.sink.data(text);
    }

    /// `<` followed by an ASCII letter.
    fn start_tag_open(&self, i: usize) -> bool {
        self.b.get(i + 1).is_some_and(u8::is_ascii_alphabetic)
    }

    /// The main loop (`HTMLParser.goahead` at the end of the input).
    fn run(&mut self) {
        let n = self.n();
        let mut i = 0;
        while i < n {
            let j = match self.cdata_elem {
                None => self.find_byte(b'<', i).unwrap_or(n),
                Some("plaintext") => n,
                Some(elem) => match self.raw_text_end(i, elem) {
                    Some(j) => j,
                    None => break,
                },
            };
            if i < j {
                self.text(i, j);
            }
            i = j;
            if i == n {
                break;
            }
            let k = if self.start_tag_open(i) {
                self.parse_starttag(i)
            } else if self.starts(i, "</") {
                self.parse_endtag(i)
            } else if self.starts(i, "<!--") {
                self.parse_comment(i)
            } else if self.starts(i, "<?") {
                self.find_byte(b'>', i + 2).map(|p| p + 1)
            } else if self.starts(i, "<!") {
                self.parse_html_declaration(i)
            } else {
                self.sink.data("<".to_string());
                Some(i + 1)
            };
            i = match k {
                Some(k) => k,
                None => {
                    // An unterminated construct runs to the end of the input and is
                    // dropped, except a "</" that ends the input.
                    if !self.start_tag_open(i) && self.starts(i, "</") && i + 2 == n {
                        self.sink.data("</".to_string());
                    }
                    n
                }
            };
        }
        if i < n {
            self.text(i, n);
        }
    }

    /// The start of the end tag of the current raw text element:
    /// `</elem(?=[\t\n\r\f />])`, ignoring ASCII case.
    fn raw_text_end(&self, from: usize, elem: &str) -> Option<usize> {
        let mut i = from;
        while let Some(p) = self.find_byte(b'<', i) {
            let name = p + 2;
            if self.b.get(p + 1) == Some(&b'/')
                && self
                    .b
                    .get(name..name + elem.len())
                    .is_some_and(|s| s.eq_ignore_ascii_case(elem.as_bytes()))
                && self.b.get(name + elem.len()).is_some_and(|&c| ends_name(c))
            {
                return Some(p);
            }
            i = p + 1;
        }
        None
    }

    /// The end of a tag whose name starts at `p` (the `locatetagend` pattern): past the
    /// closing `>` if there is one.
    fn locate_tag_end(&self, p: usize) -> usize {
        let (b, n) = (self.b, self.n());
        let mut q = p + 1;
        while q < n && !ends_name(b[q]) {
            q += 1;
        }
        while q < n && is_space_or_slash(b[q]) {
            q += 1;
        }
        // Attributes: a name after a quote, space or slash, an optional value, and
        // spaces or slashes.
        while q < n && !ends_name(b[q]) && precedes_attr(b[q - 1]) {
            q += 1;
            while q < n && !ends_name(b[q]) && b[q] != b'=' {
                q += 1;
            }
            if let Some((_, end)) = self.value_indicator(q) {
                q = end;
            }
            while q < n && is_space_or_slash(b[q]) {
                q += 1;
            }
        }
        if q < n && b[q] == b'>' {
            q += 1;
        }
        q
    }

    /// `[\t\n\r\f ]*=[\t\n\r\f ]*(value)` at `q`: the value's byte range and the end.
    fn value_indicator(&self, q: usize) -> Option<((usize, usize), usize)> {
        let (b, n) = (self.b, self.n());
        let mut a = q;
        while a < n && is_space(b[a]) {
            a += 1;
        }
        if b.get(a) != Some(&b'=') {
            return None;
        }
        let first = a + 1;
        let mut v = first;
        while v < n && is_space(b[v]) {
            v += 1;
        }
        if let Some(end) = self.value_at(v) {
            return Some(((v, end), end));
        }
        // An unclosed quote: backtrack one space, where an empty unquoted value matches.
        (v > first).then_some(((v - 1, v - 1), v - 1))
    }

    /// A quoted or unquoted attribute value at `v`: its end, or `None` for an unclosed quote.
    fn value_at(&self, v: usize) -> Option<usize> {
        let (b, n) = (self.b, self.n());
        match b.get(v) {
            Some(&quote @ (b'\'' | b'"')) => self.find_byte(quote, v + 1).map(|e| e + 1),
            _ => {
                let mut e = v;
                while e < n && !is_space(b[e]) && b[e] != b'>' {
                    e += 1;
                }
                Some(e)
            }
        }
    }

    /// Spaces, and slashes not followed by `>`: `(?:[\t\n\r\f ]|/(?!>))*`.
    fn skip_attr_space(&self, mut q: usize) -> usize {
        let (b, n) = (self.b, self.n());
        while q < n && (is_space(b[q]) || (b[q] == b'/' && b.get(q + 1) != Some(&b'>'))) {
            q += 1;
        }
        q
    }

    /// A tag name at `p` (`tagfind_tolerant`): the end of the name and of the spaces after it.
    fn tag_find(&self, p: usize) -> (usize, usize) {
        let mut q = p + 1;
        while q < self.n() && !ends_name(self.b[q]) {
            q += 1;
        }
        (q, self.skip_attr_space(q))
    }

    /// An attribute at `k` (`attrfind_tolerant`).
    fn attr_find(&self, k: usize) -> Option<AttrMatch> {
        let (b, n) = (self.b, self.n());
        if k >= n || ends_name(b[k]) || !precedes_attr(b[k - 1]) {
            return None;
        }
        let mut q = k + 1;
        while q < n && !ends_name(b[q]) && b[q] != b'=' {
            q += 1;
        }
        let name = (k, q);
        let value = self.value_indicator(q).map(|(range, end)| {
            q = end;
            range
        });
        Some(AttrMatch {
            name,
            value,
            end: self.skip_attr_space(q),
        })
    }

    fn parse_starttag(&mut self, i: usize) -> Option<usize> {
        let endpos = self.locate_tag_end(i + 1);
        if self.b[endpos - 1] != b'>' {
            return None;
        }
        let (name_end, mut k) = self.tag_find(i + 1);
        let tag = self.raw[i + 1..name_end].to_lowercase();
        let mut attrs = Vec::new();
        while k < endpos {
            let Some(m) = self.attr_find(k) else {
                break;
            };
            let name = self.raw[m.name.0..m.name.1].to_lowercase();
            let value = m.value.map(|(s, e)| {
                let mut v = &self.raw[s..e];
                if v.len() >= 2
                    && (v.starts_with('\'') && v.ends_with('\'')
                        || v.starts_with('"') && v.ends_with('"'))
                {
                    v = &v[1..v.len() - 1];
                }
                unescape(v)
            });
            attrs.push((name, value));
            k = m.end;
        }
        let end = if k <= endpos {
            pychar::strip(&self.raw[k..endpos])
        } else {
            ""
        };
        if end != ">" && end != "/>" {
            self.sink.data(self.raw[i..endpos].to_string());
            return Some(endpos);
        }
        if end == "/>" {
            // An XHTML-style empty element, such as <br/>.
            self.sink.start_end_tag(tag, attrs);
        } else {
            let raw_text = RAW_TEXT.iter().chain(&["plaintext"]).find(|&&e| e == tag);
            let escapable = ESCAPABLE_RAW_TEXT.iter().find(|&&e| e == tag);
            self.sink.start_tag(tag, attrs);
            if let Some(&elem) = raw_text {
                self.cdata_elem = Some(elem);
                self.escapable = false;
            } else if let Some(&elem) = escapable {
                self.cdata_elem = Some(elem);
                self.escapable = true;
            }
        }
        Some(endpos)
    }

    fn parse_endtag(&mut self, i: usize) -> Option<usize> {
        self.find_byte(b'>', i + 2)?;
        if !self.b.get(i + 2).is_some_and(u8::is_ascii_alphabetic) {
            if self.b.get(i + 2) == Some(&b'>') {
                return Some(i + 3); // "</>" is ignored
            }
            return self.find_byte(b'>', i + 2).map(|p| p + 1); // a bogus comment
        }
        let j = self.locate_tag_end(i + 2);
        if self.b[j - 1] != b'>' {
            return None;
        }
        let (name_end, _) = self.tag_find(i + 2);
        let tag = self.raw[i + 2..name_end].to_lowercase();
        self.sink.end_tag(tag);
        self.cdata_elem = None;
        self.escapable = true;
        Some(j)
    }

    /// `<!--` up to `-->` or `--!>`, or the abrupt `<!-->` and `<!--->`.
    fn parse_comment(&self, i: usize) -> Option<usize> {
        let mut from = i + 4;
        while let Some(q) = self.find_str("--", from) {
            match (self.b.get(q + 2), self.b.get(q + 3)) {
                (Some(b'>'), _) => return Some(q + 3),
                (Some(b'!'), Some(b'>')) => return Some(q + 4),
                _ => from = q + 1,
            }
        }
        match (self.b.get(i + 4), self.b.get(i + 5)) {
            (Some(b'>'), _) => Some(i + 5),
            (Some(b'-'), Some(b'>')) => Some(i + 6),
            _ => None,
        }
    }

    fn parse_html_declaration(&self, i: usize) -> Option<usize> {
        if self.starts(i, "<![CDATA[") {
            self.find_str("]]>", i + 9).map(|j| j + 3)
        } else if self
            .b
            .get(i..i + 9)
            .is_some_and(|s| s.eq_ignore_ascii_case(b"<!doctype"))
        {
            self.find_byte(b'>', i + 9).map(|p| p + 1)
        } else if self.starts(i, "<![") {
            self.find_byte(b'>', i + 3).map(|j| j + 1)
        } else {
            self.find_byte(b'>', i + 2).map(|p| p + 1) // a bogus comment
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Log(Vec<String>);

    impl Sink for Log {
        fn start_tag(&mut self, tag: String, attrs: Vec<(String, Option<String>)>) {
            self.0.push(format!("<{tag} {attrs:?}>"));
        }
        fn start_end_tag(&mut self, tag: String, attrs: Vec<(String, Option<String>)>) {
            self.0.push(format!("<{tag} {attrs:?}/>"));
        }
        fn end_tag(&mut self, tag: String) {
            self.0.push(format!("</{tag}>"));
        }
        fn data(&mut self, text: String) {
            self.0.push(format!("{text:?}"));
        }
    }

    fn log(html: &str) -> Vec<String> {
        let mut sink = Log::default();
        tokenize(html, &mut sink);
        sink.0
    }

    #[test]
    fn tokens() {
        assert_eq!(
            log("<TD Colspan=2 x>a &amp; b</td >"),
            [
                "<td [(\"colspan\", Some(\"2\")), (\"x\", None)]>",
                "\"a & b\"",
                "</td>"
            ]
        );
        assert_eq!(log("a < b<br/>"), ["\"a \"", "\"<\"", "\" b\"", "<br []/>"]);
        assert_eq!(
            log("<script>a<b>&amp;</script>x"),
            ["<script []>", "\"a<b>&amp;\"", "</script>", "\"x\""]
        );
        assert_eq!(
            log("x<!-- c -->y<!DOCTYPE html><?pi?>z"),
            ["\"x\"", "\"y\"", "\"z\""]
        );
        assert_eq!(log("a<td x='1"), ["\"a\""]);
        assert_eq!(log("a</"), ["\"a\"", "\"</\""]);
        assert_eq!(
            log("<a b= 'x>"),
            ["<a [(\"b\", Some(\"\")), (\"'x\", None)]>"]
        );
    }
}
