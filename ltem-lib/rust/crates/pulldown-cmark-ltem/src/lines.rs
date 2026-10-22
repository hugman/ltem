//! Line positions in a document.

/// The lines of a document. Lines end at `"\n"`, `"\r\n"` or `"\r"`, as in CommonMark.
pub(crate) struct Lines<'a> {
    text: &'a str,
    /// Byte offset of the start of each line. A text that ends with a line ending has an
    /// empty last line.
    starts: Vec<usize>,
}

impl<'a> Lines<'a> {
    pub(crate) fn new(text: &'a str) -> Lines<'a> {
        let bytes = text.as_bytes();
        let mut starts = vec![0];
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'\n' => starts.push(i + 1),
                b'\r' if bytes.get(i + 1) != Some(&b'\n') => starts.push(i + 1),
                _ => {}
            }
            i += 1;
        }
        Lines { text, starts }
    }

    /// The line that holds byte `offset`; a line ending belongs to the line it ends.
    pub(crate) fn line_of(&self, offset: usize) -> usize {
        self.starts.partition_point(|&s| s <= offset) - 1
    }

    /// Byte offset of the start of line `i`.
    pub(crate) fn start(&self, i: usize) -> usize {
        self.starts[i]
    }

    /// Byte offset of the start of the line after line `i` (the end of the text after the
    /// last line).
    pub(crate) fn next_start(&self, i: usize) -> usize {
        self.starts.get(i + 1).copied().unwrap_or(self.text.len())
    }

    /// Byte offset of the end of line `i`, before its line ending.
    pub(crate) fn end(&self, i: usize) -> usize {
        let bytes = self.text.as_bytes();
        let mut end = self.next_start(i);
        if end > self.starts[i] && bytes[end - 1] == b'\n' {
            end -= 1;
        }
        if end > self.starts[i] && bytes[end - 1] == b'\r' {
            end -= 1;
        }
        end
    }

    /// Line `i` without its line ending.
    pub(crate) fn text(&self, i: usize) -> &'a str {
        &self.text[self.starts[i]..self.end(i)]
    }

    /// The first and last line of a block whose source is `range` (block ranges end after
    /// their last line ending).
    pub(crate) fn span(&self, range: &std::ops::Range<usize>) -> (usize, usize) {
        let first = self.line_of(range.start);
        let last = self.line_of(range.end.max(range.start + 1) - 1);
        (first, last.max(first))
    }
}

#[cfg(test)]
mod tests {
    use super::Lines;

    #[test]
    fn line_endings() {
        let lines = Lines::new("a\nbc\r\nd\re");
        assert_eq!(
            (0..4).map(|i| lines.text(i)).collect::<Vec<_>>(),
            ["a", "bc", "d", "e"]
        );
        assert_eq!(lines.line_of(1), 0); // the "\n" ends line 0
        assert_eq!(lines.line_of(5), 1); // the "\n" of "\r\n"
        assert_eq!(lines.line_of(9), 3);
        assert_eq!(lines.next_start(3), 9);
        assert_eq!(lines.span(&(2..6)), (1, 1));
        let lines = Lines::new("x\n");
        assert_eq!((lines.text(1), lines.span(&(0..2))), ("", (0, 0)));
    }
}
