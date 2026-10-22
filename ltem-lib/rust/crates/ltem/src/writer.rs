//! Writing tables in the canonical form (spec Section 8).

use std::fmt;

use crate::model::{Align, CellSource, Table};
use crate::syntax::{
    find_span_attribute, is_delimiter_cell, is_identifier_row, COLSPAN_MARKER, ROWSPAN_MARKER,
};

/// A table model that cannot be written because it breaks the model rules.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WriteError {
    /// The violations, as [`Table::check`] reports them.
    pub problems: Vec<String>,
}

impl fmt::Display for WriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid table model: {}", self.problems.join("; "))
    }
}

impl std::error::Error for WriteError {}

fn delimiter_cell(align: Option<Align>) -> &'static str {
    match align {
        None => "---",
        Some(Align::Left) => ":---",
        Some(Align::Right) => "---:",
        Some(Align::Center) => ":---:",
    }
}

/// Turn model text into cell source, adding only the escapes spec 4.3 requires.
fn escape(text: &str) -> String {
    let lines: Vec<String> = text
        .split('\n')
        .map(|source| {
            let mut line = source.replace('|', "\\|");
            if line == COLSPAN_MARKER || line == ROWSPAN_MARKER {
                line.insert(0, '\\');
            }
            if let Some(open) = find_span_attribute(&line) {
                line.insert(open, '\\');
            }
            line
        })
        .collect();
    lines.join(" \\\\ ")
}

fn row_line(row: &[String]) -> String {
    format!("| {} |", row.join(" | "))
}

/// Write a table in the canonical form (spec Section 8).
///
/// Every row is a grid row. A covered position in the column of its cell's origin is
/// written `^^` and every other covered position `<<`. No span attributes are used.
/// Fails if the table breaks the model rules (see [`Table::check`]).
pub fn write(table: &Table) -> Result<String, WriteError> {
    let problems = table.check();
    if !problems.is_empty() {
        return Err(WriteError { problems });
    }
    let grid = table.owner_grid();
    let mut rows: Vec<Vec<String>> = Vec::with_capacity(table.rows);
    for (r, owners) in grid.iter().enumerate() {
        let row = owners
            .iter()
            .enumerate()
            .map(|(c, owner)| {
                // A valid model gives every position an owner.
                let cell = &table.cells[owner.expect("checked model")];
                if (cell.row, cell.col) == (r, c) {
                    escape(&cell.text)
                } else if c == cell.col {
                    ROWSPAN_MARKER.to_string()
                } else {
                    COLSPAN_MARKER.to_string()
                }
            })
            .collect();
        rows.push(row);
    }

    // A header row made only of hyphen cells would read as the delimiter row (spec 4.3).
    for row in rows.iter_mut().take(table.header_rows) {
        if row.iter().all(|t| is_delimiter_cell(t)) {
            row[0].insert(0, '\\');
        }
    }
    // A header row above the last one must not look like a reserved identifier line,
    // which would end the header rows (spec 4.3, Section 9).
    for row in rows.iter_mut().take(table.header_rows - 1) {
        if is_identifier_row(&row_line(row)) {
            row[0].insert(0, '\\');
        }
    }
    let lines: Vec<String> = rows.iter().map(|row| row_line(row)).collect();
    let delimiter: Vec<String> = table
        .align
        .iter()
        .map(|&a| delimiter_cell(a).to_string())
        .collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len() + 1);
    out.extend_from_slice(&lines[..table.header_rows]);
    out.push(row_line(&delimiter));
    out.extend_from_slice(&lines[table.header_rows..]);
    Ok(out.join("\n"))
}

/// Write a table in the canonical form, with where each cell is in the output.
///
/// The sources are in the order of `table.cells`; their lines count from the table's
/// first line (0). See [`CellSource`] for the units.
pub fn write_with_sources(table: &Table) -> Result<(String, Vec<CellSource>), WriteError> {
    let text = write(table)?;
    let sources = crate::parser::parse_table(text.as_str(), 0).sources;
    Ok((text, sources))
}
