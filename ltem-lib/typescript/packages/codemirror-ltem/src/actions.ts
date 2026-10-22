/**
 * Table actions for menus: what can be done to a cell or a range of cells, with a name, a
 * shortcut to show, whether it can be done now, and a function that does it. The
 * component's context menu is drawn from this list; an application can build its own menu
 * (or toolbar) from the same list.
 */

import type { EditorView } from "@codemirror/view";
import { ownerGrid, plainInline, type Alignment, type InlineRenderer, type Table } from "ltem-core";

import { rangeHtml, rangeTsv, writeClipboard } from "./clipboard.js";
import { cellPosition, editCellTexts, fillCellsSpec, replaceTableSpec, selectedCells } from "./commands.js";
import { ltemPasteOptions, pasteTables, type LtemPasteData } from "./paste.js";
import { sourceCellAt } from "./analysis.js";
import {
  alignColumn, cellRange, cellsIn, deleteColumn, deleteRow, insertColumn, insertRow, isOneCell, makeBodyRows, makeHeaderRows, mergeCells, mergeRange,
  moveColumn, moveRow, splitCell, type CellRange, type GridPosition,
} from "./model.js";
import { cellAt, tableAt, type LtemTableInfo } from "./query.js";
import { revealTableSource } from "./reveal.js";

/** The cells an action acts on. */
export interface LtemCellTarget {
  table: LtemTableInfo;
  /** The cells acted on: one cell, or a range. */
  range: CellRange;
  /** The active cell (where the click was, or the selection's head). */
  cell: GridPosition;
  /**
   * Whether the table is shown as a table. Actions then leave the editor's selection where
   * it is, so that the table stays shown; in the source they put the cursor in the cell.
   */
  widget: boolean;
  /**
   * Called by an action, before it changes the table, with the cell its result centres on.
   * Where the table is shown as a table, the component selects that cell in the new drawing.
   */
  focusAfter?: (cell: GridPosition) => void;
}

export type LtemActionId =
  | "insertRowAbove" | "insertRowBelow" | "deleteRows" | "moveRowUp" | "moveRowDown" | "headerRow" | "bodyRow"
  | "insertColumnLeft" | "insertColumnRight" | "deleteColumns" | "moveColumnLeft" | "moveColumnRight"
  | "mergeCells" | "mergeRight" | "mergeDown" | "splitCells"
  | "alignLeft" | "alignCenter" | "alignRight" | "alignNone"
  | "copy" | "cut" | "paste" | "clear" | "formatTable" | "editSource";

export interface LtemTableAction {
  /** One of the component's actions, or an application's (see `LtemContextMenuOptions.extraActions`). */
  id: LtemActionId | (string & {});
  label: string;
  /** Actions of a group belong together in a menu: rows, columns, cells, alignment, clipboard, table. */
  group: "row" | "column" | "cell" | "align" | "clipboard" | "table" | (string & {});
  /** A key that does the same in the source, to show next to the label. */
  shortcut?: string;
  enabled: boolean;
  /** For a choice that holds now (the alignment of the columns). */
  checked?: boolean;
  /** Do the action. Returns false if it could not be done. */
  run(view: EditorView): boolean;
}

export interface LtemActionOptions {
  /** Language of the labels (default "en"), or a function giving each label. */
  messages?: "en" | "ko" | ((id: LtemActionId) => string);
  /** Renders cell text as HTML for Copy and Cut. Default: the text, escaped. */
  renderInline?: InlineRenderer;
  /**
   * Reads the clipboard for Paste. Default: the browser's clipboard (`navigator.clipboard`),
   * which may ask for permission. An Electron application can read it in its own way, for
   * example with `clipboard.readHTML()` and `clipboard.readText()`.
   */
  readClipboard?: () => Promise<LtemPasteData | null>;
}

/** The clipboard's HTML and text through the browser, or null if it cannot be read. */
export async function readClipboard(): Promise<LtemPasteData | null> {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clip) return null;
  try {
    const data: LtemPasteData = {};
    for (const item of await clip.read()) {
      if (item.types.includes("text/html")) data.html = await (await item.getType("text/html")).text();
      if (item.types.includes("text/plain")) data.text = await (await item.getType("text/plain")).text();
    }
    return data;
  } catch {
    try {
      return { text: await clip.readText() };
    } catch {
      return null;
    }
  }
}

const LABELS: Record<"en" | "ko", Record<LtemActionId, string>> = {
  en: {
    insertRowAbove: "Insert row above", insertRowBelow: "Insert row below", deleteRows: "Delete row",
    moveRowUp: "Move row up", moveRowDown: "Move row down",
    insertColumnLeft: "Insert column left", insertColumnRight: "Insert column right", deleteColumns: "Delete column",
    moveColumnLeft: "Move column left", moveColumnRight: "Move column right",
    mergeCells: "Merge cells", mergeRight: "Merge with right cell", mergeDown: "Merge with cell below", splitCells: "Split cell",
    headerRow: "Make header row", bodyRow: "Make body row",
    alignLeft: "Align left", alignCenter: "Align center", alignRight: "Align right", alignNone: "No alignment",
    copy: "Copy", cut: "Cut", paste: "Paste", clear: "Clear contents", formatTable: "Line up columns", editSource: "Edit source",
  },
  ko: {
    insertRowAbove: "위에 행 넣기", insertRowBelow: "아래에 행 넣기", deleteRows: "행 지우기",
    moveRowUp: "행을 위로", moveRowDown: "행을 아래로",
    insertColumnLeft: "왼쪽에 열 넣기", insertColumnRight: "오른쪽에 열 넣기", deleteColumns: "열 지우기",
    moveColumnLeft: "열을 왼쪽으로", moveColumnRight: "열을 오른쪽으로",
    mergeCells: "셀 병합", mergeRight: "오른쪽 셀과 병합", mergeDown: "아래 셀과 병합", splitCells: "셀 나누기",
    headerRow: "머리글 행으로 바꾸기", bodyRow: "본문 행으로 바꾸기",
    alignLeft: "왼쪽 정렬", alignCenter: "가운데 정렬", alignRight: "오른쪽 정렬", alignNone: "정렬 없음",
    copy: "복사", cut: "잘라내기", paste: "붙여넣기", clear: "내용 지우기", formatTable: "열 맞추기", editSource: "원문 보기",
  },
};

const SHORTCUTS: Partial<Record<LtemActionId, string>> = {
  moveRowUp: "Alt+↑", moveRowDown: "Alt+↓", moveColumnLeft: "Alt+←", moveColumnRight: "Alt+→",
  copy: "Ctrl+C", cut: "Ctrl+X", paste: "Ctrl+V", clear: "Del", formatTable: "Alt+Shift+F",
};

/**
 * The target for the cell at a document position in the source: the selected cells if the
 * position is among them, or else that cell. Null outside a table.
 */
export function ltemCellTargetAt(view: EditorView, pos: number): LtemCellTarget | null {
  const selected = selectedCells(view.state);
  if (selected) {
    const at = cellAt(selected.table, pos);
    const p = at && cellPosition(at);
    const r = selected.range;
    if (p && p.row >= r.top && p.row <= r.bottom && p.col >= r.left && p.col <= r.right) {
      return { table: selected.table, range: r, cell: selected.active, widget: false };
    }
  }
  const table = tableAt(view.state, pos);
  const at = table && cellAt(table, pos);
  if (!table || !at) return null;
  const p = cellPosition(at);
  return { table, range: cellRange(table.analysis.table, p, p), cell: p, widget: false };
}

/** The rows, or columns, of a range, from the last to the first. */
function descending(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = to; i >= from; i--) out.push(i);
  return out;
}

/** The actions for a target, in menu order. */
export function ltemTableActions(target: LtemCellTarget, options: LtemActionOptions = {}): LtemTableAction[] {
  const messages = options.messages ?? "en";
  const label = (id: LtemActionId): string => (typeof messages === "function" ? messages(id) : LABELS[messages][id]);
  const { range, cell, widget } = target;
  const t = target.table.analysis.table;
  const grid = ownerGrid(t);
  const owner = grid[cell.row]?.[cell.col] ?? null;
  const single = isOneCell(t, range);
  const singleRow = range.top === range.bottom;
  const singleCol = range.left === range.right;

  /** Write the table as `next`, the cursor (in the source) in cell `at`. */
  const apply = (view: EditorView, next: Table | null, at: GridPosition): boolean => {
    if (!next) return false;
    const table = tableAt(view.state, target.table.from) ?? target.table;
    if (widget) target.focusAfter?.(at);
    view.dispatch(replaceTableSpec(view.state, table, next, { target: widget ? null : at }));
    if (!widget) view.focus();
    return true;
  };
  const edit = (id: LtemActionId, group: LtemTableAction["group"], make: () => Table | null, at: () => GridPosition): LtemTableAction => {
    let next: Table | null | undefined;
    const compute = (): Table | null => (next === undefined ? (next = make()) : next);
    return {
      id, group, label: label(id), shortcut: SHORTCUTS[id],
      get enabled() { return compute() !== null; },
      run: (view) => apply(view, compute(), at()),
    };
  };

  const header = (row: number): boolean => row < t.header_rows;
  const rowsBelow = range.bottom + 1;
  const deleteRows = (): Table | null => {
    let next: Table | null = t;
    for (const r of descending(range.top, range.bottom)) next = next && deleteRow(next, r);
    return next;
  };
  const deleteCols = (): Table | null => {
    let next: Table | null = t;
    for (const c of descending(range.left, range.right)) next = next && deleteColumn(next, c);
    return next;
  };
  const aligned = (align: Alignment): boolean => t.align.slice(range.left, range.right + 1).every((a) => a === align);
  const alignAll = (align: Alignment): Table => {
    let next = t;
    for (let c = range.left; c <= range.right; c++) next = alignColumn(next, c, align);
    return next;
  };
  const splitAll = (): Table | null => {
    let next: Table | null = t;
    let any = false;
    for (const c of cellsIn(t, range)) {
      if (c.rowspan === 1 && c.colspan === 1) continue;
      next = next && splitCell(next, c.row, c.col);
      any = true;
    }
    return any ? next : null;
  };
  const topLeft = (): GridPosition => ({ row: range.top, col: range.left });

  const actions: LtemTableAction[] = [
    edit("insertRowAbove", "row", () => insertRow(t, range.top, header(range.top)), () => ({ row: range.top, col: cell.col })),
    edit("insertRowBelow", "row",
      () => insertRow(t, rowsBelow, header(rowsBelow) || (header(range.bottom) && rowsBelow === t.header_rows)),
      () => ({ row: rowsBelow, col: cell.col })),
    edit("deleteRows", "row", deleteRows, () => ({ row: Math.max(0, Math.min(range.top, t.rows - (range.bottom - range.top + 1) - 1)), col: cell.col })),
    edit("moveRowUp", "row", () => (singleRow ? moveRow(t, range.top, -1) : null), () => ({ row: range.top - 1, col: cell.col })),
    edit("moveRowDown", "row", () => (singleRow ? moveRow(t, range.top, 1) : null), () => ({ row: range.top + 1, col: cell.col })),
    // The rows up to the range's last one become the header; from its first one, the body.
    edit("headerRow", "row", () => makeHeaderRows(t, range.bottom), () => {
      const next = makeHeaderRows(t, range.bottom);
      return { row: Math.max(0, cell.row - (next ? t.rows - next.rows : 0)), col: cell.col };
    }),
    edit("bodyRow", "row", () => makeBodyRows(t, range.top), () => {
      const next = makeBodyRows(t, range.top);
      return { row: cell.row + (next ? next.rows - t.rows : 0), col: cell.col };
    }),
    edit("insertColumnLeft", "column", () => insertColumn(t, range.left), () => ({ row: cell.row, col: range.left })),
    edit("insertColumnRight", "column", () => insertColumn(t, range.right + 1), () => ({ row: cell.row, col: range.right + 1 })),
    edit("deleteColumns", "column", deleteCols, () => ({ row: cell.row, col: Math.max(0, Math.min(range.left, t.cols - (range.right - range.left + 1) - 1)) })),
    edit("moveColumnLeft", "column", () => (singleCol ? moveColumn(t, range.left, -1) : null), () => ({ row: cell.row, col: range.left - 1 })),
    edit("moveColumnRight", "column", () => (singleCol ? moveColumn(t, range.left, 1) : null), () => ({ row: cell.row, col: range.left + 1 })),
  ];
  if (single) {
    actions.push(
      edit("mergeRight", "cell", () => (owner ? mergeCells(t, owner.row, owner.col, "right") : null), topLeft),
      edit("mergeDown", "cell", () => (owner ? mergeCells(t, owner.row, owner.col, "down") : null), topLeft),
    );
  } else {
    actions.push(edit("mergeCells", "cell", () => mergeRange(t, range), topLeft));
  }
  actions.push(edit("splitCells", "cell", splitAll, topLeft));
  for (const [id, align] of [["alignLeft", "left"], ["alignCenter", "center"], ["alignRight", "right"], ["alignNone", null]] as const) {
    const action = edit(id, "align", () => (aligned(align) ? null : alignAll(align)), () => cell);
    actions.push(Object.defineProperty(action, "checked", { value: aligned(align), enumerable: true }));
  }

  // Clipboard: the cells as tab-separated text and an HTML table.
  const copy = (view: EditorView): boolean => {
    const html = single ? null : rangeHtml(t, range, options.renderInline ?? plainInline);
    return writeClipboard(view.dom.ownerDocument, rangeTsv(t, range), html);
  };
  const clear = (view: EditorView): boolean => {
    const table = tableAt(view.state, target.table.from) ?? target.table;
    const spec = editCellTexts(view.state, table, cellsIn(table.analysis.table, range).map((c) => ({ row: c.row, col: c.col, text: "" })));
    if (spec) view.dispatch({ ...spec, userEvent: "delete.ltem" });
    return true;
  };
  // Paste reads the clipboard, which takes a moment: the change follows when it is read.
  const paste = (view: EditorView): boolean => {
    void (options.readClipboard ?? readClipboard)().then((data) => {
      if (!data || (!data.html && !data.text)) return;
      const table = tableAt(view.state, target.table.from) ?? target.table;
      const at = { row: range.top, col: range.left };
      const spec = pasteTables(view.state, data, view.state.facet(ltemPasteOptions), { table, at, keepSelection: widget })
        ?? (data.text ? fillCellsSpec(view.state, table, at, [[data.text.replace(/\r\n?/g, "\n").replace(/\n+$/, "")]], { moveCursor: !widget }) : null);
      if (!spec) return;
      if (widget) target.focusAfter?.(at);
      view.dispatch(spec);
      if (!widget) view.focus();
    });
    return true;
  };
  const hasText = cellsIn(t, range).some((c) => c.text !== "");
  actions.push(
    { id: "copy", group: "clipboard", label: label("copy"), shortcut: SHORTCUTS.copy, enabled: true, run: copy },
    { id: "cut", group: "clipboard", label: label("cut"), shortcut: SHORTCUTS.cut, enabled: hasText, run: (view) => copy(view) && clear(view) },
    { id: "paste", group: "clipboard", label: label("paste"), shortcut: SHORTCUTS.paste, enabled: true, run: paste },
    { id: "clear", group: "clipboard", label: label("clear"), shortcut: SHORTCUTS.clear, enabled: hasText, run: clear },
    edit("formatTable", "table", () => t, () => cell),
  );
  if (widget) {
    actions.push({
      id: "editSource", group: "table", label: label("editSource"), enabled: true,
      run(view) {
        const table = tableAt(view.state, target.table.from) ?? target.table;
        const found = sourceCellAt(table.analysis, cell.row, cell.col) ?? (owner && sourceCellAt(table.analysis, owner.row, owner.col));
        const anchor = found ? table.lineStarts[found.row.line] + found.cell.end : table.from;
        const doc = view.state.doc;
        view.dispatch({
          selection: { anchor },
          effects: revealTableSource.of({ from: doc.lineAt(table.from).from, to: doc.lineAt(table.to).to }),
          scrollIntoView: true,
          userEvent: "select",
        });
        view.focus();
        return true;
      },
    });
  }
  return actions;
}
