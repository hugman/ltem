/** Random valid tables and helpers shared by the tests of the writer, cell sources and HTML conversion. */

import type { Alignment, Cell, Table } from "../packages/ltem/dist/index.js";
import type { Random } from "./conformance.ts";

export function makeTable(rows: number, cols: number, headerRows: number, align: Alignment[], cells: Cell[]): Table {
  return { version: "1.0", rows, cols, header_rows: headerRows, align, cells };
}

export function cell(row: number, col: number, text: string, rowspan = 1, colspan = 1): Cell {
  return { row, col, rowspan, colspan, text };
}

/** Model texts: what a parser produces, so LTEM escapes are already removed. */
export const TEXTS = ["", "x", "Revenue", "**Q1**", "a | b", "line 1\nline 2", "\u3000indent",
  "<<", "^^", "a << b", "{c:2}", "x {r:3}", "$5 ~ $10", "-", "100"];

/** A random valid table: spans fill free rectangles and stay within header or body. */
export function randomTable(rng: Random, rows: number, cols: number, headerRows: number,
                            texts: readonly string[] = TEXTS): Table {
  const taken = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (taken[r][c]) continue;
      const bottom = r < headerRows ? headerRows : rows;
      let maxCs = 1;
      while (c + maxCs < cols && !taken[r][c + maxCs] && maxCs < 4) maxCs++;
      const cs = rng.random() < 0.3 ? rng.randint(1, maxCs) : 1;
      let rs = rng.random() < 0.3 ? rng.randint(1, Math.min(3, bottom - r)) : 1;
      while (rs > 1 && taken[r + rs - 1].slice(c, c + cs).some(Boolean)) rs--;
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) taken[r + dr][c + dc] = true;
      cells.push(cell(r, c, rng.choice(texts), rs, cs));
    }
  }
  const align = Array.from({ length: cols }, () => rng.choice<Alignment>([null, "left", "center", "right"]));
  return makeTable(rows, cols, headerRows, align, cells);
}

/** A cell text with the CommonMark escapes the writer may add (\-, \:, \#) removed. */
export function unescapeWriter(text: string): string {
  return /^\\[-:#]/.test(text) ? text.slice(1) : text;
}

/**
 * The table with the CommonMark escapes the writer may add removed.
 *
 * The writer escapes a header row made only of hyphen cells, and a first row that would
 * read as a reserved identifier line. Those escapes are ordinary CommonMark escapes,
 * so they stay in the text; they do not change how it renders.
 */
export function normalized(table: Table): Table {
  return { ...table, cells: table.cells.map((c) => ({ ...c, text: unescapeWriter(c.text) })) };
}
