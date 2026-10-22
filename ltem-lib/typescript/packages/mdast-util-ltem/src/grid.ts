/** Where the cells of an mdast table are in its grid. */

import type { Table, TableCell } from "mdast";

/** A cell of a table and the positions it covers. */
export interface PlacedCell {
  node: TableCell;
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

/** A table's grid: its size, header rows, and each row's cells in column order. */
export interface Grid {
  cols: number;
  headerRows: number;
  rows: PlacedCell[][];
  /** The positions of each row that no cell covers, which come after its cells. */
  holes: number[][];
}

// Spans above these values count as these values, as in HTML.
const MAX_COLSPAN = 1000;
const MAX_ROWSPAN = 65534;

function span(value: number | undefined, max: number): number {
  return Math.min(Math.max(Math.trunc(value ?? 1) || 1, 1), max);
}

/**
 * Lay the cells out as HTML does: each cell takes the next column that no cell above
 * covers. Spans are cut where they would leave the grid, overlap a cell, or (for header
 * cells) reach into the body, columns first, so that every position belongs to at most
 * one cell. The number of columns is that of `align`, or else the width the cells need.
 */
export function layout(table: Table): Grid {
  const headerRows = Math.min(Math.max(table.headerRows ?? 1, 1), Math.max(table.children.length, 1));
  if (table.align?.length) return place(table, headerRows, table.align.length);
  // Without alignment: wide enough for every cell, then as wide as the cells need.
  let bound = 0;
  for (const row of table.children) {
    bound = Math.max(bound, row.children.reduce((sum, cell) => sum + span(cell.colspan, MAX_COLSPAN), 0));
  }
  for (const row of table.children) {
    for (const cell of row.children) if (span(cell.rowspan, MAX_ROWSPAN) > 1) bound += span(cell.colspan, MAX_COLSPAN);
  }
  const wide = place(table, headerRows, bound);
  const cols = Math.max(1, ...wide.rows.flat().map((cell) => cell.col + cell.colspan));
  return place(table, headerRows, cols);
}

function place(table: Table, headerRows: number, cols: number): Grid {
  const rowCount = table.children.length;
  const taken = Array.from({ length: rowCount }, () => new Array<boolean>(cols).fill(false));
  const rows: PlacedCell[][] = [];
  const holes: number[][] = [];
  table.children.forEach((row, r) => {
    const bottom = r < headerRows ? headerRows : rowCount;
    const placed: PlacedCell[] = [];
    let c = 0;
    for (const node of row.children) {
      while (c < cols && taken[r][c]) c++;
      if (c >= cols) break; // cells past the last column are dropped, as in GFM
      const maxColspan = span(node.colspan, MAX_COLSPAN);
      let colspan = 1;
      while (colspan < maxColspan && c + colspan < cols && !taken[r][c + colspan]) colspan++;
      const maxRowspan = span(node.rowspan, MAX_ROWSPAN);
      let rowspan = 1;
      while (rowspan < maxRowspan && r + rowspan < bottom
             && taken[r + rowspan].slice(c, c + colspan).every((t) => !t)) rowspan++;
      for (let dr = 0; dr < rowspan; dr++) taken[r + dr].fill(true, c, c + colspan);
      placed.push({ node, row: r, col: c, rowspan, colspan });
      c += colspan;
    }
    rows.push(placed);
    holes.push(taken[r].flatMap((t, col) => (t ? [] : [col])));
  });
  return { cols, headerRows, rows, holes };
}
