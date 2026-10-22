/**
 * Copying LTEM tables out as tables.
 *
 * - A selection that contains whole tables also goes to the clipboard as HTML, so that
 *   pasting into a word processor or a web page gives tables with their merged cells. The
 *   plain text on the clipboard is the LTEM source, unchanged.
 * - A range of cells (a selection over two or more cells of a table) goes to the clipboard
 *   as tab-separated text and as an HTML table, as a spreadsheet copies cells. Cutting it
 *   empties the cells and leaves the table.
 * - With ranges of cells off (`cellRanges: false`), a selection over cells is text: the
 *   plain text on the clipboard is the LTEM source as selected, and the cells it covers go
 *   as an HTML table too. Cutting it deletes the text.
 *
 * HTML copied with the LTEM source as its plain text is marked (`data-ltem-copy="source"`),
 * so that pasting it back into the source pastes that source (see paste.ts).
 */

import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { plainInline, renderHtml, type InlineRenderer } from "ltem-core";

import { rangeHtml, rangeTsv } from "./clipboard.js";
import { editCellTexts, ltemCellRanges, selectedCells } from "./commands.js";
import { cellsIn } from "./model.js";
import { tablesIn } from "./query.js";

export interface LtemCopyOptions {
  /**
   * Renders the copied text (Markdown with LTEM tables) as HTML, for example with
   * markdown-it and markdown-it-ltem. Without it, the tables are rendered by the LTEM core
   * and the text around them is copied as plain paragraphs.
   */
  renderMarkdown?: (markdown: string) => string;
  /** Renders one line of cell text as HTML when `renderMarkdown` is not given. Default: the text, escaped. */
  renderInline?: InlineRenderer;
  /** Draw cell borders in the copied tables, which word processors otherwise leave out (default true). */
  borders?: boolean;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

/** Text outside the tables: paragraphs at blank lines, line breaks kept. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.trim() !== "")
    .map((p) => `<p>${p.split("\n").map(escapeHtml).join("<br>\n")}</p>`);
}

/**
 * The HTML for copying the range from `from` to `to`, or null if the range contains no
 * whole LTEM table (it is then copied as text only). A table counts when the range
 * covers it from its first header row to its last body row.
 */
export function copyHtml(state: EditorState, from: number, to: number, options: LtemCopyOptions = {}): string | null {
  if (to <= from) return null;
  const whole = tablesIn(state, from, to).filter((t) => t.from >= from && t.to <= to);
  if (!whole.length) return null;
  let html: string;
  if (options.renderMarkdown) {
    html = options.renderMarkdown(state.doc.sliceString(from, to));
  } else {
    const render = options.renderInline ?? plainInline;
    const parts: string[] = [];
    let pos = from;
    for (const table of whole) {
      parts.push(...paragraphs(state.doc.sliceString(pos, table.from)));
      parts.push(renderHtml(table.analysis.table, render));
      pos = table.to;
    }
    parts.push(...paragraphs(state.doc.sliceString(pos, to)));
    html = parts.join("\n");
  }
  return bordered(html, options);
}

/** The mark on HTML tables copied with the LTEM source as the plain text. */
export const SOURCE_COPY = 'data-ltem-copy="source"';

/** Cell borders for word processors, which otherwise leave them out (unless `borders: false`). */
function bordered(html: string, options: LtemCopyOptions): string {
  return options.borders ?? true
    ? html.replace(/<table(?=[\s>])/g, '<table border="1" cellpadding="4" style="border-collapse: collapse"')
    : html;
}

/** HTML for the clipboard, marked as a copy of the source (`SOURCE_COPY`). */
function markSource(html: string): string {
  return html.replace(/<table(?=[\s>])/g, `<table ${SOURCE_COPY}`);
}

/** Copy and cut selections that contain whole LTEM tables as HTML too. */
export function ltemCopy(options: LtemCopyOptions = {}): Extension {
  const handle = (event: ClipboardEvent, view: EditorView, cut: boolean): boolean => {
    const { state } = view;
    if (!event.clipboardData || state.selection.ranges.length > 1) return false;
    const cells = selectedCells(state);
    const { from, to } = state.selection.main;
    if (cells && !state.facet(ltemCellRanges)) {
      // Ranges of cells off: the source as selected, and the cells it covers as a table.
      const t = cells.table.analysis.table;
      event.preventDefault();
      event.clipboardData.clearData();
      event.clipboardData.setData("text/plain", state.sliceDoc(from, to));
      event.clipboardData.setData("text/html", markSource(bordered(rangeHtml(t, cells.range, options.renderInline), options)));
      if (cut && !state.readOnly) view.dispatch({ changes: { from, to }, scrollIntoView: true, userEvent: "delete.cut" });
      return true;
    }
    if (cells) {
      const t = cells.table.analysis.table;
      event.preventDefault();
      event.clipboardData.clearData();
      event.clipboardData.setData("text/plain", rangeTsv(t, cells.range));
      event.clipboardData.setData("text/html", bordered(rangeHtml(t, cells.range, options.renderInline), options));
      if (cut && !state.readOnly) {
        const spec = editCellTexts(state, cells.table, cellsIn(t, cells.range).map((c) => ({ row: c.row, col: c.col, text: "" })));
        if (spec) view.dispatch({ ...spec, userEvent: "delete.cut" });
      }
      return true;
    }
    const html = copyHtml(state, from, to, options);
    if (html === null) return false;
    event.preventDefault();
    event.clipboardData.clearData();
    event.clipboardData.setData("text/plain", state.sliceDoc(from, to));
    event.clipboardData.setData("text/html", markSource(html));
    if (cut && !state.readOnly) {
      view.dispatch({ changes: { from, to }, scrollIntoView: true, userEvent: "delete.cut" });
    }
    return true;
  };
  return EditorView.domEventHandlers({
    copy: (event, view) => handle(event, view, false),
    cut: (event, view) => handle(event, view, true),
  });
}
