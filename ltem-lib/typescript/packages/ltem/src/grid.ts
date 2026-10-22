/** Span resolution (spec Section 3): grid rows, compact rows, markers and recovery. */

import type { Problem } from "./model.js";
import { repr } from "./pychar.js";
import { COLSPAN_MARKER, ROWSPAN_MARKER, splitAttribute } from "./syntax.js";

/** How a row was read (spec 3.2). "padded" means it fit neither form (V14). */
export type RowForm = "grid" | "compact" | "padded";

interface Origin {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
  text: string;
  /** colspan came from an attribute: markers may not extend it */
  fixedCols: boolean;
  /** rowspan came from an attribute */
  fixedRows: boolean;
  /** Index of the cell in its source row; null if added by padding (rule V14). */
  source: number | null;
}

/** Places the cells of a table row by row, as spec Section 3 describes. */
export class GridBuilder {
  readonly cols: number;
  readonly headerRows: number;
  readonly rows: number;
  readonly owner: (Origin | null)[][];
  readonly origins: Origin[] = [];
  readonly problems: Problem[] = [];
  /** Undo steps while a compact row is tried (see tryCompact). */
  private journal: (() => void)[] | null = null;

  constructor(cols: number, headerRows: number, rows: number) {
    this.cols = cols;
    this.headerRows = headerRows;
    this.rows = rows;
    this.owner = Array.from({ length: rows }, () => new Array<Origin | null>(cols).fill(null));
  }

  // -- helpers -----------------------------------------------------------------

  private report(rule: string, row: number, col: number | null, message: string): void {
    this.problems.push({ rule, row, col, message });
  }

  private free(r0: number, r1: number, c0: number, c1: number): boolean {
    for (let r = r0; r < Math.min(r1, this.rows); r++) {
      for (let c = c0; c < Math.min(c1, this.cols); c++) {
        if (this.owner[r][c] !== null) return false;
      }
    }
    return true;
  }

  private cover(origin: Origin, r0: number, r1: number, c0: number, c1: number): void {
    for (let r = r0; r < Math.min(r1, this.rows); r++) {
      const row = this.owner[r];
      for (let c = c0; c < Math.min(c1, this.cols); c++) {
        const previous = row[c];
        this.journal?.push(() => { row[c] = previous; });
        row[c] = origin;
      }
    }
  }

  // -- placing (spec 3.3, 3.4) ---------------------------------------------------

  private extendLeft(r: number, c: number): boolean {
    const left = c > 0 ? this.owner[r][c - 1] : null;
    if (left === null || left.row !== r || left.col + left.colspan !== c || left.fixedCols) {
      this.report("V13", r, c, "'<<' has no cell to extend");
      return false;
    }
    if (!this.free(r + 1, left.row + left.rowspan, c, c + 1)) {
      this.report("V4", r, c, "'<<' would make two cells overlap");
      return false;
    }
    left.colspan += 1;
    this.journal?.push(() => { left.colspan -= 1; });
    this.cover(left, left.row, left.row + left.rowspan, c, c + 1);
    return true;
  }

  private extendUp(r: number, c: number): boolean {
    const up = r > 0 ? this.owner[r - 1][c] : null;
    if (up === null || up.col !== c || up.row + up.rowspan !== r || up.fixedRows) {
      this.report("V13", r, c, "'^^' has no cell to extend");
      return false;
    }
    if (up.row < this.headerRows && this.headerRows <= r) {
      this.report("V7", r, c, "'^^' would extend a header cell into the body");
      return false;
    }
    if (!this.free(r, r + 1, c + 1, up.col + up.colspan)) {
      this.report("V4", r, c, "'^^' would make two cells overlap");
      return false;
    }
    up.rowspan += 1;
    this.journal?.push(() => { up.rowspan -= 1; });
    this.cover(up, r, r + 1, up.col, up.col + up.colspan);
    return true;
  }

  /** Place a cell at the position (r, c), which is not covered. */
  private place(r: number, c: number, cellText: string, source: number | null): void {
    if (cellText === COLSPAN_MARKER && this.extendLeft(r, c)) return;
    if (cellText === ROWSPAN_MARKER && this.extendUp(r, c)) return;
    let text = cellText;
    let colspan = 1;
    let rowspan = 1;
    let fixedCols = false;
    let fixedRows = false;
    if (text !== COLSPAN_MARKER && text !== ROWSPAN_MARKER) {
      // An unusable marker stays literal text.
      const [rest, attr] = splitAttribute(text);
      text = rest;
      if (attr) {
        for (const message of attr.problems) this.report("V1", r, c, message);
        colspan = attr.colspan ?? 1;
        fixedCols = attr.colspan !== null;
        rowspan = attr.rowspan ?? 1;
        fixedRows = attr.rowspan !== null;
      }
    }
    if (c + colspan > this.cols) {
      this.report("V2", r, c, `colspan ${colspan} reaches past the last column`);
      colspan = this.cols - c;
    }
    if (r + rowspan > this.rows) {
      this.report("V3", r, c, `rowspan ${rowspan} reaches past the last row`);
      rowspan = this.rows - r;
    }
    if (r < this.headerRows && this.headerRows < r + rowspan) {
      this.report("V7", r, c, "a header cell spans into the body");
      rowspan = this.headerRows - r;
    }
    // V4: cut to the largest rectangle that overlaps nothing, columns first, then rows.
    let k = 1;
    while (k < colspan && this.owner[r][c + k] === null) k++;
    let j = 1;
    while (j < rowspan && this.free(r + j, r + j + 1, c, c + k)) j++;
    if (k !== colspan || j !== rowspan) {
      this.report("V4", r, c, `span cut from ${colspan}x${rowspan} to ${k}x${j} to avoid an overlap`);
      colspan = k;
      rowspan = j;
    }
    const origin: Origin = { row: r, col: c, rowspan, colspan, text, fixedCols, fixedRows, source };
    this.origins.push(origin);
    this.journal?.push(() => { this.origins.pop(); });
    this.cover(origin, r, r + rowspan, c, c + colspan);
  }

  // -- rows (spec 3.2) -----------------------------------------------------------

  /**
   * Place row r as a compact row if its cells fill exactly the positions that are not
   * covered; otherwise leave the grid unchanged. Returns whether the row fit.
   *
   * The reference implementation tries the row on a copy of the grid. Here every change
   * is journaled and undone if the row does not fit, which gives the same result without
   * copying the grid for each row.
   */
  private tryCompact(r: number, texts: string[]): boolean {
    const journal: (() => void)[] = [];
    const problemCount = this.problems.length;
    this.journal = journal;
    let used = 0;
    let fits = true;
    for (let c = 0; c < this.cols; c++) {
      if (this.owner[r][c] === null) {
        if (used === texts.length) {
          fits = false;
          break;
        }
        this.place(r, c, texts[used], used);
        used++;
      }
    }
    this.journal = null;
    if (fits) fits = texts.slice(used).every((t) => t === "");
    if (!fits) {
      for (let i = journal.length - 1; i >= 0; i--) journal[i]();
      this.problems.length = problemCount;
    }
    return fits;
  }

  /** Place row r. Returns "grid", "compact" or "padded" (the row did not fit: V14). */
  addRow(r: number, cells: string[]): RowForm {
    const n = cells.length;
    if (n !== this.cols && this.tryCompact(r, cells)) return "compact";
    let form: RowForm = "grid";
    let texts = cells;
    if (n !== this.cols) {
      this.report("V14", r, null, `row has ${n} cells; it fits neither as a grid row `
                                  + `(${this.cols} cells) nor as a compact row`);
      texts = [...cells, ...new Array<string>(this.cols).fill("")].slice(0, this.cols);
      form = "padded";
    }
    texts.forEach((text, c) => {
      const covering = this.owner[r][c];
      if (covering !== null) {
        if (text !== "" && text !== COLSPAN_MARKER && text !== ROWSPAN_MARKER) {
          const rule = covering.row < r ? "V5" : "V6";
          this.report(rule, r, c, `a covered position holds text ${repr(text)}; it is dropped`);
        }
        return;
      }
      this.place(r, c, text, c < n ? c : null);
    });
    return form;
  }
}
