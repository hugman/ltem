/**
 * Table editing commands.
 *
 * A command reads the table at the cursor through the LTEM core, changes its table model
 * and writes the table back in canonical form with lined-up columns (`writeAligned`). The
 * cursor stays in the same cell, or moves to the cell the command names. Each command is
 * one transaction, so one undo step.
 */

import {
  EditorSelection, Facet, type ChangeSpec, type EditorState, type StateCommand, type Text, type Transaction, type TransactionSpec,
} from "@codemirror/state";
import { ownerGrid, parseTable, write, type Alignment, type Cell, type Table } from "ltem-core";

import { attributeKeys, cellSegments, sourceCellAt } from "./analysis.js";
import { alignText, alignedLines, writeAligned } from "./format.js";
import {
  alignColumn, cellRange, cellsIn, deleteColumn, deleteRow, emptyTable, fillCells, insertColumn, insertRow, makeBodyRows, makeHeaderRows, mergeCells,
  mergeRange, moveColumn, moveRow, splitCell, uncoverCell, type CellRange, type GridPosition,
} from "./model.js";
import { cellAt, tableAt, type LtemCellInfo, type LtemTableInfo } from "./query.js";

// -- applying a change to the editor ---------------------------------------------------

interface Target { row: number; col: number }

/** The grid position the cursor is in, for the cell at the main selection's head. */
function cursorCell(state: EditorState): LtemCellInfo | null {
  const table = tableAt(state, state.selection.main.head);
  return table ? cellAt(table, state.selection.main.head) : null;
}

/** Grid position to act on for a cell: delimiter and ignored cells count as the nearest one. */
export function cellPosition(info: LtemCellInfo): GridPosition {
  return position(info);
}

function position(info: LtemCellInfo): Target {
  const t = info.table.analysis.table;
  const col = Math.min(info.cell.col >= 0 ? info.cell.col : info.index, t.cols - 1);
  const row = info.row.row >= 0 ? info.row.row : t.header_rows;
  return { row: Math.min(row, t.rows - 1), col };
}

/** The new text of a table's lines: `next` written aligned, each line with its container prefix. */
interface Rewrite {
  /** Document range of the table's whole lines. */
  from: number;
  to: number;
  insert: string;
  /** Container prefix of the table's last line, for a line added after it. */
  lastPrefix: string;
  /** Document offsets, from `from`, of the text of cell (row, col); null if it is not written. */
  cellRange(row: number, col: number): { start: number; end: number } | null;
  /** The change, as changes of the parts of lines that differ only. */
  changes: ChangeSpec[];
}

function rewrite(state: EditorState, table: LtemTableInfo, next: Table, lines?: string[]): Rewrite {
  const doc = state.doc;
  const text = lines ?? alignedLines(next);
  const prefixes = table.lineStarts.map((start) => doc.sliceString(doc.lineAt(start).from, start));
  const prefix = (i: number): string => prefixes[Math.min(i, prefixes.length - 1)];
  const insert = text.map((line, i) => prefix(i) + line).join("\n");
  const from = doc.lineAt(table.from).from;
  const to = doc.lineAt(table.to).to;
  return {
    from,
    to,
    insert,
    lastPrefix: prefixes[prefixes.length - 1],
    cellRange(row, col) {
      // The lines are grid rows (see `alignedLines`).
      const line = row < next.header_rows ? row : row + 1;
      const segment = line < text.length ? cellSegments(text[line])[col] : undefined;
      if (!segment) return null;
      let start = segment.from;
      let end = segment.to;
      while (start < end && text[line][start] === " ") start++;
      while (end > start && text[line][end - 1] === " ") end--;
      // An empty cell: where its text starts, after the space that follows the pipe.
      if (start === segment.to) start = end = Math.min(segment.from + 1, segment.to);
      let offset = 0;
      for (let i = 0; i < line; i++) offset += prefix(i).length + text[i].length + 1;
      offset += prefix(line).length;
      return { start: offset + start, end: offset + end };
    },
    get changes() {
      return lineChanges(doc, from, to, insert);
    },
  };
}

/**
 * Replacing the text from `from` to `to` with `insert`, as changes of only the parts that
 * differ: lines that stay the same are not touched, and within a changed line only the
 * stretch between its unchanged start and end is. A large table whose columns are lined up
 * again changes little, so the change is small for the undo history, the parser and the
 * positions of other selections.
 */
export function lineChanges(doc: Text, from: number, to: number, insert: string): ChangeSpec[] {
  const before = doc.sliceString(from, to).split("\n");
  const after = insert.split("\n");
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  if (start === endBefore && start === endAfter) return [];
  const lineStart: number[] = [];
  for (let i = 0, pos = from; i < before.length; i++) {
    lineStart.push(pos);
    pos += before[i].length + 1;
  }
  const changes: ChangeSpec[] = [];
  if (endBefore - start === endAfter - start) {
    for (let i = start; i < endBefore; i++) {
      const a = before[i];
      const b = after[i];
      if (a === b) continue;
      let head = 0;
      while (head < a.length && head < b.length && a[head] === b[head]) head++;
      let tail = 0;
      while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
      changes.push({ from: lineStart[i] + head, to: lineStart[i] + a.length - tail, insert: b.slice(head, b.length - tail) });
    }
    return changes;
  }
  // Lines added or removed: replace the lines that differ as one block, with at least one
  // line on each side so that no line break is left over.
  if (start === endBefore || start === endAfter) {
    if (start > 0) start--;
    else {
      endBefore++;
      endAfter++;
    }
  }
  changes.push({
    from: lineStart[start],
    to: lineStart[endBefore - 1] + before[endBefore - 1].length,
    insert: after.slice(start, endAfter).join("\n"),
  });
  return changes;
}

/**
 * Whether Tab and Enter line up the columns of the table they move in, and an edit in a
 * shown table lines them up after it (default true). Lining up changes only spaces
 * (`alignText`); a table with rows of different lengths is left as it is.
 */
export const ltemAutoAlign = Facet.define<boolean, boolean>({
  combine: (values) => (values.length ? values[values.length - 1] : true),
});

/**
 * A transaction spec that rewrites a table in canonical form with lined-up columns, from
 * its own model: the recovery rules of spec Section 3.6 are then written out, so the
 * table has no problems left. The selection is left to the editor's mapping.
 */
export function fixTable(state: EditorState, table: LtemTableInfo): { changes: ChangeSpec[]; userEvent: string } {
  const r = rewrite(state, table, table.analysis.table);
  return { changes: r.changes, userEvent: "input.ltem.fix" };
}

/**
 * A transaction spec that keeps the text written where a merged cell lies (rules V5, V6),
 * which the table otherwise drops: the merged cell covering (row, col) is shrunk
 * (`uncoverCell`), the text written at each position it no longer covers comes back, and
 * the table is rewritten. Null if no text is written at (row, col) or nothing covers it.
 */
export function keepCoveredText(state: EditorState, table: LtemTableInfo, row: number, col: number): { changes: ChangeSpec[]; selection: { anchor: number }; userEvent: string } | null {
  const { analysis } = table;
  const written = (r: number, c: number): string | null => {
    const found = sourceCellAt(analysis, r, c);
    if (!found || found.cell.kind !== "placeholder" || found.cell.end <= found.cell.start) return null;
    // The model text of the written cell, as the core reads it (line breaks, escapes).
    const raw = analysis.lines[found.row.line].slice(found.cell.start, found.cell.end);
    return parseTable(["| x |", "|---|", `| ${raw} |`]).table?.cells.find((cell) => cell.row === 1)?.text ?? found.cell.text;
  };
  if (written(row, col) === null) return null;
  const next = uncoverCell(analysis.table, row, col);
  if (!next) return null;
  const before = ownerGrid(analysis.table);
  for (const cell of next.cells) {
    if (before[cell.row][cell.col]?.row === cell.row && before[cell.row][cell.col]?.col === cell.col) continue;
    cell.text = written(cell.row, cell.col) ?? "";
  }
  const r = rewrite(state, table, next);
  const head = r.from + (r.cellRange(row, col)?.end ?? r.insert.length);
  return { changes: r.changes, selection: { anchor: head }, userEvent: "input.ltem.fix" };
}

/** How the LTEM writer writes `text` in a body cell (spec Section 8): `|` escaped, lines joined by `\\`, and so on. */
export function cellSource(text: string, version: Table["version"]): string {
  const cell = (row: number, col: number, t: string): Cell => ({ row, col, rowspan: 1, colspan: 1, text: t });
  const line = write({
    version, rows: 2, cols: 2, header_rows: 1, align: [null, null],
    cells: [cell(0, 0, "a"), cell(0, 1, "b"), cell(1, 0, text), cell(1, 1, "c")],
  }).split("\n")[2];
  const segment = cellSegments(line)[0];
  return line.slice(segment.from, segment.to).replace(/^[ \t]+|[ \t]+$/g, "");
}

const trimLines = (text: string): string => text.split("\n").map((l) => l.replace(/^[ \t]+|[ \t]+$/g, "")).join("\n");

/** A text to put in a cell. */
export interface CellEdit {
  row: number;
  col: number;
  /** Lines separated by "\n"; a typed `\\` is a line break too. */
  text: string;
}

/**
 * A transaction spec that sets the texts of cells of a table, as typed into cells where the
 * table is shown or pasted into them. Each text is escaped as the LTEM writer escapes it,
 * and only the cell's text is replaced: a span attribute after it stays, and the table is
 * not rewritten. If `ltemAutoAlign` is on, the columns are lined up in the same change
 * (spaces only, `alignText`). Null if no text changes; cells that are not written in the
 * source (rule V14 padding) are skipped.
 */
export function editCellTexts(state: EditorState, table: LtemTableInfo, edits: readonly CellEdit[]): { changes: ChangeSpec[]; userEvent: string } | null {
  const { analysis } = table;
  const byLine = new Map<number, { from: number; to: number; insert: string }[]>();
  for (const edit of edits) {
    const found = sourceCellAt(analysis, edit.row, edit.col);
    if (!found) continue;
    const next = trimLines(edit.text.replace(/\r\n?/g, "\n").replace(/\\\\/g, "\n"));
    const current = analysis.table.cells.find((c) => c.row === edit.row && c.col === edit.col);
    if (current && current.text === next) continue;
    if (!current && next === "") continue;
    const source = cellSource(next, analysis.table.version);
    const line = analysis.lines[found.row.line];
    let from: number;
    let to: number;
    let insert: string;
    if (found.cell.end > found.cell.start) {
      from = found.cell.start;
      to = found.cell.end;
      insert = source;
      const attribute = attributeKeys(found.cell.text);
      if (attribute) {
        // Keep the span attribute after the text.
        to = found.cell.start + attribute.from;
        while (to > from && (line[to - 1] === " " || line[to - 1] === "\t")) to--;
        if (to === from && source) insert = `${source} `;
      }
    } else {
      // An empty cell: its text goes between the pipes, with a space on each side.
      const bounds = found.row.bounds[found.row.cells.indexOf(found.cell)];
      from = bounds.from;
      to = bounds.to;
      insert = ` ${source} `;
    }
    const list = byLine.get(found.row.line) ?? [];
    list.push({ from, to, insert });
    byLine.set(found.row.line, list);
  }
  if (!byLine.size) return null;
  if (state.facet(ltemAutoAlign)) {
    const lines = analysis.lines.map((line, i) => {
      const list = byLine.get(i);
      if (!list) return line;
      let edited = line;
      for (const e of [...list].sort((a, b) => b.from - a.from)) edited = edited.slice(0, e.from) + e.insert + edited.slice(e.to);
      return edited;
    });
    const aligned = alignText(lines, analysis.table.header_rows);
    if (aligned) return { changes: rewrite(state, table, analysis.table, aligned).changes, userEvent: "input.ltem.cell" };
  }
  const changes: ChangeSpec[] = [];
  for (const [line, list] of byLine) {
    for (const e of list) changes.push({ from: table.lineStarts[line] + e.from, to: table.lineStarts[line] + e.to, insert: e.insert });
  }
  return { changes, userEvent: "input.ltem.cell" };
}

/** `editCellTexts` for one cell. */
export function editCellText(state: EditorState, table: LtemTableInfo, row: number, col: number, text: string): { changes: ChangeSpec[]; userEvent: string } | null {
  return editCellTexts(state, table, [{ row, col, text }]);
}

/**
 * A transaction spec that writes the table as `next` in canonical form with lined-up
 * columns. With `target`, the cursor goes to the end of that cell (its text selected if
 * `select`); without, the selection stays where it is, which keeps a table shown as a table
 * shown so.
 */
export function replaceTableSpec(
  state: EditorState, table: LtemTableInfo, next: Table, options: { target?: GridPosition | null; select?: boolean; userEvent?: string } = {},
): TransactionSpec {
  const r = rewrite(state, table, next);
  const spec: TransactionSpec = { changes: r.changes, userEvent: options.userEvent ?? "input.ltem" };
  if (options.target) {
    const range = r.cellRange(options.target.row, options.target.col);
    spec.selection = range
      ? (options.select ? EditorSelection.range(r.from + range.start, r.from + range.end) : EditorSelection.cursor(r.from + range.end))
      : EditorSelection.cursor(r.from + r.insert.length);
    spec.scrollIntoView = true;
  }
  return spec;
}

/**
 * A transaction spec that puts texts into a table from position `at` on, as pasting a
 * block of cells does (`fillCells`). When the texts fit in the table and no merged cell is
 * in the way, only the cells' texts change; otherwise the table grows and is rewritten.
 */
export function fillCellsSpec(
  state: EditorState, table: LtemTableInfo, at: GridPosition, texts: string[][], options: { moveCursor?: boolean } = {},
): TransactionSpec | null {
  const t = table.analysis.table;
  const height = texts.length;
  const width = Math.max(0, ...texts.map((row) => row.length));
  if (!height || !width) return null;
  const last = { row: at.row + height - 1, col: at.col + width - 1 };
  const fits = last.row < t.rows && last.col < t.cols && t.cells.every((c) =>
    (c.rowspan === 1 && c.colspan === 1)
    || c.row > last.row || c.row + c.rowspan - 1 < at.row || c.col > last.col || c.col + c.colspan - 1 < at.col);
  if (fits) {
    const edits: CellEdit[] = [];
    texts.forEach((row, i) => row.forEach((text, j) => edits.push({ row: at.row + i, col: at.col + j, text })));
    const written = edits.every((e) => sourceCellAt(table.analysis, e.row, e.col));
    if (written) {
      const spec = editCellTexts(state, table, edits);
      if (!spec) return null;
      if (!options.moveCursor) return { ...spec, userEvent: "input.paste.ltem" };
      // The cursor after the last cell: found in the changed document.
      const next = state.update(spec).state;
      const info = tableAt(next, table.from);
      const found = info && sourceCellAt(info.analysis, last.row, last.col);
      const head = found ? info.lineStarts[found.row.line] + found.cell.end : null;
      return { ...spec, userEvent: "input.paste.ltem", ...(head !== null ? { selection: { anchor: head }, scrollIntoView: true } : {}) };
    }
  }
  return replaceTableSpec(state, table, fillCells(t, at, texts), { target: options.moveCursor ? last : null, userEvent: "input.paste.ltem" });
}

/**
 * A transaction that replaces the table with `next` written aligned, the cursor at the end
 * of cell `target`, or its text selected if `select`.
 */
function replaceTable(state: EditorState, table: LtemTableInfo, next: Table, target: Target, userEvent: string, select = false, lines?: string[]): Transaction {
  const r = rewrite(state, table, next, lines);
  const range = r.cellRange(target.row, target.col);
  const selection = range
    ? (select ? EditorSelection.range(r.from + range.start, r.from + range.end) : EditorSelection.cursor(r.from + range.end))
    : EditorSelection.cursor(r.from + r.insert.length);
  return state.update({ changes: r.changes, selection, scrollIntoView: true, userEvent });
}

/**
 * The transaction for moving to cell `target` of the table at the cursor, lining up the
 * columns first if `ltemAutoAlign` is on and that changes nothing but spacing. Null if the
 * cell is not written and the columns are not lined up.
 */
function moveTo(state: EditorState, info: LtemCellInfo, target: Target, select: boolean): Transaction | null {
  const t = info.table.analysis.table;
  if (state.facet(ltemAutoAlign)) {
    const lines = info.table.analysis.lines;
    const aligned = alignText(lines, t.header_rows);
    if (aligned && aligned.some((line, i) => line !== lines[i])) {
      return replaceTable(state, info.table, t, target, "input.ltem.align", select, aligned);
    }
  }
  const found = sourceCellAt(info.table.analysis, target.row, target.col);
  if (!found) return null;
  const lineStart = info.table.lineStarts[found.row.line];
  let { start, end } = found.cell;
  if (end <= start) {
    // An empty cell: where its text starts, after the space that follows the pipe.
    const bounds = found.row.bounds[found.row.cells.indexOf(found.cell)];
    if (bounds) start = end = Math.min(bounds.from + 1, bounds.to);
  }
  const anchor = select ? lineStart + start : lineStart + end;
  return state.update({
    selection: EditorSelection.range(anchor, lineStart + end),
    scrollIntoView: true,
    userEvent: "select.ltem",
  });
}

function tableCommand(
  op: (table: Table, at: Target, info: LtemCellInfo) => { table: Table; target: Target } | null,
  userEvent = "input.ltem",
): StateCommand {
  return ({ state, dispatch }) => {
    const info = cursorCell(state);
    if (!info) return false;
    const result = op(info.table.analysis.table, position(info), info);
    if (!result) return false;
    dispatch(replaceTable(state, info.table, result.table, result.target, userEvent));
    return true;
  };
}

/** Rewrite the table at the cursor in canonical form with lined-up columns. */
export const formatTable: StateCommand = tableCommand((table, at) => ({ table, target: at }), "input.ltem.format");

export const insertRowAbove: StateCommand = tableCommand((table, at) => ({
  table: insertRow(table, at.row, at.row < table.header_rows),
  target: { row: at.row, col: at.col },
}));

export const insertRowBelow: StateCommand = tableCommand((table, at) => {
  const below = ownerGrid(table)[at.row][at.col]!;
  const row = below.row + below.rowspan;
  return { table: insertRow(table, row, row < table.header_rows || (at.row < table.header_rows && row === table.header_rows)), target: { row, col: at.col } };
});

/** Make the cursor's row (and the rows above it) header rows; see `makeHeaderRows`. */
export const makeHeaderRow: StateCommand = tableCommand((table, at) => {
  const next = makeHeaderRows(table, at.row);
  return next && { table: next, target: { row: at.row - (table.rows - next.rows), col: at.col } };
});

/** Make the cursor's row (and the rows below it) body rows; see `makeBodyRows`. */
export const makeBodyRow: StateCommand = tableCommand((table, at) => {
  const next = makeBodyRows(table, at.row);
  return next && { table: next, target: { row: at.row + (next.rows - table.rows), col: at.col } };
});

export const deleteRowAt: StateCommand = tableCommand((table, at) => {
  const next = deleteRow(table, at.row);
  return next ? { table: next, target: { row: Math.min(at.row, next.rows - 1), col: at.col } } : null;
});

export const insertColumnLeft: StateCommand = tableCommand((table, at) => ({
  table: insertColumn(table, at.col), target: { row: at.row, col: at.col },
}));

export const insertColumnRight: StateCommand = tableCommand((table, at) => {
  const cell = ownerGrid(table)[at.row][at.col]!;
  const col = cell.col + cell.colspan;
  return { table: insertColumn(table, col), target: { row: at.row, col } };
});

export const deleteColumnAt: StateCommand = tableCommand((table, at) => {
  const next = deleteColumn(table, at.col);
  return next ? { table: next, target: { row: at.row, col: Math.min(at.col, next.cols - 1) } } : null;
});

export const mergeRight: StateCommand = tableCommand((table, at) => {
  const next = mergeCells(table, at.row, at.col, "right");
  const x = ownerGrid(table)[at.row][at.col]!;
  return next ? { table: next, target: { row: x.row, col: x.col } } : null;
});

export const mergeDown: StateCommand = tableCommand((table, at) => {
  const next = mergeCells(table, at.row, at.col, "down");
  const x = ownerGrid(table)[at.row][at.col]!;
  return next ? { table: next, target: { row: x.row, col: x.col } } : null;
});

export const splitCellAt: StateCommand = tableCommand((table, at) => {
  const next = splitCell(table, at.row, at.col);
  const x = ownerGrid(table)[at.row][at.col]!;
  return next ? { table: next, target: { row: x.row, col: x.col } } : null;
});

function moveRowCommand(delta: -1 | 1): StateCommand {
  return tableCommand((table, at) => {
    const row = ownerGrid(table)[at.row][at.col]!.row;
    const next = moveRow(table, row, delta);
    return next ? { table: next, target: { row: row + delta, col: at.col } } : null;
  });
}

function moveColumnCommand(delta: -1 | 1): StateCommand {
  return tableCommand((table, at) => {
    const col = ownerGrid(table)[at.row][at.col]!.col;
    const next = moveColumn(table, col, delta);
    return next ? { table: next, target: { row: at.row, col: col + delta } } : null;
  });
}

/** Move the cursor's row up, or down; not across the delimiter row or merged cells. */
export const moveRowUp: StateCommand = moveRowCommand(-1);
export const moveRowDown: StateCommand = moveRowCommand(1);
/** Move the cursor's column left, or right; not across merged cells. */
export const moveColumnLeft: StateCommand = moveColumnCommand(-1);
export const moveColumnRight: StateCommand = moveColumnCommand(1);

function alignCommand(align: Alignment): StateCommand {
  return tableCommand((table, at) => {
    const col = ownerGrid(table)[at.row][at.col]!.col;
    return { table: alignColumn(table, col, align), target: at };
  });
}

/** Align the cursor's column to the left, centre or right, or remove its alignment. */
export const alignLeft: StateCommand = alignCommand("left");
export const alignCenter: StateCommand = alignCommand("center");
export const alignRight: StateCommand = alignCommand("right");
export const alignNone: StateCommand = alignCommand(null);

/**
 * A command that inserts an empty table at the cursor, on lines of its own, and puts the
 * cursor in its first cell.
 */
export function insertTable(options: { rows?: number; cols?: number; headerRows?: number } = {}): StateCommand {
  return ({ state, dispatch }) => {
    const table = emptyTable((options.rows ?? 3) + (options.headerRows ?? 1) - 1 + 1, options.cols ?? 3, options.headerRows ?? 1);
    const text = writeAligned(table);
    const { from, to } = state.selection.main;
    const doc = state.doc;
    const lineBefore = doc.lineAt(from);
    const lineAfter = doc.lineAt(to);
    let prefix = "";
    if (doc.sliceString(lineBefore.from, from).trim()) prefix = "\n\n";
    else if (lineBefore.number > 1 && doc.line(lineBefore.number - 1).text.trim()) prefix = "\n";
    let suffix = "";
    if (doc.sliceString(to, lineAfter.to).trim()) suffix = "\n\n";
    else if (lineAfter.number < doc.lines && doc.line(lineAfter.number + 1).text.trim()) suffix = "\n";
    dispatch(state.update({
      changes: { from, to, insert: prefix + text + suffix },
      selection: EditorSelection.cursor(from + prefix.length + 2),
      scrollIntoView: true,
      userEvent: "input.ltem",
    }));
    return true;
  };
}

// -- moving between cells --------------------------------------------------------------

/** Origin cells of the table in reading order, header rows first. */
function readingOrder(table: Table): Cell[] {
  return [...table.cells].sort((a, b) => a.row - b.row || a.col - b.col);
}

function moveCell(forward: boolean): StateCommand {
  return ({ state, dispatch }) => {
    const info = cursorCell(state);
    if (!info) return false;
    const t = info.table.analysis.table;
    const at = position(info);
    const current = ownerGrid(t)[at.row][at.col]!;
    const order = readingOrder(t);
    const i = order.indexOf(current);
    const next = order[forward ? i + 1 : i - 1];
    if (!next) {
      if (!forward) return true;
      // Past the last cell: add a body row and go to its first cell.
      dispatch(replaceTable(state, info.table, insertRow(t, t.rows, false), { row: t.rows, col: 0 }, "input.ltem"));
      return true;
    }
    const target = { row: next.row, col: next.col };
    // A cell added by padding (rule V14) is not written: write the table out to make it.
    dispatch(moveTo(state, info, target, true) ?? replaceTable(state, info.table, t, target, "input.ltem", true));
    return true;
  };
}

/** Select the text of the next cell (lining up the columns, see `ltemAutoAlign`); past the last cell, add a body row. */
export const nextCell: StateCommand = moveCell(true);
/** Select the text of the previous cell. */
export const previousCell: StateCommand = moveCell(false);

/**
 * Enter in a table: go to the cell below. Below the last row, add a body row; on an empty
 * last body row, remove it and leave the table, on a new line after it.
 */
export const enterInTable: StateCommand = ({ state, dispatch }) => {
  if (!state.selection.main.empty || state.selection.ranges.length > 1) return false;
  const info = cursorCell(state);
  if (!info || info.row.kind === "delimiter") return false;
  const t = info.table.analysis.table;
  const at = position(info);
  const owner = ownerGrid(t)[at.row][at.col]!;
  const below = owner.row + owner.rowspan;
  if (below < t.rows) {
    const cellBelow = ownerGrid(t)[below][at.col]!;
    const target = { row: cellBelow.row, col: cellBelow.col };
    dispatch(moveTo(state, info, target, false) ?? replaceTable(state, info.table, t, target, "input.ltem"));
    return true;
  }
  const lastRowEmpty = at.row >= t.header_rows && t.cells.every((c) => c.row !== at.row || (c.text === "" && c.rowspan === 1));
  if (lastRowEmpty && t.rows - 1 > t.header_rows) {
    // Leave the table: drop the empty row and continue on the line below the table, which
    // is added if the table is not followed by a blank line.
    const r = rewrite(state, info.table, deleteRow(t, at.row)!);
    const after = r.to < state.doc.length ? state.doc.lineAt(r.to + 1) : null;
    const blankAfter = after !== null && after.text.trim() === "";
    const insert = blankAfter ? r.insert : `${r.insert}\n${r.lastPrefix.trimEnd() ? r.lastPrefix : ""}`;
    dispatch(state.update({
      changes: lineChanges(state.doc, r.from, r.to, insert),
      selection: EditorSelection.cursor(r.from + (blankAfter ? r.insert.length + 1 : insert.length)),
      scrollIntoView: true,
      userEvent: "input.ltem",
    }));
    return true;
  }
  dispatch(replaceTable(state, info.table, insertRow(t, t.rows, false), { row: t.rows, col: at.col }, "input.ltem"));
  return true;
};

/** Shift-Enter in a table: a line break inside the cell (spec 4.2). */
export const insertCellLineBreak: StateCommand = ({ state, dispatch }) => {
  const info = cursorCell(state);
  if (!info || info.row.kind === "delimiter") return false;
  dispatch(state.update(state.replaceSelection(" \\\\ "), { scrollIntoView: true, userEvent: "input.ltem" }));
  return true;
};

// -- cell ranges in the source ----------------------------------------------------------

/** Cells selected in a table: a range, and the cell the selection ends in. */
export interface LtemCellSelection {
  table: LtemTableInfo;
  range: CellRange;
  /** The cell at the selection's head. */
  active: GridPosition;
}

/**
 * The cells the main selection spans: a selection inside one table that reaches over two
 * or more cells is a range of cells, widened over the merged cells it touches. A selection
 * that ends at the start of a line ends on the line before, so that selecting whole lines
 * selects whole rows. A selection of the whole table is text, not a range: it is copied,
 * cut and deleted as text.
 */
/**
 * Whether ranges of cells are on (`ltemCellSelection`, the `cellRanges` option of `ltem()`).
 * When they are off, a selection over cells is text: it is deleted, copied and pasted over as
 * text.
 */
export const ltemCellRanges = Facet.define<boolean, boolean>({ combine: (values) => values.some((v) => v) });

export function selectedCells(state: EditorState): LtemCellSelection | null {
  if (state.selection.ranges.length > 1) return null;
  const sel = state.selection.main;
  if (sel.empty) return null;
  const doc = state.doc;
  let from = sel.from;
  let to = sel.to;
  if (doc.lineAt(to).from === to) to--;
  if (to > from && doc.lineAt(from).to === from) from++;
  if (to <= from) return null;
  const table = tableAt(state, from);
  if (!table || from < doc.lineAt(table.from).from || to > table.to) return null;
  if (from <= doc.lineAt(table.from).from && to >= table.to) return null;
  const a = cellAt(table, from);
  const b = cellAt(table, to);
  if (!a || !b || (a.row === b.row && a.cell === b.cell)) return null;
  const range = cellRange(table.analysis.table, position(a), position(b));
  return { table, range, active: position(sel.head >= sel.anchor ? b : a) };
}

/** Merge the selected cells into one (their texts one per line). */
export const mergeSelectedCells: StateCommand = ({ state, dispatch }) => {
  const sel = selectedCells(state);
  const next = sel && mergeRange(sel.table.analysis.table, sel.range);
  if (!sel || !next) return false;
  dispatch(state.update(replaceTableSpec(state, sel.table, next, { target: { row: sel.range.top, col: sel.range.left } })));
  return true;
};

/** Empty the selected cells, leaving the table as it is; the cursor goes to the end of the selection's cell. */
export const clearSelectedCells: StateCommand = ({ state, dispatch }) => {
  const sel = selectedCells(state);
  if (!sel) return false;
  const edits = cellsIn(sel.table.analysis.table, sel.range).map((c) => ({ row: c.row, col: c.col, text: "" }));
  const spec = editCellTexts(state, sel.table, edits);
  const head = state.selection.main.head;
  if (!spec) {
    dispatch(state.update({ selection: EditorSelection.cursor(head), userEvent: "select" }));
    return true;
  }
  dispatch(state.update({ ...spec, userEvent: "delete.ltem" }));
  return true;
};
