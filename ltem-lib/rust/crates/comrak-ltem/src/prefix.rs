//! Container prefixes of a line, read the way comrak 0.56 reads them.
//!
//! comrak's AST tells where each block starts, but not which part of each later line
//! its containers take. The LTEM core needs the lines of a table with those prefixes
//! removed (spec 2.1), so this module repeats comrak's rules for block quotes and list
//! items (`parse_block_quote_prefix`, `parse_node_item_prefix`, and the start of a list
//! item), including how tabs count up to the next multiple of four columns. Callers
//! check the result against the source positions comrak reports.

const TAB_STOP: usize = 4;

/// A container whose prefix each of its lines carries.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Container {
    /// `>`, also of an alert such as `> [!NOTE]`.
    BlockQuote,
    /// A list item whose content starts this many columns in (comrak's
    /// `marker_offset + padding`).
    Item(usize),
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
    /// Byte index of the first character that is not a space or tab.
    pub(crate) first: usize,
    /// The columns of spaces and tabs before it, inside the containers.
    pub(crate) indent: usize,
}

/// A copy of comrak's line position: a byte offset, a column, and whether the tab at
/// the offset is partly consumed.
#[derive(Clone)]
struct Cursor<'t> {
    bytes: &'t [u8],
    offset: usize,
    column: usize,
}

impl<'t> Cursor<'t> {
    fn new(line: &'t str) -> Cursor<'t> {
        Cursor {
            bytes: line.as_bytes(),
            offset: 0,
            column: 0,
        }
    }

    /// The first character that is not a space or tab: its byte offset and column
    /// (comrak's `find_first_nonspace`).
    fn first_nonspace(&self) -> (usize, usize) {
        let mut chars_to_tab = TAB_STOP - self.column % TAB_STOP;
        let (mut i, mut column) = (self.offset, self.column);
        loop {
            match self.bytes.get(i) {
                Some(b' ') => {
                    i += 1;
                    column += 1;
                    chars_to_tab -= 1;
                    if chars_to_tab == 0 {
                        chars_to_tab = TAB_STOP;
                    }
                }
                Some(b'\t') => {
                    i += 1;
                    column += chars_to_tab;
                    chars_to_tab = TAB_STOP;
                }
                _ => return (i, column),
            }
        }
    }

    fn indent(&self) -> usize {
        self.first_nonspace().1 - self.column
    }

    fn is_space_or_tab(&self) -> bool {
        matches!(self.bytes.get(self.offset), Some(b' ' | b'\t'))
    }

    /// Move `count` columns (`columns`) or characters forward (comrak's
    /// `advance_offset`); a tab may be consumed in part.
    fn advance(&mut self, mut count: usize, columns: bool) {
        while count > 0 && self.offset < self.bytes.len() {
            if self.bytes[self.offset] == b'\t' {
                let chars_to_tab = TAB_STOP - self.column % TAB_STOP;
                if columns {
                    let advance = count.min(chars_to_tab);
                    self.column += advance;
                    if advance == chars_to_tab {
                        self.offset += 1;
                    }
                    count -= advance;
                } else {
                    self.column += chars_to_tab;
                    self.offset += 1;
                    count -= 1;
                }
            } else {
                self.offset += 1;
                self.column += 1;
                count -= 1;
            }
        }
    }

    /// The prefix of a block quote: `>` after at most three columns, and one space or
    /// tab column after it. comrak reads it the same way on the line that opens the
    /// block quote and on the lines that continue it.
    fn block_quote(&mut self) -> bool {
        let indent = self.indent();
        let (first, _) = self.first_nonspace();
        if indent > 3 || self.bytes.get(first) != Some(&b'>') {
            return false;
        }
        self.advance(indent + 1, true);
        if self.is_space_or_tab() {
            self.advance(1, true);
        }
        true
    }

    fn open(&mut self, container: Container) -> bool {
        match container {
            Container::BlockQuote => self.block_quote(),
            // The marker and the spaces after it are `padding` columns.
            Container::Item(content) => {
                self.advance(content, true);
                true
            }
        }
    }

    /// Whether the line continues the container; nothing is consumed if not.
    fn continues(&mut self, container: Container) -> bool {
        let save = self.clone();
        let matched = match container {
            Container::BlockQuote => self.block_quote(),
            Container::Item(content) => {
                let fits = self.indent() >= content;
                if fits {
                    self.advance(content, true);
                }
                fits
            }
        };
        if !matched {
            *self = save;
        }
        matched
    }

    fn prefix(&self, matched: usize) -> Prefix {
        let (first, column) = self.first_nonspace();
        Prefix {
            matched,
            first,
            indent: column - self.column,
        }
    }

    /// Follow the chain of containers; `None` if the line does not open a container
    /// that it should.
    fn follow(&mut self, chain: &[Link]) -> Option<usize> {
        for (i, link) in chain.iter().enumerate() {
            if link.opens {
                if !self.open(link.container) {
                    return None;
                }
            } else if !self.continues(link.container) {
                return Some(i);
            }
        }
        Some(chain.len())
    }
}

/// The container prefixes of `line` for the chain of containers around it, outermost
/// first. `None` if a container that the line opens has no marker on it.
pub(crate) fn scan_prefixes(line: &str, chain: &[Link]) -> Option<Prefix> {
    let mut cursor = Cursor::new(line);
    let matched = cursor.follow(chain)?;
    Some(cursor.prefix(matched))
}

/// The content indentation (`marker_offset + padding`) of a list item that starts on
/// `line` inside `chain`, as comrak computes it when it opens the item. A task list item
/// keeps no list data in comrak's AST, so its indentation is read from the source.
pub(crate) fn item_content_indent(line: &str, chain: &[Link]) -> Option<usize> {
    let mut cursor = Cursor::new(line);
    if cursor.follow(chain)? < chain.len() {
        return None;
    }
    let (first, column) = cursor.first_nonspace();
    let marker_offset = column - cursor.column;
    let bytes = cursor.bytes;
    let matched = match bytes.get(first)? {
        b'*' | b'-' | b'+' => 1,
        b'0'..=b'9' => {
            let digits = bytes[first..]
                .iter()
                .take(9)
                .take_while(|b| b.is_ascii_digit())
                .count();
            matches!(bytes.get(first + digits), Some(b'.' | b')')).then_some(digits + 1)?
        }
        _ => return None,
    };
    cursor.offset = first + matched;
    cursor.column = column + matched;
    let save = cursor.column;
    while cursor.column - save <= 5 && cursor.is_space_or_tab() {
        cursor.advance(1, true);
    }
    let spaces = cursor.column - save;
    let at_end = cursor.offset >= bytes.len();
    let padding = if (1..5).contains(&spaces) && !at_end {
        matched + spaces
    } else {
        matched + 1
    };
    Some(marker_offset + padding)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(container: Container, opens: bool) -> Link {
        Link { container, opens }
    }

    #[test]
    fn list_items() {
        assert_eq!(item_content_indent("- [ ] x", &[]), Some(2));
        assert_eq!(item_content_indent("  -   x", &[]), Some(6));
        assert_eq!(item_content_indent("-     x", &[]), Some(2));
        assert_eq!(item_content_indent("10. x", &[]), Some(4));
        assert_eq!(item_content_indent("1)", &[]), Some(3));
        assert_eq!(item_content_indent("-\tx", &[]), Some(4));
        let quote = [link(Container::BlockQuote, true)];
        assert_eq!(item_content_indent("> - x", &quote), Some(2));
        assert_eq!(item_content_indent("x", &[]), None);
    }

    #[test]
    fn prefixes() {
        let quote = link(Container::BlockQuote, false);
        let item = link(Container::Item(2), false);
        let p = scan_prefixes("> | a |", &[quote]).unwrap();
        assert_eq!((p.matched, p.first, p.indent), (1, 2, 0));
        // The marker takes one column of the tab; two columns remain.
        let p = scan_prefixes(">\t| a |", &[quote]).unwrap();
        assert_eq!((p.matched, p.first, p.indent), (1, 2, 2));
        let p = scan_prefixes("> \t| a |", &[quote]).unwrap();
        assert_eq!((p.first, p.indent), (3, 2));
        let p = scan_prefixes("  | a |", &[item]).unwrap();
        assert_eq!((p.matched, p.first, p.indent), (1, 2, 0));
        let p = scan_prefixes(" | a |", &[item]).unwrap();
        assert_eq!((p.matched, p.first, p.indent), (0, 1, 1)); // lazy
        let opened = [
            link(Container::BlockQuote, true),
            link(Container::Item(2), true),
        ];
        let p = scan_prefixes("> - | a |", &opened).unwrap();
        assert_eq!((p.matched, p.first, p.indent), (2, 4, 0));
        assert!(scan_prefixes("x", &[link(Container::BlockQuote, true)]).is_none());
    }
}
