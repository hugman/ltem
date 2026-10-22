//! Span resolution (spec Section 3): grid rows, compact rows, markers and recovery.

use crate::model::Problem;
use crate::pychar;
use crate::syntax::{split_attribute, COLSPAN_MARKER, ROWSPAN_MARKER};

/// How a row was read (spec 3.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RowForm {
    /// Every position has its own cell in the text.
    Grid,
    /// Covered positions have no cell in the text.
    Compact,
    /// The row fit neither form (rule V14) and was padded or cut as a grid row.
    Padded,
}

impl RowForm {
    /// `"grid"`, `"compact"` or `"padded"`.
    pub fn as_str(self) -> &'static str {
        match self {
            RowForm::Grid => "grid",
            RowForm::Compact => "compact",
            RowForm::Padded => "padded",
        }
    }
}

/// A cell placed in the grid.
#[derive(Clone, Debug)]
pub(crate) struct Origin {
    pub row: usize,
    pub col: usize,
    pub rowspan: usize,
    pub colspan: usize,
    /// Cell source with the span attribute removed.
    pub text: String,
    /// Index of the cell in its source row; `None` if it was added by padding (V14).
    pub source: Option<usize>,
    /// The colspan came from an attribute: markers may not extend it.
    fixed_cols: bool,
    /// The rowspan came from an attribute.
    fixed_rows: bool,
}

/// One undoable change, recorded while a compact row is tried.
enum Undo {
    Owner(usize, Option<usize>),
    Colspan(usize),
    Rowspan(usize),
    Origin,
}

/// Places the cells of a table row by row, as spec Section 3 describes.
pub(crate) struct GridBuilder {
    cols: usize,
    header_rows: usize,
    rows: usize,
    /// For each position (row-major), the index in `origins` of the cell that owns it.
    owner: Vec<Option<usize>>,
    pub origins: Vec<Origin>,
    pub problems: Vec<Problem>,
    /// Undo steps while a compact row is tried (see `try_compact`).
    journal: Option<Vec<Undo>>,
}

impl GridBuilder {
    pub fn new(cols: usize, header_rows: usize, rows: usize) -> GridBuilder {
        GridBuilder {
            cols,
            header_rows,
            rows,
            owner: vec![None; rows * cols],
            origins: Vec::new(),
            problems: Vec::new(),
            journal: None,
        }
    }

    // -- helpers ---------------------------------------------------------------------

    fn report(&mut self, rule: &str, row: usize, col: Option<usize>, message: String) {
        self.problems.push(Problem::new(rule, row, col, message));
    }

    fn owner(&self, r: usize, c: usize) -> Option<usize> {
        self.owner[r * self.cols + c]
    }

    fn free(&self, r0: usize, r1: usize, c0: usize, c1: usize) -> bool {
        (r0..r1.min(self.rows)).all(|r| (c0..c1.min(self.cols)).all(|c| self.owner(r, c).is_none()))
    }

    fn cover(&mut self, origin: usize, r0: usize, r1: usize, c0: usize, c1: usize) {
        for r in r0..r1.min(self.rows) {
            for c in c0..c1.min(self.cols) {
                let i = r * self.cols + c;
                if let Some(journal) = &mut self.journal {
                    journal.push(Undo::Owner(i, self.owner[i]));
                }
                self.owner[i] = Some(origin);
            }
        }
    }

    fn record(&mut self, undo: Undo) {
        if let Some(journal) = &mut self.journal {
            journal.push(undo);
        }
    }

    // -- placing (spec 3.3, 3.4) -------------------------------------------------------

    /// `<<` at (r, c) extends the cell to its left (spec 3.4).
    fn extend_left(&mut self, r: usize, c: usize) -> bool {
        let left = if c > 0 { self.owner(r, c - 1) } else { None };
        let Some(i) = left.filter(|&i| {
            let o = &self.origins[i];
            o.row == r && o.col + o.colspan == c && !o.fixed_cols
        }) else {
            self.report("V13", r, Some(c), "'<<' has no cell to extend".to_string());
            return false;
        };
        let (row, rowspan) = (self.origins[i].row, self.origins[i].rowspan);
        if !self.free(r + 1, row + rowspan, c, c + 1) {
            self.report(
                "V4",
                r,
                Some(c),
                "'<<' would make two cells overlap".to_string(),
            );
            return false;
        }
        self.origins[i].colspan += 1;
        self.record(Undo::Colspan(i));
        self.cover(i, row, row + rowspan, c, c + 1);
        true
    }

    /// `^^` at (r, c) extends the cell above it (spec 3.4).
    fn extend_up(&mut self, r: usize, c: usize) -> bool {
        let up = if r > 0 { self.owner(r - 1, c) } else { None };
        let Some(i) = up.filter(|&i| {
            let o = &self.origins[i];
            o.col == c && o.row + o.rowspan == r && !o.fixed_rows
        }) else {
            self.report("V13", r, Some(c), "'^^' has no cell to extend".to_string());
            return false;
        };
        let (row, col, colspan) = (
            self.origins[i].row,
            self.origins[i].col,
            self.origins[i].colspan,
        );
        if row < self.header_rows && self.header_rows <= r {
            self.report(
                "V7",
                r,
                Some(c),
                "'^^' would extend a header cell into the body".to_string(),
            );
            return false;
        }
        if !self.free(r, r + 1, c + 1, col + colspan) {
            self.report(
                "V4",
                r,
                Some(c),
                "'^^' would make two cells overlap".to_string(),
            );
            return false;
        }
        self.origins[i].rowspan += 1;
        self.record(Undo::Rowspan(i));
        self.cover(i, r, r + 1, col, col + colspan);
        true
    }

    /// Place a cell at the position (r, c), which is not covered (spec 3.3).
    fn place(&mut self, r: usize, c: usize, source: &str, index: Option<usize>) {
        if source == COLSPAN_MARKER && self.extend_left(r, c) {
            return;
        }
        if source == ROWSPAN_MARKER && self.extend_up(r, c) {
            return;
        }
        let mut text = source;
        let (mut colspan, mut rowspan) = (1usize, 1usize);
        let (mut shown_cols, mut shown_rows) = (None, None);
        let (mut fixed_cols, mut fixed_rows) = (false, false);
        if source != COLSPAN_MARKER && source != ROWSPAN_MARKER {
            // An unusable marker stays literal text (V13).
            let (rest, attr) = split_attribute(source);
            text = rest;
            if let Some(attr) = attr {
                for message in attr.problems {
                    self.report("V1", r, Some(c), message);
                }
                if let Some(n) = attr.colspan {
                    (colspan, shown_cols, fixed_cols) = (n.value, Some(n.shown), true);
                }
                if let Some(n) = attr.rowspan {
                    (rowspan, shown_rows, fixed_rows) = (n.value, Some(n.shown), true);
                }
            }
        }
        // V2, V3: cut at the right or bottom edge (spec 3.6).
        if c.saturating_add(colspan) > self.cols {
            let shown = shown_cols.unwrap_or_else(|| colspan.to_string());
            self.report(
                "V2",
                r,
                Some(c),
                format!("colspan {shown} reaches past the last column"),
            );
            colspan = self.cols - c;
        }
        if r.saturating_add(rowspan) > self.rows {
            let shown = shown_rows.unwrap_or_else(|| rowspan.to_string());
            self.report(
                "V3",
                r,
                Some(c),
                format!("rowspan {shown} reaches past the last row"),
            );
            rowspan = self.rows - r;
        }
        // V7: a header cell's rowspan is cut at the last header row.
        if r < self.header_rows && self.header_rows < r + rowspan {
            self.report(
                "V7",
                r,
                Some(c),
                "a header cell spans into the body".to_string(),
            );
            rowspan = self.header_rows - r;
        }
        // V4: cut to the largest rectangle that overlaps nothing, columns first, then rows.
        let mut k = 1;
        while k < colspan && self.owner(r, c + k).is_none() {
            k += 1;
        }
        let mut j = 1;
        while j < rowspan && self.free(r + j, r + j + 1, c, c + k) {
            j += 1;
        }
        if (k, j) != (colspan, rowspan) {
            self.report(
                "V4",
                r,
                Some(c),
                format!("span cut from {colspan}x{rowspan} to {k}x{j} to avoid an overlap"),
            );
            (colspan, rowspan) = (k, j);
        }
        let origin = self.origins.len();
        self.origins.push(Origin {
            row: r,
            col: c,
            rowspan,
            colspan,
            text: text.to_string(),
            source: index,
            fixed_cols,
            fixed_rows,
        });
        self.record(Undo::Origin);
        self.cover(origin, r, r + rowspan, c, c + colspan);
    }

    // -- rows (spec 3.2) ---------------------------------------------------------------

    /// Place row r as a compact row if its cells fill exactly the positions that are not
    /// covered; otherwise leave the grid unchanged. Returns whether the row fit.
    ///
    /// Every change is journaled and undone if the row does not fit, which gives the
    /// same result as trying the row on a copy of the grid.
    fn try_compact(&mut self, r: usize, texts: &[String]) -> bool {
        let problem_count = self.problems.len();
        self.journal = Some(Vec::new());
        let mut used = 0;
        let mut fits = true;
        for c in 0..self.cols {
            if self.owner(r, c).is_none() {
                if used == texts.len() {
                    fits = false;
                    break;
                }
                self.place(r, c, &texts[used], Some(used));
                used += 1;
            }
        }
        let journal = self.journal.take().unwrap_or_default();
        // Cells left over must be empty, and they are ignored.
        fits = fits && texts[used..].iter().all(String::is_empty);
        if !fits {
            for undo in journal.into_iter().rev() {
                match undo {
                    Undo::Owner(i, previous) => self.owner[i] = previous,
                    Undo::Colspan(i) => self.origins[i].colspan -= 1,
                    Undo::Rowspan(i) => self.origins[i].rowspan -= 1,
                    Undo::Origin => {
                        self.origins.pop();
                    }
                }
            }
            self.problems.truncate(problem_count);
        }
        fits
    }

    /// Place row r (spec 3.2).
    pub fn add_row(&mut self, r: usize, cells: Vec<String>) -> RowForm {
        let n = cells.len();
        if n != self.cols && self.try_compact(r, &cells) {
            return RowForm::Compact;
        }
        let mut form = RowForm::Grid;
        let mut texts = cells;
        if n != self.cols {
            self.report(
                "V14",
                r,
                None,
                format!("row has {n} cells; it fits neither as a grid row ({} cells) nor as a compact row", self.cols),
            );
            texts.resize(self.cols, String::new());
            form = RowForm::Padded;
        }
        for (c, text) in texts.iter().enumerate() {
            if let Some(i) = self.owner(r, c) {
                // A placeholder in a grid row: its text is dropped (V5, V6).
                if !text.is_empty() && text != COLSPAN_MARKER && text != ROWSPAN_MARKER {
                    let rule = if self.origins[i].row < r { "V5" } else { "V6" };
                    let message = format!(
                        "a covered position holds text {}; it is dropped",
                        pychar::repr(text)
                    );
                    self.report(rule, r, Some(c), message);
                }
                continue;
            }
            self.place(r, c, text, (c < n).then_some(c));
        }
        form
    }
}
