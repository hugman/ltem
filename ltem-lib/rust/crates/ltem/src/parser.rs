//! Finding and parsing LTEM tables (spec Sections 2 and 3).

use crate::grid::{GridBuilder, Origin, RowForm};
use crate::model::{Cell, CellSource, Problem, Table};
use crate::syntax::{
    alignment, cell_lines, ends_table_body, indentation, is_delimiter_row, is_setext_underline,
    is_upper_header_row, split_row, split_row_spans, starts_block, strip_spaces,
};

/// The result of parsing one block of lines.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseResult {
    /// The table, or `None` if the block holds no table.
    pub table: Option<Table>,
    /// Validation problems of the table (spec Section 5).
    pub problems: Vec<Problem>,
    /// Lines before the table that stay a paragraph (spec 2.3, Section 9). If there is
    /// no table, all lines of the block.
    pub before: Vec<String>,
    /// Lines after the table, from the first line that ends the table body (spec 2.4).
    pub after: Vec<String>,
    /// How each row was read.
    pub forms: Vec<RowForm>,
    /// Index of the table's first line (its first header row), counted from `offset`.
    pub start: usize,
    /// Index just past the table's last line, counted from `offset`.
    pub end: usize,
    /// Where each cell of the table is in the parsed text, in the order of `table.cells`.
    pub sources: Vec<CellSource>,
}

/// Input that [`parse_table`] accepts: a block of text or its lines.
pub trait Block {
    /// The lines of the block.
    fn block_lines(&self) -> Vec<&str>;
}

impl Block for str {
    fn block_lines(&self) -> Vec<&str> {
        self.split('\n').collect()
    }
}

impl Block for String {
    fn block_lines(&self) -> Vec<&str> {
        self.as_str().block_lines()
    }
}

impl<S: AsRef<str>> Block for [S] {
    fn block_lines(&self) -> Vec<&str> {
        self.iter().map(AsRef::as_ref).collect()
    }
}

impl<S: AsRef<str>> Block for Vec<S> {
    fn block_lines(&self) -> Vec<&str> {
        self.as_slice().block_lines()
    }
}

impl<S: AsRef<str>, const N: usize> Block for [S; N] {
    fn block_lines(&self) -> Vec<&str> {
        self.as_slice().block_lines()
    }
}

fn owned(lines: &[&str]) -> Vec<String> {
    lines.iter().map(|s| s.to_string()).collect()
}

/// Parse one block of consecutive non-blank lines that may contain a table.
///
/// `block` is a string, split at line feeds, or a list of lines. A table may begin on
/// any line of the block, as a GFM table may begin inside a paragraph. Delimiter rows
/// are tried in order; the first one whose header rows fit makes the table (spec 2.3).
/// Lines above the header rows are returned in `before`; lines from the first line that
/// ends the table body are returned in `after`. `start` and `end` give the table's
/// lines, counted from `offset`.
pub fn parse_table<B: Block + ?Sized>(block: &B, offset: usize) -> ParseResult {
    let lines: Vec<&str> = block
        .block_lines()
        .into_iter()
        .map(|l| l.trim_end_matches('\r'))
        .collect();
    for d in 1..lines.len() {
        // The last header row is a paragraph line, as in GFM: not indented as code, not
        // the start of another block such as a list item or heading, and not a setext
        // heading underline below another paragraph line (spec 2.3).
        if !is_delimiter_row(lines[d])
            || indentation(lines[d - 1]) >= 4
            || starts_block(lines[d - 1])
        {
            continue;
        }
        if d >= 2 && is_setext_underline(lines[d - 1]) && !starts_block(lines[d - 2]) {
            continue;
        }
        if let Some(result) = try_table(&lines, d, offset) {
            return result;
        }
    }
    ParseResult {
        table: None,
        problems: Vec::new(),
        before: owned(&lines),
        after: Vec::new(),
        forms: Vec::new(),
        start: 0,
        end: 0,
        sources: Vec::new(),
    }
}

/// The table whose delimiter row is `lines[d]`, or `None` if its last header row does
/// not fit.
fn try_table(lines: &[&str], d: usize, offset: usize) -> Option<ParseResult> {
    // Header rows: the line above the delimiter, plus pipe-led lines above it (spec 2.3).
    // A last header row that looks like a delimiter row is the only header row.
    let mut top = d - 1;
    let alone = is_delimiter_row(lines[d - 1]);
    while top > 0 && !alone && is_upper_header_row(lines[top - 1]) {
        top -= 1;
    }
    // Body rows, up to the first line that ends the table (spec 2.4).
    let mut end = d + 1;
    while end < lines.len() && !ends_table_body(lines[end]) {
        end += 1;
    }

    let header_rows = d - top;
    let align: Vec<_> = split_row(lines[d]).iter().map(|c| alignment(c)).collect();
    // The cells of each row, with where they are in their line.
    let spans: Vec<Vec<(String, usize, usize)>> = lines[top..d]
        .iter()
        .chain(&lines[d + 1..end])
        .map(|l| split_row_spans(l))
        .collect();
    let rows: Vec<Vec<String>> = spans
        .iter()
        .map(|row| row.iter().map(|(text, _, _)| text.clone()).collect())
        .collect();
    let row_count = rows.len();
    let mut builder = GridBuilder::new(align.len(), header_rows, row_count);
    let forms: Vec<RowForm> = rows
        .into_iter()
        .enumerate()
        .map(|(r, texts)| builder.add_row(r, texts))
        .collect();
    if forms[header_rows - 1] == RowForm::Padded {
        return None; // the last header row must fit exactly (spec 2.3)
    }

    let mut origins: Vec<&Origin> = builder.origins.iter().collect();
    origins.sort_by_key(|o| (o.row, o.col));
    let cells: Vec<Cell> = origins
        .iter()
        .map(|o| Cell::new(o.row, o.col, o.rowspan, o.colspan, cell_lines(&o.text)))
        .collect();
    let sources: Vec<CellSource> = origins
        .iter()
        .map(|o| {
            // Body rows follow the delimiter row.
            let line = top + o.row + usize::from(o.row >= header_rows);
            let (start, end) = match o.source {
                Some(i) => (spans[o.row][i].1, spans[o.row][i].2),
                None => (lines[line].len(), lines[line].len()),
            };
            CellSource {
                row: o.row,
                col: o.col,
                rowspan: o.rowspan,
                colspan: o.colspan,
                line: offset + line,
                start,
                end,
            }
        })
        .collect();
    let problems = std::mem::take(&mut builder.problems);
    let table = Table::new(row_count, align.len(), header_rows, align, cells);
    Some(ParseResult {
        table: Some(table),
        problems,
        before: owned(&lines[..top]),
        after: owned(&lines[end..]),
        forms,
        start: offset + top,
        end: offset + end,
        sources,
    })
}

/// The run of backticks or tildes that opens a fenced code block, after at most three
/// spaces: `^ {0,3}(`{3,}|~{3,})`. Returns the run and the byte index after it.
fn fence(line: &str) -> Option<(&str, usize)> {
    let n = line.bytes().take_while(|&b| b == b' ').count();
    if n > 3 {
        return None;
    }
    let rest = &line[n..];
    let first = *rest.as_bytes().first()?;
    if first != b'`' && first != b'~' {
        return None;
    }
    let run = rest.bytes().take_while(|&b| b == first).count();
    (run >= 3).then(|| (&rest[..run], n + run))
}

/// Parse the tables of one block of non-blank lines into `results` and clear the block.
fn flush(block: &mut Vec<&str>, block_start: usize, results: &mut Vec<ParseResult>) {
    let mut pending: Vec<String> = owned(block);
    let mut offset = block_start;
    block.clear();
    while !pending.is_empty() {
        let result = parse_table(&pending, offset);
        if result.table.is_none() {
            return;
        }
        offset = result.end;
        pending = result.after.clone();
        results.push(result);
    }
}

/// Split text into lines at `"\r\n"`, `"\r"` or `"\n"`, the line endings of CommonMark.
fn split_lines(text: &str) -> Vec<&str> {
    let b = text.as_bytes();
    let mut lines = Vec::new();
    let (mut start, mut i) = (0, 0);
    while i < b.len() {
        match b[i] {
            b'\n' => {
                lines.push(&text[start..i]);
                i += 1;
                start = i;
            }
            b'\r' => {
                lines.push(&text[start..i]);
                i += if b.get(i + 1) == Some(&b'\n') { 2 } else { 1 };
                start = i;
            }
            _ => i += 1,
        }
    }
    lines.push(&text[start..]);
    lines
}

/// Find the LTEM tables in a Markdown document.
///
/// This is a light scan, not a full CommonMark parser: it splits the text at blank
/// lines (lines holding only spaces and tabs) and skips fenced and indented code
/// blocks. It does not model containers such as list items and block quotes. Lines end
/// at `"\n"`, `"\r\n"` or `"\r"`, as in CommonMark; `start` and `end` of each result
/// are indices of lines split that way. To render whole documents, use LTEM through a
/// Markdown parser plugin instead.
pub fn find_tables(markdown: &str) -> Vec<ParseResult> {
    let mut results = Vec::new();
    let mut block: Vec<&str> = Vec::new();
    let mut block_start = 0;
    let mut open_fence: Option<&str> = None;

    for (i, line) in split_lines(markdown).into_iter().enumerate() {
        if let Some(open) = open_fence {
            if let Some((run, after)) = fence(line) {
                // A closing fence (CommonMark): the same character, at least as long,
                // and nothing but spaces and tabs after it.
                if run.as_bytes()[0] == open.as_bytes()[0]
                    && run.len() >= open.len()
                    && strip_spaces(&line[after..]).is_empty()
                {
                    open_fence = None;
                }
            }
            continue;
        }
        if let Some((run, _)) = fence(line) {
            flush(&mut block, block_start, &mut results);
            open_fence = Some(run);
            continue;
        }
        if strip_spaces(line).is_empty() {
            flush(&mut block, block_start, &mut results);
        } else if block.is_empty() && line.starts_with("    ") {
            continue; // indented code block
        } else {
            if block.is_empty() {
                block_start = i;
            }
            block.push(line);
        }
    }
    flush(&mut block, block_start, &mut results);
    results
}
