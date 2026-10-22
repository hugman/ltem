//! Container prefixes of a line, read the way pulldown-cmark 0.13 reads them.
//!
//! pulldown-cmark tells where each block quote, list item and leaf block starts, but not
//! which part of each later line its containers take. The LTEM core needs the lines of a
//! table with those prefixes removed (spec 2.1), so this module repeats the prefix rules
//! of pulldown-cmark's `scan_containers` and of its block start loop, including how tabs
//! count as spaces up to the next multiple of four columns. Callers check the result
//! against the block positions pulldown-cmark reports.

/// A container whose prefix each of its lines carries.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Container {
    /// `>`
    BlockQuote,
    /// A list item whose content starts this many columns in.
    ListItem(usize),
}

/// A container on the chain of a line: whether the line opens it or continues it.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Link {
    pub(crate) container: Container,
    pub(crate) opens: bool,
}

/// Where the content of a line starts after its container prefixes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Prefix {
    /// How many containers of the chain the line continues; fewer than the chain's
    /// length makes the line a lazy continuation line.
    pub(crate) matched: usize,
    /// Byte index of the content in the line.
    pub(crate) content: usize,
    /// Columns of a tab before `content` that the prefix did not take; they count as
    /// spaces at the start of the content.
    pub(crate) spaces: usize,
}

/// A copy of pulldown-cmark's `LineStart` for one line (without its line ending).
#[derive(Clone)]
struct Scanner<'t> {
    bytes: &'t [u8],
    ix: usize,
    /// Byte index after the last tab scanned: a tab stop.
    tab_start: usize,
    /// Columns of the last tab scanned that are not consumed yet.
    spaces_remaining: usize,
}

impl<'t> Scanner<'t> {
    fn new(line: &'t str) -> Scanner<'t> {
        Scanner {
            bytes: line.as_bytes(),
            ix: 0,
            tab_start: 0,
            spaces_remaining: 0,
        }
    }

    /// Consume `n` columns of spaces and tabs; true if all were there.
    fn scan_space(&mut self, n: usize) -> bool {
        self.scan_space_inner(n) == 0
    }

    /// Consume up to `n` columns of spaces and tabs; returns how many were consumed.
    fn scan_space_upto(&mut self, n: usize) -> usize {
        n - self.scan_space_inner(n)
    }

    /// Returns the columns that could not be consumed.
    fn scan_space_inner(&mut self, mut n: usize) -> usize {
        let from_remaining = self.spaces_remaining.min(n);
        self.spaces_remaining -= from_remaining;
        n -= from_remaining;
        while n > 0 && self.ix < self.bytes.len() {
            match self.bytes[self.ix] {
                b' ' => {
                    self.ix += 1;
                    n -= 1;
                }
                b'\t' => {
                    let spaces = 4 - (self.ix - self.tab_start) % 4;
                    self.ix += 1;
                    self.tab_start = self.ix;
                    let taken = spaces.min(n);
                    n -= taken;
                    self.spaces_remaining = spaces - taken;
                }
                _ => break,
            }
        }
        n
    }

    fn is_at_eol(&self) -> bool {
        self.ix >= self.bytes.len()
    }

    fn rest_is_blank(&self) -> bool {
        self.bytes[self.ix..]
            .iter()
            .all(|&b| b == b' ' || b == b'\t')
    }

    fn scan_ch(&mut self, c: u8) -> bool {
        let found = self.bytes.get(self.ix) == Some(&c);
        if found {
            self.ix += 1;
        }
        found
    }

    fn scan_blockquote_marker(&mut self) -> bool {
        let found = self.scan_ch(b'>');
        if found {
            let _ = self.scan_space(1);
        }
        found
    }

    /// A list marker after `indent` columns of indentation; returns the item's content
    /// indentation (pulldown-cmark's `scan_list_marker_with_indent`). The caller knows
    /// that a list item starts here, so the thematic break check is left out.
    fn scan_list_marker(&mut self, indent: usize) -> Option<usize> {
        let c = *self.bytes.get(self.ix)?;
        if matches!(c, b'-' | b'+' | b'*') {
            self.ix += 1;
            return (self.scan_space(1) || self.is_at_eol())
                .then(|| self.finish_list_marker(indent + 2));
        }
        let start = self.ix;
        let digits = self.bytes[start..]
            .iter()
            .take(9)
            .take_while(|b| b.is_ascii_digit())
            .count();
        if digits == 0 || !matches!(self.bytes.get(start + digits), Some(b'.' | b')')) {
            return None;
        }
        self.ix = start + digits + 1;
        (self.scan_space(1) || self.is_at_eol())
            .then(|| self.finish_list_marker(indent + 1 + digits + 1))
    }

    /// Up to three more spaces after a list marker belong to it; four or more start
    /// indented content and do not.
    fn finish_list_marker(&mut self, indent: usize) -> usize {
        if self.rest_is_blank() {
            return indent;
        }
        let save = self.clone();
        let post = self.scan_space_upto(4);
        if post < 4 {
            indent + post
        } else {
            *self = save;
            indent
        }
    }

    /// The prefix a container opened on this line takes; `None` if it is not there.
    fn open(&mut self, container: Container) -> Option<()> {
        let outer = self.scan_space_upto(4);
        if outer >= 4 {
            return None;
        }
        match container {
            Container::BlockQuote => self.scan_blockquote_marker().then_some(()),
            Container::ListItem(_) => self.scan_list_marker(outer).map(|_| ()),
        }
    }

    /// The prefix a container continued on this line takes (pulldown-cmark's
    /// `scan_containers`); false, with nothing consumed, if the line does not continue it.
    fn continues(&mut self, container: Container) -> bool {
        let save = self.clone();
        let matched = match container {
            Container::BlockQuote => {
                let _ = self.scan_space(3);
                self.scan_blockquote_marker()
            }
            Container::ListItem(indent) => self.scan_space(indent) || self.is_at_eol(),
        };
        if !matched {
            *self = save;
        }
        matched
    }

    fn prefix(&self, matched: usize) -> Prefix {
        Prefix {
            matched,
            content: self.ix,
            spaces: self.spaces_remaining,
        }
    }
}

/// The container prefixes of `line` for the chain of containers around it, outermost
/// first. `None` if a container that the line opens has no marker on it.
pub(crate) fn scan_prefixes(line: &str, chain: &[Link]) -> Option<Prefix> {
    let mut scanner = Scanner::new(line);
    for (i, link) in chain.iter().enumerate() {
        if link.opens {
            scanner.open(link.container)?;
        } else if !scanner.continues(link.container) {
            return Some(scanner.prefix(i));
        }
    }
    Some(scanner.prefix(chain.len()))
}

/// The content indentation of a list item that starts on `line`, inside `chain`.
pub(crate) fn list_item_indent(line: &str, chain: &[Link]) -> Option<usize> {
    let mut scanner = Scanner::new(line);
    for link in chain {
        if link.opens {
            scanner.open(link.container)?;
        } else if !scanner.continues(link.container) {
            return None;
        }
    }
    let outer = scanner.scan_space_upto(4);
    (outer < 4)
        .then(|| scanner.scan_list_marker(outer))
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(container: Container, opens: bool) -> Link {
        Link { container, opens }
    }

    #[test]
    fn list_items() {
        assert_eq!(list_item_indent("- x", &[]), Some(2));
        assert_eq!(list_item_indent("  -   x", &[]), Some(6));
        assert_eq!(list_item_indent("-     x", &[]), Some(2)); // indented code after the marker
        assert_eq!(list_item_indent("10. x", &[]), Some(4));
        assert_eq!(list_item_indent("1)", &[]), Some(3));
        assert_eq!(list_item_indent("-\tx", &[]), Some(4));
        let quote = [link(Container::BlockQuote, true)];
        assert_eq!(list_item_indent("> - x", &quote), Some(2));
        assert_eq!(list_item_indent("x", &[]), None);
    }

    #[test]
    fn prefixes() {
        let quote = link(Container::BlockQuote, false);
        let item = link(Container::ListItem(2), false);
        let p = scan_prefixes("> | a |", &[quote]).unwrap();
        assert_eq!((p.matched, p.content, p.spaces), (1, 2, 0));
        let p = scan_prefixes(">\t| a |", &[quote]).unwrap();
        assert_eq!((p.matched, p.content, p.spaces), (1, 2, 2));
        let p = scan_prefixes("  | a |", &[item]).unwrap();
        assert_eq!((p.matched, p.content), (1, 2));
        let p = scan_prefixes(" | a |", &[item]).unwrap();
        assert_eq!((p.matched, p.content), (0, 0)); // lazy
        let p = scan_prefixes(">   > x", &[quote, quote]).unwrap();
        assert_eq!((p.matched, p.content), (2, 6));
        let opened = [
            link(Container::BlockQuote, true),
            link(Container::ListItem(2), true),
        ];
        let p = scan_prefixes("> - | a |", &opened).unwrap();
        assert_eq!((p.matched, p.content), (2, 4));
        assert!(scan_prefixes("x", &[link(Container::BlockQuote, true)]).is_none());
    }
}
