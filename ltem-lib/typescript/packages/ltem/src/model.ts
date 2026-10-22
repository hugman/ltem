/**
 * The LTEM table model (see ast/table-model.md in the LTEM repository).
 *
 * A `Table` is a plain object whose JSON form is the table model itself:
 * `JSON.stringify(table)` gives a document valid against ast/table.schema.json.
 */

export const MODEL_VERSION = "1.0";

/** Column alignment from the delimiter row (spec 2.2). */
export type Alignment = "left" | "center" | "right" | null;

/** A cell of a table. Its origin is its top-left grid position. */
export interface Cell {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
  /** Inline Markdown source. Lines are separated by "\n". */
  text: string;
}

/** A resolved LTEM table. */
export interface Table {
  version: typeof MODEL_VERSION;
  rows: number;
  cols: number;
  header_rows: number;
  align: Alignment[];
  /** Sorted by row, then by column. */
  cells: Cell[];
}

/** A validation problem (specification Section 5). */
export interface Problem {
  rule: string;
  row: number;
  /** The grid column, or null for a problem that concerns a whole row (V14). */
  col: number | null;
  message: string;
}

/**
 * Where a cell is in the LTEM source.
 *
 * `line` counts lines of the parsed text from 0. `start` and `end` index that line in
 * UTF-16 code units (JavaScript string indices; the Python implementation counts code
 * points) and cover the cell's source without the spaces and tabs around it, including
 * any span attribute and escapes. An empty cell has start == end == the end of its space
 * between the pipes. A cell added by padding (rule V14) has no source; it gets
 * start == end == the length of its row's line.
 */
export interface CellSource {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
  line: number;
  start: number;
  end: number;
}

/** A cell is a header cell if its origin is in a header row. */
export function isHeader(table: Table, cell: Cell): boolean {
  return cell.row < table.header_rows;
}

/** Return a rows x cols grid holding the cell that owns each position. */
export function ownerGrid(table: Table): (Cell | null)[][] {
  const grid: (Cell | null)[][] = Array.from({ length: table.rows }, () =>
    new Array<Cell | null>(table.cols).fill(null),
  );
  for (const cell of table.cells) {
    for (let r = cell.row; r < Math.min(cell.row + cell.rowspan, table.rows); r++) {
      for (let c = cell.col; c < Math.min(cell.col + cell.colspan, table.cols); c++) {
        grid[r][c] = cell;
      }
    }
  }
  return grid;
}

/** Return the violations of the model rules in ast/table-model.md (empty if valid). */
export function checkTable(table: Table): string[] {
  const problems: string[] = [];
  const { rows, cols, header_rows: headerRows } = table;
  if (table.align.length !== cols) {
    problems.push(`align has ${table.align.length} entries, expected ${cols}`);
  }
  if (!(headerRows >= 1 && headerRows <= rows)) {
    problems.push(`header_rows ${headerRows} is outside 1..${rows}`);
  }
  const sorted = table.cells.every((c, i, cells) => {
    const prev = cells[i - 1];
    return i === 0 || prev.row < c.row || (prev.row === c.row && prev.col <= c.col);
  });
  if (!sorted) problems.push("cells are not sorted by row and column");
  const seen: boolean[][] = Array.from({ length: Math.max(rows, 0) }, () =>
    new Array<boolean>(Math.max(cols, 0)).fill(false),
  );
  for (const c of table.cells) {
    if (c.rowspan < 1 || c.colspan < 1 || c.row < 0 || c.col < 0
        || c.row + c.rowspan > rows || c.col + c.colspan > cols) {
      problems.push(`cell (${c.row},${c.col}) lies outside the grid`);
      continue;
    }
    if (c.row < headerRows && headerRows < c.row + c.rowspan) {
      problems.push(`header cell (${c.row},${c.col}) reaches into the body`);
    }
    for (let r = c.row; r < c.row + c.rowspan; r++) {
      for (let k = c.col; k < c.col + c.colspan; k++) {
        if (seen[r][k]) problems.push(`position (${r},${k}) belongs to two cells`);
        seen[r][k] = true;
      }
    }
  }
  const holes: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      if (!seen[r][k]) holes.push(`(${r}, ${k})`);
    }
  }
  if (holes.length) problems.push(`positions without a cell: [${holes.slice(0, 5).join(", ")}]`);
  for (const c of table.cells) {
    if (c.text.includes("\\\\")) {
      problems.push(`cell (${c.row},${c.col}) text has two backslashes in a row, `
                    + "which LTEM 1.0 reads as a line break");
    }
  }
  return problems;
}

/**
 * Build a table from its JSON form, for example `JSON.parse` output.
 *
 * Checks the version and the field types, and copies the fields in the order of the
 * schema. It does not check the rules beyond the schema; use `checkTable` for that.
 */
export function tableFromJSON(value: unknown): Table {
  const d = value as Record<string, unknown> | null;
  if (typeof d !== "object" || d === null) throw new TypeError("table model must be an object");
  if (d.version !== MODEL_VERSION) {
    throw new TypeError(`unsupported table model version: ${JSON.stringify(d.version)}`);
  }
  const int = (v: unknown, name: string): number => {
    if (!Number.isInteger(v)) throw new TypeError(`${name} must be an integer`);
    return v as number;
  };
  if (!Array.isArray(d.align) || !Array.isArray(d.cells)) {
    throw new TypeError("align and cells must be arrays");
  }
  const align = d.align.map((a: unknown): Alignment => {
    if (a === null || a === "left" || a === "center" || a === "right") return a;
    throw new TypeError(`invalid alignment: ${JSON.stringify(a)}`);
  });
  const cells = d.cells.map((c: unknown, i: number): Cell => {
    const cell = c as Record<string, unknown> | null;
    if (typeof cell !== "object" || cell === null) throw new TypeError(`cells[${i}] must be an object`);
    if (typeof cell.text !== "string") throw new TypeError(`cells[${i}].text must be a string`);
    return {
      row: int(cell.row, `cells[${i}].row`),
      col: int(cell.col, `cells[${i}].col`),
      rowspan: int(cell.rowspan, `cells[${i}].rowspan`),
      colspan: int(cell.colspan, `cells[${i}].colspan`),
      text: cell.text,
    };
  });
  return {
    version: MODEL_VERSION,
    rows: int(d.rows, "rows"),
    cols: int(d.cols, "cols"),
    header_rows: int(d.header_rows, "header_rows"),
    align,
    cells,
  };
}

/** The JSON form of a problem in the conformance protocol: rule, row and col. */
export function problemToJSON(problem: Problem): { rule: string; row: number; col: number | null } {
  return { rule: problem.rule, row: problem.row, col: problem.col };
}

/** "warning" for V14, which leaves the table valid; "error" for every other rule. */
export function problemSeverity(problem: Problem): "error" | "warning" {
  return problem.rule === "V14" ? "warning" : "error";
}

/** A one-line description of a problem, such as "V13 at (1,0): '<<' has no cell to extend". */
export function formatProblem(problem: Problem): string {
  const where = problem.col === null ? `row ${problem.row}` : `(${problem.row},${problem.col})`;
  return `${problem.rule} at ${where}: ${problem.message}`;
}
