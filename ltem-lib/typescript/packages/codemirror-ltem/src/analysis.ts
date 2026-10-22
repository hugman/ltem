/**
 * Where each piece of an LTEM table's source sits in its grid.
 *
 * The LTEM core resolves a table into its model (`parseTable`). An editor also needs the
 * other direction: for every cell written in a row, which grid position it fills. In
 * grid rows that is simply its column. In compact rows (spec 3.2) covered positions have
 * no cell, so the position is worked out here from the resolved model and the cell
 * sources that the core reports.
 */

import { endsTableBody, isDelimiterRow, ownerGrid, parseTable, splitRowSpans, type Cell, type ParseResult, type Table } from "ltem-core";

/** What a cell written in a row stands for. */
export type SourceCellKind =
  /** The origin of a cell; its text may be empty. */
  | "origin"
  /** A `<<` that extended the cell to its left. */
  | "colspan"
  /** A `^^` that extended the cell above. */
  | "rowspan"
  /** A placeholder in a covered position of a grid row; any text in it is dropped (V5, V6). */
  | "placeholder"
  /** A cell beyond the columns of the table, or a leftover empty cell of a compact row. */
  | "ignored"
  /** A cell of the delimiter row. */
  | "delimiter";

/** One cell as written in a row of the source. */
export interface SourceCell {
  kind: SourceCellKind;
  /** Grid position the cell fills; -1 for delimiter and ignored cells. */
  row: number;
  col: number;
  /** Offsets in the row's line, without the spaces and tabs around the cell. */
  start: number;
  end: number;
  /** Trimmed text, with `\|` turned into `|` (as the core splits rows). */
  text: string;
}

export type SourceRowKind = "header" | "delimiter" | "body";

/** One line of a table. */
export interface SourceRow {
  kind: SourceRowKind;
  /** Grid row, or -1 for the delimiter row. */
  row: number;
  /** Index of the line among the table's lines. */
  line: number;
  cells: SourceCell[];
  /** For each cell, the stretch of the line between the pipes around it. */
  bounds: { from: number; to: number }[];
  /** Offsets of the pipes that split the line into cells, edges included. */
  pipes: number[];
}

/** A resolved table together with where each part of it is written. */
export interface TableAnalysis {
  table: Table;
  /** The core's full result for the table's lines (problems, row forms, cell sources). */
  result: ParseResult;
  lines: readonly string[];
  rows: SourceRow[];
}

// A span attribute at the end of a cell (spec 2.6). Used only to tell which spans a cell
// fixed with an attribute; the core decides what is an attribute.
const SPAN_ATTRIBUTE = /(?:^|(?<=[ \t]))\{([cr]:[0-9]+(?:,[cr]:[0-9]+)*)\}$/;

/** Keys present in the span attribute that ends `text`, if any. */
export function attributeKeys(text: string): { c: boolean; r: boolean; from: number } | null {
  if (text.charCodeAt(text.length - 1) !== 0x7d) return null; // "}"
  const m = SPAN_ATTRIBUTE.exec(text);
  if (!m) return null;
  const keys = m[1].split(",").map((item) => item[0]);
  return { c: keys.includes("c"), r: keys.includes("r"), from: m.index };
}

/** Offsets of the pipes that split `line` into cells, as the core splits rows (spec 2.1). */
export function pipePositions(line: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && !(i > 0 && line[i - 1] === "\\")) out.push(i);
  }
  return out;
}

/**
 * Analyse lines that form exactly one table, from its first header row to its last body
 * row, as an LTEM parser found them. Returns null if the lines are not one whole table.
 */
export function analyzeTable(lines: readonly string[]): TableAnalysis | null {
  const result = parseTable(lines);
  const table = result.table;
  if (table === null || result.start !== 0 || result.end !== lines.length) return null;
  const grid = ownerGrid(table);
  // Which spans attributes fixed matters only for compact rows.
  const fixed = result.forms.includes("compact") ? fixedSpans(table, result, lines) : new Map<Cell, { c: boolean; r: boolean }>();
  const rows: SourceRow[] = [];
  const header = table.header_rows;
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    const spans: Span[] = splitRowSpans(text).map(([t, start, end]) => ({ text: t, start, end }));
    const pipes = pipePositions(text);
    const bounds = cellSegments(text);
    if (line === header) {
      rows.push({
        kind: "delimiter", row: -1, line, pipes, bounds,
        cells: spans.map((s) => ({ kind: "delimiter", row: -1, col: -1, start: s.start, end: s.end, text: s.text })),
      });
      continue;
    }
    const r = line < header ? line : line - 1;
    const form = result.forms[r];
    const cells: SourceCell[] = form === "compact"
      ? compactCells(r, spans, grid, fixed, table.cols)
      : gridCells(r, spans, grid, table.cols);
    rows.push({ kind: r < header ? "header" : "body", row: r, line, pipes, bounds, cells });
  }
  return { table, result, lines, rows };
}

interface Span { text: string; start: number; end: number }

/**
 * The analysis of `lines` from the analysis of the same table before an edit, when the
 * edit only lined up the table (spaces around cells, dashes of the delimiter row) and
 * changed the text of origin cells in at most one row (see `updateAnalysis`). A table
 * typed in, or lined up by Tab, is then not read from the start again. Returns null for
 * any other change.
 */
export function deriveAnalysis(old: TableAnalysis, lines: readonly string[]): TableAnalysis | null {
  if (lines.length !== old.lines.length) return null;
  const squash = (line: string): string => line.replace(/[ \t]+/g, "").replace(/-+/g, "-");
  let changed = -1;
  const reflowed: { index: number; spans: Span[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === old.lines[i]) continue;
    const row = old.rows[i];
    const spans = squash(lines[i]) === squash(old.lines[i])
      ? splitRowSpans(lines[i]).map(([t, start, end]) => ({ text: t, start, end }))
      : null;
    const same = spans !== null && spans.length === row.cells.length && spans.every((s, k) =>
      row.kind === "delimiter" ? s.text.replace(/-+/g, "-") === row.cells[k].text.replace(/-+/g, "-") : s.text === row.cells[k].text);
    if (same) reflowed.push({ index: i, spans: spans! });
    else if (changed >= 0) return null;
    else changed = i;
  }
  let analysis = old;
  if (reflowed.length) {
    const rows = old.rows.slice();
    const moved = new Map<number, Map<number, Span>>(); // line -> old start -> new span
    const linesSoFar = old.lines.slice();
    for (const { index, spans } of reflowed) {
      const row = old.rows[index];
      const starts = new Map<number, Span>();
      row.cells.forEach((cell, k) => starts.set(cell.start, spans[k]));
      moved.set(index, starts);
      rows[index] = {
        ...row,
        pipes: pipePositions(lines[index]),
        bounds: cellSegments(lines[index]),
        cells: row.cells.map((cell, k) => ({ ...cell, start: spans[k].start, end: spans[k].end, text: spans[k].text })),
      };
      linesSoFar[index] = lines[index];
    }
    const sources = old.result.sources.map((src) => {
      const span = moved.get(src.line)?.get(src.start);
      return span ? { ...src, start: span.start, end: span.end } : src;
    });
    analysis = { table: old.table, result: { ...old.result, sources }, lines: linesSoFar, rows };
  }
  if (changed < 0) return { ...analysis, lines };
  return updateAnalysis(analysis, lines, changed);
}

/**
 * The analysis of `lines` from the analysis of the same table before one line changed,
 * when the change is only new text in origin cells of a grid row: no markers, span
 * attributes or cells added or removed. Then the structure, the problems and the other
 * rows are the same, and only that row and those cells' texts are read again. Returns null
 * for any other change, which is then analysed from the start.
 */
export function updateAnalysis(old: TableAnalysis, lines: readonly string[], index: number): TableAnalysis | null {
  const { table, result } = old;
  const row = old.rows[index];
  if (!row || row.kind === "delimiter" || result.forms[row.row] !== "grid" || lines.length !== old.lines.length) return null;
  const text = lines[index];
  if (isDelimiterRow(text) || (row.kind === "body" && endsTableBody(text))) return null;
  const spans: Span[] = splitRowSpans(text).map(([t, start, end]) => ({ text: t, start, end }));
  if (spans.length !== row.cells.length) return null;
  const changed = new Map<number, string>(); // column -> new model text
  for (let j = 0; j < spans.length; j++) {
    const before = row.cells[j];
    if (before.text === spans[j].text) continue;
    // A marker with no cell to extend is an origin cell too, with a problem (V13).
    const marker = (t: string): boolean => t === "<<" || t === "^^";
    if (before.kind !== "origin" || marker(before.text) || marker(spans[j].text)) return null;
    if (attributeKeys(before.text) || attributeKeys(spans[j].text)) return null;
    // The model text of the cell, as the core reads it (escapes, line breaks).
    const raw = text.slice(spans[j].start, spans[j].end);
    const parsed = parseTable(["| x |", "|---|", `| ${raw} |`]);
    const cell = parsed.table?.cells.find((c) => c.row === 1);
    if (!cell || parsed.problems.length || parsed.table!.rows !== 2) return null;
    changed.set(before.col, cell.text);
  }
  const cells = table.cells.map((c) => (c.row === row.row && changed.has(c.col) ? { ...c, text: changed.get(c.col)! } : c));
  const next: Table = { ...table, cells };
  const sources = result.sources.map((src) => {
    if (src.line !== index) return src;
    const span = spans[src.col];
    return span ? { ...src, start: span.start, end: span.end } : src;
  });
  const rows = old.rows.slice();
  rows[index] = {
    ...row,
    pipes: pipePositions(text),
    bounds: cellSegments(text),
    cells: gridCells(row.row, spans, ownerGrid(next), table.cols),
  };
  return { table: next, result: { ...result, table: next, sources }, lines, rows };
}

/** For each cell of the model, whether an attribute fixed its colspan or rowspan. */
function fixedSpans(table: Table, result: ParseResult, lines: readonly string[]): Map<Cell, { c: boolean; r: boolean }> {
  const out = new Map<Cell, { c: boolean; r: boolean }>();
  table.cells.forEach((cell, i) => {
    const src = result.sources[i];
    const keys = src ? attributeKeys(lines[src.line].slice(src.start, src.end)) : null;
    out.set(cell, { c: keys?.c ?? false, r: keys?.r ?? false });
  });
  return out;
}

function gridCells(r: number, spans: Span[], grid: (Cell | null)[][], cols: number): SourceCell[] {
  return spans.map((s, c): SourceCell => {
    if (c >= cols) return { kind: "ignored", row: -1, col: -1, ...s };
    const owner = grid[r][c]!;
    if (owner.row === r && owner.col === c) return { kind: "origin", row: r, col: c, ...s };
    const kind = s.text === "<<" ? "colspan" : s.text === "^^" ? "rowspan" : "placeholder";
    return { kind, row: r, col: c, ...s };
  });
}

function compactCells(
  r: number, spans: Span[], grid: (Cell | null)[][], fixed: Map<Cell, { c: boolean; r: boolean }>, cols: number,
): SourceCell[] {
  const out: SourceCell[] = [];
  let k = 0;
  const take = (kind: SourceCellKind, c: number): void => {
    if (k < spans.length) out.push({ kind, row: r, col: c, ...spans[k++] });
  };
  for (let c = 0; c < cols; c++) {
    const owner = grid[r][c]!;
    if (owner.row === r && owner.col === c) {
      take("origin", c); // placed here
    } else if (owner.row === r) {
      // Covered from the left in the same row: by an attribute (no cell) or by a `<<`.
      if (!fixed.get(owner)!.c) take("colspan", c);
    } else if (owner.col === c && !fixed.get(owner)!.r) {
      // Covered from above at the origin's column without an `r` attribute: a `^^` here
      // extended the cell. Positions to its right were then covered by that extension.
      take("rowspan", c);
    }
  }
  while (k < spans.length) out.push({ kind: "ignored", row: -1, col: -1, ...spans[k++] });
  return out;
}

/** The source cell of `analysis` that fills grid position (row, col) and is written in its own row. */
export function sourceCellAt(analysis: TableAnalysis, row: number, col: number): { row: SourceRow; cell: SourceCell } | null {
  for (const sr of analysis.rows) {
    if (sr.row !== row) continue;
    for (const cell of sr.cells) if (cell.row === row && cell.col === col) return { row: sr, cell };
  }
  return null;
}

/** The source cell of a row whose stretch between pipes contains offset `ch` of its line. */
export function cellAtOffset(sr: SourceRow, ch: number): SourceCell | null {
  for (let i = 0; i < sr.bounds.length; i++) {
    if (ch >= sr.bounds[i].from && ch <= sr.bounds[i].to) return sr.cells[i] ?? null;
  }
  return null;
}

/**
 * For each cell of a line, the stretch between the pipes around it (spaces included), split
 * exactly as the core splits rows (spec 2.1): optional outer pipes, `\|` does not split.
 */
export function cellSegments(line: string): { from: number; to: number }[] {
  let b = 0;
  let e = line.length;
  while (b < e && (line[b] === " " || line[b] === "\t")) b++;
  while (e > b && (line[e - 1] === " " || line[e - 1] === "\t")) e--;
  if (b < e && line[b] === "|") b++;
  if (e > b && line[e - 1] === "|" && !(e - 2 >= b && line[e - 2] === "\\")) e--;
  const out: { from: number; to: number }[] = [];
  let start = b;
  for (let i = b; i < e; i++) {
    if (line[i] === "\\" && i + 1 < e && line[i + 1] === "|") {
      i++;
      continue;
    }
    if (line[i] === "|") {
      out.push({ from: start, to: i });
      start = i + 1;
    }
  }
  out.push({ from: start, to: e });
  return out;
}
