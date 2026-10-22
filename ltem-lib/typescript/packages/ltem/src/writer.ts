/** Writing tables in the canonical form (spec Section 8). */

import { checkTable, ownerGrid, type Alignment, type CellSource, type Table } from "./model.js";
import { parseTable } from "./parser.js";
import { COLSPAN_MARKER, DELIMITER_CELL, IDENTIFIER_ROW, ROWSPAN_MARKER, SPAN_ATTRIBUTE } from "./syntax.js";

function delimiterCell(align: Alignment): string {
  switch (align) {
    case "left": return ":---";
    case "right": return "---:";
    case "center": return ":---:";
    default: return "---";
  }
}

/** Turn model text into cell source, adding only the escapes spec 4.3 requires. */
function escape(text: string): string {
  const lines = text.split("\n").map((source) => {
    let line = source.replaceAll("|", "\\|");
    if (line === COLSPAN_MARKER || line === ROWSPAN_MARKER) line = "\\" + line;
    const m = SPAN_ATTRIBUTE.exec(line);
    if (m) line = line.slice(0, m.index) + "\\" + line.slice(m.index);
    return line;
  });
  return lines.join(" \\\\ ");
}

/**
 * Write a table in the canonical form.
 *
 * Every row is a grid row. A covered position in the column of its cell's origin is
 * written `^^` and every other covered position `<<`. No span attributes are used.
 * Throws an Error if the table model is not valid (see `checkTable`).
 */
export function write(table: Table): string {
  const problems = checkTable(table);
  if (problems.length) throw new Error("invalid table model: " + problems.join("; "));
  const grid = ownerGrid(table);
  const rows: string[][] = [];
  for (let r = 0; r < table.rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < table.cols; c++) {
      const cell = grid[r][c]!;
      if (cell.row === r && cell.col === c) row.push(escape(cell.text));
      else if (c === cell.col) row.push(ROWSPAN_MARKER);
      else row.push(COLSPAN_MARKER);
    }
    rows.push(row);
  }

  // A header row made only of hyphen cells would read as the delimiter row (spec 4.3).
  for (let r = 0; r < table.header_rows; r++) {
    if (rows[r].every((t) => DELIMITER_CELL.test(t))) rows[r][0] = "\\" + rows[r][0];
  }
  const line = (row: string[]): string => "| " + row.join(" | ") + " |";
  // A header row above the last one must not look like a reserved identifier line,
  // which would end the header rows (spec 4.3, Section 9).
  for (let r = 0; r < table.header_rows - 1; r++) {
    if (IDENTIFIER_ROW.test(line(rows[r]))) rows[r][0] = "\\" + rows[r][0];
  }
  const lines = rows.map(line);
  const delimiter = line(table.align.map(delimiterCell));
  return [...lines.slice(0, table.header_rows), delimiter, ...lines.slice(table.header_rows)].join("\n");
}

/**
 * Write a table in the canonical form, with where each cell is in the output.
 *
 * Lines count from the table's first line (0); offsets are UTF-16 code units. See
 * `CellSource`.
 */
export function writeWithSources(table: Table): { text: string; sources: CellSource[] } {
  const text = write(table);
  return { text, sources: parseTable(text).sources };
}
