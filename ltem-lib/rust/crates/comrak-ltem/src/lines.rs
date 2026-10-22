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
        for (i, &b) in bytes.iter().enumerate() {
            if b == b'\n' || (b == b'\r' && bytes.get(i + 1) != Some(&b'\n')) {
                starts.push(i + 1);
            }
        }
        Lines { text, starts }
    }

    pub(crate) fn count(&self) -> usize {
        self.starts.len()
    }

    /// Byte offset of the start of line `i` (counted from 0).
    pub(crate) fn start(&self, i: usize) -> usize {
        self.starts[i]
    }

    /// Byte offset of the start of the line after line `i` (the end of the text after the
    /// last line).
    pub(crate) fn next_start(&self, i: usize) -> usize {
        self.starts.get(i + 1).copied().unwrap_or(self.text.len())
    }

    /// Line `i` without its line ending.
    pub(crate) fn text(&self, i: usize) -> &'a str {
        let start = self.starts[i];
        let bytes = self.text.as_bytes();
        let mut end = self.next_start(i);
        if end > start && bytes[end - 1] == b'\n' {
            end -= 1;
        }
        if end > start && bytes[end - 1] == b'\r' {
            end -= 1;
        }
        &self.text[start..end]
    }
}

#[cfg(test)]
mod tests {
    use super::Lines;

    #[test]
    fn line_endings() {
        let lines = Lines::new("a\nbc\r\nd\re");
        assert_eq!(lines.count(), 4);
        assert_eq!(
            (0..4).map(|i| lines.text(i)).collect::<Vec<_>>(),
            ["a", "bc", "d", "e"]
        );
        assert_eq!((lines.start(2), lines.next_start(2)), (6, 8));
        assert_eq!(lines.next_start(3), 9);
    }
}
