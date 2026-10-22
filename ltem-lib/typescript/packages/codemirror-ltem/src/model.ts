/**
 * Edits of a table model (the LTEM core's `Table`): rows, columns, merged cells and cell
 * ranges. They return a new model and leave the given one as it is; the editor writes the
 * result back (see commands.ts).
 */

import { ownerGrid, type Alignment, type Cell, type Table } from "ltem-core";

function copy(table: Table): Table {
  return { ...table, align: [...table.align], cells: table.cells.map((c) => ({ ...c })) };
}

function sorted(table: Table): Table {
  table.cells.sort((a, b) => a.row - b.row || a.col - b.col);
  return table;
}

/** Add an empty 1x1 cell at every position of the grid that no cell owns. */
function fillHoles(table: Table): Table {
  const grid = ownerGrid(table);
  for (let r = 0; r < table.rows; r++) {
    for (let c = 0; c < table.cols; c++) {
      if (!grid[r][c]) table.cells.push({ row: r, col: c, rowspan: 1, colspan: 1, text: "" });
    }
  }
  return sorted(table);
}

/**
 * The table with `n` header rows. A merged cell across the new line between the header and
 * the body is cut there (rule V7: no merged cell crosses it): its upper part keeps the text,
 * and the lower part becomes an empty merged cell of the same width.
 */
function withHeaderRows(source: Table, n: number): Table {
  const table = copy(source);
  table.header_rows = n;
  const cells: Cell[] = [];
  for (const c of table.cells) {
    if (c.row < n && c.row + c.rowspan > n) {
      cells.push({ ...c, rowspan: n - c.row });
      cells.push({ row: n, col: c.col, rowspan: c.row + c.rowspan - n, colspan: c.colspan, text: "" });
    } else {
      cells.push(c);
    }
  }
  table.cells = cells;
  return sorted(table);
}

/**
 * Whether a table has no header: a single header row of empty cells (specification
 * Section 11), which tools may read as "no header".
 */
export function hasEmptyHeader(table: Table): boolean {
  if (table.header_rows !== 1) return false;
  const first = table.cells.filter((c) => c.row === 0);
  return first.length === table.cols && first.every((c) => c.text === "" && c.colspan === 1 && c.rowspan === 1);
}

/**
 * Make `row` and the rows above it header rows. In a table with no header (an empty header
 * row), the empty header row goes, and the rows from the first body row to `row` become the
 * header. Null if `row` is a header row already.
 */
export function makeHeaderRows(source: Table, row: number): Table | null {
  if (row < source.header_rows || row >= source.rows) return null;
  if (hasEmptyHeader(source)) {
    const table = copy(source);
    table.rows--;
    table.cells = table.cells.filter((c) => c.row > 0).map((c) => ({ ...c, row: c.row - 1 }));
    return withHeaderRows(table, row);
  }
  return withHeaderRows(source, row + 1);
}

/**
 * Make `row` and the rows below it body rows. When that leaves no header row (`row` is the
 * first row), an empty header row is added above: a table with no header (specification
 * Section 11). Null if `row` is a body row already, or the empty header row of such a table.
 */
export function makeBodyRows(source: Table, row: number): Table | null {
  if (row >= source.header_rows || row < 0) return null;
  if (row > 0) return withHeaderRows(source, row);
  if (hasEmptyHeader(source)) return null;
  const table = copy(source);
  table.rows++;
  table.header_rows = 1;
  table.cells = [
    ...Array.from({ length: table.cols }, (_, col): Cell => ({ row: 0, col, rowspan: 1, colspan: 1, text: "" })),
    ...table.cells.map((c) => ({ ...c, row: c.row + 1 })),
  ];
  return sorted(table);
}

/** Insert an empty row so that it becomes row `at`; it is a header row if `header`. */
export function insertRow(source: Table, at: number, header: boolean): Table {
  const t = copy(source);
  for (const cell of t.cells) {
    if (cell.row >= at) cell.row++;
    else if (cell.row + cell.rowspan > at) cell.rowspan++;
  }
  t.rows++;
  if (header) t.header_rows++;
  return fillHoles(t);
}

/** Delete row `at`. Returns null for the only row or the only header row. */
export function deleteRow(source: Table, at: number): Table | null {
  if (source.rows === 1 || (at < source.header_rows && source.header_rows === 1)) return null;
  const t = copy(source);
  t.cells = t.cells.filter((cell) => !(cell.row === at && cell.rowspan === 1));
  for (const cell of t.cells) {
    if (cell.row > at) cell.row--;
    else if (cell.row + cell.rowspan > at) cell.rowspan--;
  }
  t.rows--;
  if (at < t.header_rows) t.header_rows--;
  return fillHoles(t);
}

/** Insert an empty column so that it becomes column `at`. */
export function insertColumn(source: Table, at: number): Table {
  const t = copy(source);
  for (const cell of t.cells) {
    if (cell.col >= at) cell.col++;
    else if (cell.col + cell.colspan > at) cell.colspan++;
  }
  t.cols++;
  t.align.splice(at, 0, null);
  return fillHoles(t);
}

/** Delete column `at`. Returns null for the only column. */
export function deleteColumn(source: Table, at: number): Table | null {
  if (source.cols === 1) return null;
  const t = copy(source);
  t.cells = t.cells.filter((cell) => !(cell.col === at && cell.colspan === 1));
  for (const cell of t.cells) {
    if (cell.col > at) cell.col--;
    else if (cell.col + cell.colspan > at) cell.colspan--;
  }
  t.cols--;
  t.align.splice(at, 1);
  return fillHoles(t);
}

function joinText(a: string, b: string): string {
  return a && b ? `${a}\n${b}` : a || b;
}

/**
 * Merge the cell that owns (row, col) with the cell to its right or below, when the two
 * line up. Their texts are kept, one per line. Returns null if they cannot be merged, for
 * example a header cell with a body cell (rule V7).
 */
export function mergeCells(source: Table, row: number, col: number, direction: "right" | "down"): Table | null {
  const t = copy(source);
  const grid = ownerGrid(t);
  const x = grid[row]?.[col];
  if (!x) return null;
  let y: Cell | null;
  if (direction === "right") {
    y = grid[x.row][x.col + x.colspan] ?? null;
    if (!y || y.row !== x.row || y.rowspan !== x.rowspan) return null;
    x.colspan += y.colspan;
  } else {
    y = grid[x.row + x.rowspan]?.[x.col] ?? null;
    if (!y || y.col !== x.col || y.colspan !== x.colspan) return null;
    if (x.row < t.header_rows && y.row >= t.header_rows) return null;
    x.rowspan += y.rowspan;
  }
  x.text = joinText(x.text, y.text);
  t.cells = t.cells.filter((c) => c !== y);
  return sorted(t);
}

/** Split the cell that owns (row, col) into 1x1 cells; its text stays in the first one. */
export function splitCell(source: Table, row: number, col: number): Table | null {
  const t = copy(source);
  const x = ownerGrid(t)[row]?.[col];
  if (!x || (x.rowspan === 1 && x.colspan === 1)) return null;
  x.rowspan = 1;
  x.colspan = 1;
  return fillHoles(t);
}

/**
 * Shrink the merged cell that covers (row, col) so that the position becomes a cell of its
 * own: the merged cell keeps the columns to the left of the position, or, when the position
 * is in its first column, the rows above it. The positions it no longer covers become empty
 * cells. Returns null if no merged cell covers the position.
 */
export function uncoverCell(source: Table, row: number, col: number): Table | null {
  const t = copy(source);
  const x = ownerGrid(t)[row]?.[col];
  if (!x || (x.row === row && x.col === col)) return null;
  if (col > x.col) x.colspan = col - x.col;
  else x.rowspan = row - x.row;
  return fillHoles(t);
}

/**
 * Swap row `row` with the row `delta` (-1 or 1) away. Both rows must be in the same part
 * of the table (header or body), and no cell may span into or out of either of them.
 */
export function moveRow(source: Table, row: number, delta: -1 | 1): Table | null {
  const other = row + delta;
  if (other < 0 || other >= source.rows) return null;
  if ((row < source.header_rows) !== (other < source.header_rows)) return null;
  const grid = ownerGrid(source);
  for (const r of [row, other]) {
    for (let c = 0; c < source.cols; c++) {
      const owner = grid[r][c]!;
      if (owner.row !== r || owner.rowspan !== 1) return null;
    }
  }
  const t = copy(source);
  for (const cell of t.cells) {
    if (cell.row === row) cell.row = other;
    else if (cell.row === other) cell.row = row;
  }
  return sorted(t);
}

/** Swap column `col` with the column `delta` (-1 or 1) away. No cell may span into or out of either. */
export function moveColumn(source: Table, col: number, delta: -1 | 1): Table | null {
  const other = col + delta;
  if (other < 0 || other >= source.cols) return null;
  const grid = ownerGrid(source);
  for (let r = 0; r < source.rows; r++) {
    for (const c of [col, other]) {
      const owner = grid[r][c]!;
      if (owner.col !== c || owner.colspan !== 1) return null;
    }
  }
  const t = copy(source);
  for (const cell of t.cells) {
    if (cell.col === col) cell.col = other;
    else if (cell.col === other) cell.col = col;
  }
  [t.align[col], t.align[other]] = [t.align[other], t.align[col]];
  return sorted(t);
}

/** Set the alignment of column `col`. */
export function alignColumn(source: Table, col: number, align: Alignment): Table {
  const t = copy(source);
  t.align[col] = align;
  return t;
}

/** An empty table: `rows` rows in all, the first `headerRows` of them header rows. */
export function emptyTable(rows: number, cols: number, headerRows = 1): Table {
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ row: r, col: c, rowspan: 1, colspan: 1, text: "" });
  return { version: "1.0", rows, cols, header_rows: Math.min(Math.max(1, headerRows), rows), align: new Array(cols).fill(null), cells };
}


// -- cell ranges -------------------------------------------------------------------------

/** A rectangle of grid positions, both ends included. */
export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** A grid position. */
export interface GridPosition {
  row: number;
  col: number;
}

/**
 * The range from position `a` to position `b`, widened, as a spreadsheet does, until every
 * merged cell it touches lies wholly inside it.
 */
export function cellRange(table: Table, a: GridPosition, b: GridPosition): CellRange {
  const grid = ownerGrid(table);
  const r: CellRange = {
    top: Math.min(a.row, b.row), left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row), right: Math.max(a.col, b.col),
  };
  r.top = Math.max(0, r.top);
  r.left = Math.max(0, r.left);
  r.bottom = Math.min(table.rows - 1, r.bottom);
  r.right = Math.min(table.cols - 1, r.right);
  for (let grown = true; grown;) {
    grown = false;
    for (let row = r.top; row <= r.bottom; row++) {
      for (let col = r.left; col <= r.right; col++) {
        const cell = grid[row][col];
        if (!cell) continue;
        const bottom = cell.row + cell.rowspan - 1;
        const right = cell.col + cell.colspan - 1;
        if (cell.row < r.top || cell.col < r.left || bottom > r.bottom || right > r.right) {
          r.top = Math.min(r.top, cell.row);
          r.left = Math.min(r.left, cell.col);
          r.bottom = Math.max(r.bottom, bottom);
          r.right = Math.max(r.right, right);
          grown = true;
        }
      }
    }
  }
  return r;
}

/** The cells whose origin is inside a range, in reading order. */
export function cellsIn(table: Table, range: CellRange): Cell[] {
  return table.cells.filter((c) => c.row >= range.top && c.row <= range.bottom && c.col >= range.left && c.col <= range.right);
}

/** Whether a range is one cell (one position, or exactly one merged cell). */
export function isOneCell(table: Table, range: CellRange): boolean {
  const cells = cellsIn(table, range);
  return cells.length === 1;
}

/**
 * Merge the cells of a range into one, keeping their texts one per line in reading order.
 * Returns null for a range of one cell, or one that holds header and body rows (rule V7).
 */
export function mergeRange(source: Table, range: CellRange): Table | null {
  if (isOneCell(source, range)) return null;
  if (range.top < source.header_rows && range.bottom >= source.header_rows) return null;
  const t = copy(source);
  const inside = cellsIn(t, range);
  const first = inside.find((c) => c.row === range.top && c.col === range.left)!;
  first.text = inside.map((c) => c.text).filter((text) => text !== "").join("\n");
  first.rowspan = range.bottom - range.top + 1;
  first.colspan = range.right - range.left + 1;
  t.cells = t.cells.filter((c) => c === first || !inside.includes(c));
  return sorted(t);
}

/** Empty the cells of a range. Returns null if they are empty already. */
export function clearRange(source: Table, range: CellRange): Table | null {
  const t = copy(source);
  const inside = cellsIn(t, range).filter((c) => c.text !== "");
  if (!inside.length) return null;
  for (const c of inside) c.text = "";
  return t;
}

/** The texts of a range by grid position: a cell's text at its origin, "" where it is merged into another. */
export function rangeTexts(table: Table, range: CellRange): string[][] {
  const out: string[][] = [];
  for (let row = range.top; row <= range.bottom; row++) out.push(new Array(range.right - range.left + 1).fill(""));
  for (const c of cellsIn(table, range)) out[c.row - range.top][c.col - range.left] = c.text;
  return out;
}

/** The part of a table in a range, as a table of its own (its header rows are the range's rows that are header rows). */
export function rangeTable(table: Table, range: CellRange): Table {
  return {
    version: table.version,
    rows: range.bottom - range.top + 1,
    cols: range.right - range.left + 1,
    header_rows: Math.max(0, Math.min(table.header_rows - range.top, range.bottom - range.top + 1)),
    align: table.align.slice(range.left, range.right + 1),
    cells: cellsIn(table, range).map((c) => ({
      ...c,
      row: c.row - range.top,
      col: c.col - range.left,
      rowspan: Math.min(c.rowspan, range.bottom - c.row + 1),
      colspan: Math.min(c.colspan, range.right - c.col + 1),
    })),
  };
}

/**
 * Put texts into a table from position `at` on, as pasting a block of cells does: the
 * table grows by body rows and by columns to hold them, merged cells in the way are split,
 * and each text goes into the cell at its position.
 */
export function fillCells(source: Table, at: GridPosition, texts: string[][]): Table {
  const height = texts.length;
  const width = Math.max(0, ...texts.map((row) => row.length));
  let t = copy(source);
  while (t.rows < at.row + height) t = insertRow(t, t.rows, false);
  while (t.cols < at.col + width) t = insertColumn(t, t.cols);
  const inArea = (c: Cell): boolean =>
    c.row <= at.row + height - 1 && c.row + c.rowspan - 1 >= at.row && c.col <= at.col + width - 1 && c.col + c.colspan - 1 >= at.col;
  let split = false;
  for (const c of t.cells) {
    if ((c.rowspan > 1 || c.colspan > 1) && inArea(c)) {
      c.rowspan = 1;
      c.colspan = 1;
      split = true;
    }
  }
  if (split) t = fillHoles(t);
  const grid = ownerGrid(t);
  texts.forEach((row, i) => row.forEach((text, j) => {
    grid[at.row + i][at.col + j]!.text = text;
  }));
  return t;
}

/**
 * Put a table into a table from position `at` on, as pasting cells does, keeping its merged
 * cells: the texts go in as with `fillCells`, then each merged cell of the pasted table is
 * merged again where it lands. A merged cell that would hold both header and body rows
 * (rule V7) stays split.
 */
export function pasteTable(source: Table, at: GridPosition, pasted: Table): Table {
  let t = fillCells(source, at, rangeTexts(pasted, { top: 0, left: 0, bottom: pasted.rows - 1, right: pasted.cols - 1 }));
  for (const c of pasted.cells) {
    if (c.rowspan === 1 && c.colspan === 1) continue;
    const area: CellRange = {
      top: at.row + c.row, left: at.col + c.col,
      bottom: at.row + c.row + c.rowspan - 1, right: at.col + c.col + c.colspan - 1,
    };
    if (area.top < t.header_rows && area.bottom >= t.header_rows) continue;
    t = mergeRange(t, area) ?? t;
  }
  return t;
}
