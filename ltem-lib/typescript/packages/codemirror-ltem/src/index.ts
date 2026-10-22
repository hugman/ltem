/**
 * LTEM tables in CodeMirror 6.
 *
 * ```ts
 * import { EditorView, basicSetup } from "codemirror";
 * import { ltem } from "codemirror-ltem";
 *
 * new EditorView({ extensions: [basicSetup, ltem()], parent: document.body });
 * ```
 *
 * @packageDocumentation
 */

import { Prec, type Extension } from "@codemirror/state";
import { keymap, type KeyBinding } from "@codemirror/view";

import {
  enterInTable, formatTable, ltemAutoAlign, insertCellLineBreak, moveColumnLeft, moveColumnRight, moveRowDown, moveRowUp, nextCell,
  previousCell,
} from "./commands.js";
import { ltemCellSelection } from "./cells.js";
import { ltemContextMenu, type LtemContextMenuOptions } from "./menu.js";
import { ltemCopy, type LtemCopyOptions } from "./copy.js";
import { ltemLinter, type LtemLintOptions } from "./lint.js";
import { ltemPaste, type LtemPasteOptions } from "./paste.js";
import { ltemMarkdownLanguage } from "./syntax.js";
import { ltemHighlighting, ltemTableLines, ltemTheme } from "./view.js";
import { ltemTableWidgets, type LtemWidgetOptions } from "./widget.js";
import { ltemCellMarks } from "./marks.js";
import { revealedTables } from "./reveal.js";

export { holdsTables, ltemMarkdown, ltemMarkdownExtensions, ltemMarkdownLanguage, ltemTags, NODE } from "./syntax.js";
export {
  analyzeTable, attributeKeys, cellAtOffset, cellSegments, pipePositions, sourceCellAt, deriveAnalysis, updateAnalysis,
  type SourceCell, type SourceCellKind, type SourceRow, type SourceRowKind, type TableAnalysis,
} from "./analysis.js";
export { cellAt, tableAt, tableFromNode, tablesIn, type LtemCellInfo, type LtemTableInfo } from "./query.js";
export { alignText, displayWidth, writeAligned } from "./format.js";
export {
  alignColumn, cellRange, cellsIn, clearRange, deleteColumn, deleteRow, emptyTable, fillCells, hasEmptyHeader, insertColumn,
  insertRow, isOneCell, makeBodyRows, makeHeaderRows, mergeCells, mergeRange, moveColumn, moveRow, pasteTable, rangeTable,
  rangeTexts, splitCell, uncoverCell, type CellRange, type GridPosition,
} from "./model.js";
export { parseTsv, rangeHtml, rangeTsv, tsvTable, writeClipboard } from "./clipboard.js";
export { ltemCellSelection } from "./cells.js";
export {
  ltemCellTargetAt, ltemTableActions, readClipboard, type LtemActionId, type LtemActionOptions, type LtemCellTarget, type LtemTableAction,
} from "./actions.js";
export { closeTableMenu, ltemContextMenu, ltemContextMenuConfig, openTableMenu, type LtemContextMenuOptions } from "./menu.js";
export {
  alignCenter, alignLeft, alignNone, alignRight, cellPosition, clearSelectedCells, deleteColumnAt, deleteRowAt,
  editCellText, editCellTexts, enterInTable, fillCellsSpec, fixTable, mergeSelectedCells, replaceTableSpec, selectedCells,
  type CellEdit, type LtemCellSelection,
  formatTable, insertCellLineBreak, insertColumnLeft, insertColumnRight, insertRowAbove, insertRowBelow, insertTable,
  keepCoveredText, lineChanges, ltemAutoAlign, ltemCellRanges, makeBodyRow, makeHeaderRow, mergeDown, mergeRight, moveColumnLeft,
  moveColumnRight, moveRowDown, moveRowUp, nextCell, previousCell, splitCellAt,
} from "./commands.js";
export { copyHtml, ltemCopy, type LtemCopyOptions } from "./copy.js";
export { ltemDiagnostics, ltemLinter, type LtemDiagnosticOptions, type LtemLintOptions, type LtemMessages } from "./lint.js";
export {
  ltemPaste, ltemPasteOptions, pasteHtmlTables, pasteTables, rewriteImages, type LtemPasteData, type LtemPasteOptions,
  type LtemPasteTarget,
} from "./paste.js";
export { ltemHighlighting, ltemHighlightStyle, ltemTableLines, ltemTheme } from "./view.js";
export { changedRegions, ltemTableWidgets, selectionLines, type LtemCellRef, type LtemWidgetMessage, type LtemWidgetOptions } from "./widget.js";
export { ltemCellMarks, setLtemCellMarks, type LtemCellMark } from "./marks.js";
export { concealTableSource, revealTableSource, revealedTables } from "./reveal.js";

/**
 * Keys inside a table (outside one they do nothing, and other bindings apply):
 *
 * - Tab / Shift-Tab: next / previous cell; Tab after the last cell adds a row
 * - Enter: the cell below; below the last row, a new row; on an empty last row, leave the table
 * - Tab, Shift-Tab and Enter line up the columns as they move, if that changes nothing but
 *   spacing (`ltemAutoAlign`)
 * - Shift-Enter: a line break inside the cell
 * - Alt-ArrowUp / Alt-ArrowDown: move the row; Alt-ArrowLeft / Alt-ArrowRight: move the column
 * - Alt-Shift-F: line up the columns
 */
export const ltemKeymap: readonly KeyBinding[] = [
  { key: "Tab", run: nextCell, shift: previousCell },
  { key: "Enter", run: enterInTable, shift: insertCellLineBreak },
  { key: "Alt-ArrowUp", run: moveRowUp },
  { key: "Alt-ArrowDown", run: moveRowDown },
  { key: "Alt-ArrowLeft", run: moveColumnLeft },
  { key: "Alt-ArrowRight", run: moveColumnRight },
  { key: "Alt-Shift-f", run: formatTable },
];

export interface LtemConfig {
  /** Markdown language with LTEM tables (default true). Pass options of `markdown()`, or false if you set up the language yourself with `ltemMarkdownExtensions`. */
  markdown?: boolean | Parameters<typeof ltemMarkdownLanguage>[0];
  /** Show validation problems (default true). */
  lint?: boolean | LtemLintOptions;
  /** Convert pasted HTML tables (default true). */
  paste?: boolean | LtemPasteOptions;
  /** Ranges of cells: a selection over two or more cells works on cells, as in a spreadsheet (default true). */
  cellRanges?: boolean;
  /** Copy and cut selections that contain whole tables as HTML too (default true). */
  copy?: boolean | LtemCopyOptions;
  /** A context menu of table actions on a right click in a table (default true); `{ messages, show }`. */
  contextMenu?: boolean | LtemContextMenuOptions;
  /** Bind `ltemKeymap` (default true). */
  keymap?: boolean;
  /** Tab and Enter line up the columns of the table as they move, when only spacing changes (default true). */
  autoAlign?: boolean;
  /** Set table rows in a monospace font so that columns line up (default true). */
  monospace?: boolean;
  /** Show tables as tables when the cursor is not in them (default false). */
  widgets?: boolean | LtemWidgetOptions;
}

/** Everything for LTEM tables in one extension. */
export function ltem(config: LtemConfig = {}): Extension {
  const out: Extension[] = [];
  if (config.markdown !== false) out.push(ltemMarkdownLanguage(typeof config.markdown === "object" ? config.markdown : {}));
  // The application's marks on cells and the tables an Alt-click showed stay while the table
  // widgets come and go (a Live Preview switched off and on, for one).
  out.push(ltemHighlighting, ltemTableLines, ltemCellMarks, revealedTables, ltemTheme({ monospace: config.monospace }));
  if (config.cellRanges !== false) out.push(ltemCellSelection());
  if (config.lint !== false) out.push(ltemLinter(typeof config.lint === "object" ? config.lint : {}));
  if (config.paste !== false) out.push(ltemPaste(typeof config.paste === "object" ? config.paste : {}));
  if (config.copy !== false) out.push(ltemCopy(typeof config.copy === "object" ? config.copy : {}));
  if (config.contextMenu !== false) out.push(ltemContextMenu(typeof config.contextMenu === "object" ? config.contextMenu : {}));
  if (config.keymap !== false) out.push(Prec.high(keymap.of(ltemKeymap)));
  out.push(ltemAutoAlign.of(config.autoAlign !== false));
  if (config.widgets) out.push(ltemTableWidgets(typeof config.widgets === "object" ? config.widgets : {}));
  return out;
}
