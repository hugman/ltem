//! The LTEM table model (`ast/table-model.md` and `ast/table.schema.json`).
//!
//! The JSON form of a [`Table`] is the table model itself: `serde_json` output is valid
//! against the schema, with the keys in the schema's order.

use std::fmt;

use serde::ser::{SerializeSeq, SerializeStruct};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Version of the table model.
pub const MODEL_VERSION: &str = "1.0";

/// Column alignment set by the delimiter row (spec 2.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Align {
    /// `:---`
    Left,
    /// `:---:`
    Center,
    /// `---:`
    Right,
}

impl Align {
    /// The model's name for the alignment: `"left"`, `"center"` or `"right"`.
    pub fn as_str(self) -> &'static str {
        match self {
            Align::Left => "left",
            Align::Center => "center",
            Align::Right => "right",
        }
    }
}

/// A cell of a table. Its origin is its top-left grid position.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cell {
    /// Row of the origin, counting from 0.
    pub row: usize,
    /// Column of the origin, counting from 0.
    pub col: usize,
    /// Number of rows the cell spans (at least 1).
    pub rowspan: usize,
    /// Number of columns the cell spans (at least 1).
    pub colspan: usize,
    /// Inline Markdown source. Lines are separated by `"\n"`.
    pub text: String,
}

impl Cell {
    /// A cell with the given origin, spans and text.
    pub fn new(
        row: usize,
        col: usize,
        rowspan: usize,
        colspan: usize,
        text: impl Into<String>,
    ) -> Cell {
        Cell {
            row,
            col,
            rowspan,
            colspan,
            text: text.into(),
        }
    }
}

/// A resolved LTEM table.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Table {
    /// Number of grid rows: header rows first, then body rows.
    pub rows: usize,
    /// Number of grid columns.
    pub cols: usize,
    /// Number of header rows.
    pub header_rows: usize,
    /// Alignment of each column; `None` when the delimiter row sets none.
    pub align: Vec<Option<Align>>,
    /// The cells, sorted by row and then by column.
    pub cells: Vec<Cell>,
}

/// An error reading a table model from JSON.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelError {
    message: String,
}

impl fmt::Display for ModelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ModelError {}

impl Table {
    /// A table with the given size, alignment and cells.
    pub fn new(
        rows: usize,
        cols: usize,
        header_rows: usize,
        align: Vec<Option<Align>>,
        cells: Vec<Cell>,
    ) -> Table {
        Table {
            rows,
            cols,
            header_rows,
            align,
            cells,
        }
    }

    /// Whether a cell is a header cell: its origin is in a header row.
    pub fn is_header(&self, cell: &Cell) -> bool {
        cell.row < self.header_rows
    }

    /// A `rows` x `cols` grid holding, for each position, the index in `cells` of the
    /// cell that owns it.
    pub fn owner_grid(&self) -> Vec<Vec<Option<usize>>> {
        let mut grid = vec![vec![None; self.cols]; self.rows];
        for (i, cell) in self.cells.iter().enumerate() {
            let r1 = cell.row.saturating_add(cell.rowspan).min(self.rows);
            let c1 = cell.col.saturating_add(cell.colspan).min(self.cols);
            for row in grid.iter_mut().take(r1).skip(cell.row) {
                for slot in row.iter_mut().take(c1).skip(cell.col) {
                    *slot = Some(i);
                }
            }
        }
        grid
    }

    /// The violations of the model rules in `ast/table-model.md` (empty if valid).
    pub fn check(&self) -> Vec<String> {
        let mut problems = Vec::new();
        if self.align.len() != self.cols {
            problems.push(format!(
                "align has {} entries, expected {}",
                self.align.len(),
                self.cols
            ));
        }
        if !(1 <= self.header_rows && self.header_rows <= self.rows) {
            problems.push(format!(
                "header_rows {} is outside 1..{}",
                self.header_rows, self.rows
            ));
        }
        if self
            .cells
            .windows(2)
            .any(|w| (w[0].row, w[0].col) > (w[1].row, w[1].col))
        {
            problems.push("cells are not sorted by row and column".to_string());
        }
        let mut seen = vec![vec![false; self.cols]; self.rows];
        for c in &self.cells {
            let r1 = c.row.checked_add(c.rowspan);
            let c1 = c.col.checked_add(c.colspan);
            let inside =
                matches!((r1, c1), (Some(r1), Some(c1)) if r1 <= self.rows && c1 <= self.cols);
            if c.rowspan < 1 || c.colspan < 1 || !inside {
                problems.push(format!("cell ({},{}) lies outside the grid", c.row, c.col));
                continue;
            }
            if c.row < self.header_rows && self.header_rows < c.row + c.rowspan {
                problems.push(format!(
                    "header cell ({},{}) reaches into the body",
                    c.row, c.col
                ));
            }
            for (r, row) in seen.iter_mut().enumerate().skip(c.row).take(c.rowspan) {
                for (k, slot) in row.iter_mut().enumerate().skip(c.col).take(c.colspan) {
                    if *slot {
                        problems.push(format!("position ({r},{k}) belongs to two cells"));
                    }
                    *slot = true;
                }
            }
        }
        let holes: Vec<String> = (0..self.rows)
            .flat_map(|r| (0..self.cols).map(move |k| (r, k)))
            .filter(|&(r, k)| !seen[r][k])
            .take(5)
            .map(|(r, k)| format!("({r}, {k})"))
            .collect();
        if !holes.is_empty() {
            problems.push(format!("positions without a cell: [{}]", holes.join(", ")));
        }
        for c in &self.cells {
            if c.text.contains("\\\\") {
                problems.push(format!(
                    "cell ({},{}) text has two backslashes in a row, \
                     which LTEM 1.0 reads as a line break",
                    c.row, c.col
                ));
            }
        }
        problems
    }

    /// The table model as compact JSON.
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("a table model always serializes")
    }

    /// The table model as JSON indented by two spaces.
    pub fn to_json_pretty(&self) -> String {
        serde_json::to_string_pretty(self).expect("a table model always serializes")
    }

    /// Read a table model from JSON.
    ///
    /// Checks the version and the field types. It does not check the rules beyond the
    /// schema; use [`Table::check`] for that.
    pub fn from_json(json: &str) -> Result<Table, ModelError> {
        serde_json::from_str(json).map_err(|e| ModelError {
            message: e.to_string(),
        })
    }
}

/// Cells sorted by row and column, as the model's `cells` array.
struct SortedCells<'a>(&'a [Cell]);

impl Serialize for SortedCells<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut cells: Vec<&Cell> = self.0.iter().collect();
        cells.sort_by_key(|c| (c.row, c.col));
        let mut seq = serializer.serialize_seq(Some(cells.len()))?;
        for cell in cells {
            seq.serialize_element(cell)?;
        }
        seq.end()
    }
}

impl Serialize for Table {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("Table", 6)?;
        s.serialize_field("version", MODEL_VERSION)?;
        s.serialize_field("rows", &self.rows)?;
        s.serialize_field("cols", &self.cols)?;
        s.serialize_field("header_rows", &self.header_rows)?;
        s.serialize_field("align", &self.align)?;
        s.serialize_field("cells", &SortedCells(&self.cells))?;
        s.end()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TableRepr {
    version: String,
    rows: usize,
    cols: usize,
    header_rows: usize,
    align: Vec<Option<Align>>,
    cells: Vec<Cell>,
}

impl<'de> Deserialize<'de> for Table {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Table, D::Error> {
        let t = TableRepr::deserialize(deserializer)?;
        if t.version != MODEL_VERSION {
            return Err(serde::de::Error::custom(format!(
                "unsupported table model version: {:?}",
                t.version
            )));
        }
        Ok(Table {
            rows: t.rows,
            cols: t.cols,
            header_rows: t.header_rows,
            align: t.align,
            cells: t.cells,
        })
    }
}

/// A validation problem (spec Section 5).
///
/// Its JSON form is the conformance protocol's `{"rule", "row", "col"}`; the message is
/// for people and is not serialized.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Problem {
    /// The rule, such as `"V13"`.
    pub rule: String,
    /// The grid row of the cell, placeholder or marker concerned.
    pub row: usize,
    /// The grid column, or `None` for a problem that concerns a whole row (V14).
    pub col: Option<usize>,
    /// A description of the problem.
    #[serde(skip)]
    pub message: String,
}

impl Problem {
    /// A problem with the given rule, position and message.
    pub fn new(
        rule: impl Into<String>,
        row: usize,
        col: Option<usize>,
        message: impl Into<String>,
    ) -> Problem {
        Problem {
            rule: rule.into(),
            row,
            col,
            message: message.into(),
        }
    }

    /// `"warning"` for V14, which leaves the table valid; `"error"` for every other rule.
    pub fn severity(&self) -> &'static str {
        if self.rule == "V14" {
            "warning"
        } else {
            "error"
        }
    }
}

impl fmt::Display for Problem {
    /// For example `V13 at (1,0): '<<' has no cell to extend`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.col {
            Some(col) => write!(
                f,
                "{} at ({},{}): {}",
                self.rule, self.row, col, self.message
            ),
            None => write!(f, "{} at row {}: {}", self.rule, self.row, self.message),
        }
    }
}

/// Where a cell is in the LTEM source.
///
/// `line` counts lines of the parsed text from 0, like `start` and `end` of a
/// [`ParseResult`](crate::ParseResult). `start` and `end` are UTF-8 byte offsets into
/// that line, so `&line[start..end]` is the cell's source: without the spaces and tabs
/// around it, with any span attribute and escapes. An empty cell has `start == end` at
/// the end of its space between the pipes. A cell added by padding (rule V14) has no
/// source; it gets `start == end ==` the length of its row's line.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellSource {
    /// Row of the cell's origin in the table.
    pub row: usize,
    /// Column of the cell's origin in the table.
    pub col: usize,
    /// Rows the cell spans.
    pub rowspan: usize,
    /// Columns the cell spans.
    pub colspan: usize,
    /// Line of the cell's source in the parsed text.
    pub line: usize,
    /// Byte offset of the start of the cell's source in its line.
    pub start: usize,
    /// Byte offset just past the end of the cell's source in its line.
    pub end: usize,
}
