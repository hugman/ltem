/**
 * Pasting tables: HTML tables (from web pages, Word, Excel) and tab-separated text (from
 * spreadsheets) become LTEM tables, merged cells of HTML tables kept.
 *
 * - Outside a table, the pasted tables are inserted, written in canonical form with lined-
 *   up columns, separated from surrounding text by blank lines.
 * - Inside a table (the cursor in a cell, or a range of cells selected), the pasted cells
 *   fill the table from that cell on, as in a spreadsheet; the table grows as needed, and
 *   merged cells of a pasted HTML table are merged where they land.
 * - Lines of plain text pasted into a cell become line breaks in the cell, so that the
 *   table keeps its rows.
 * - HTML that holds more than tables (text before or after them, as copied from a web
 *   page) is left to the editor, and so is the plain text that comes with it, even if it
 *   holds tabs: it is not read as tab-separated cells.
 * - Images in pasted cells go through `images`, which can save them and give their new
 *   address; without it, an embedded image (`data:`) is left out, its description kept.
 */

import { Facet, type EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fromHtml, ownerGrid, type Table } from "ltem-core";

import { parseTsv, tsvTable } from "./clipboard.js";
import { cellPosition, cellSource, fillCellsSpec, ltemCellRanges, replaceTableSpec, selectedCells } from "./commands.js";
import { SOURCE_COPY } from "./copy.js";
import { writeAligned } from "./format.js";
import { pasteTable, rangeTexts, type GridPosition } from "./model.js";
import { cellAt, tableAt, type LtemTableInfo } from "./query.js";

export interface LtemPasteOptions {
  /** How cell content is converted: "markdown" keeps emphasis, code and links (default); "plain" keeps text only. */
  inline?: "markdown" | "plain";
  /** Called with the converter's warnings, such as a nested table flattened to text. */
  onWarnings?: (warnings: string[]) => void;
  /**
   * The address to give an image of a pasted cell (`<img src alt>`), for example the
   * relative path of a file the application saves it to, or null to leave the image out
   * and keep its description. It is called while the paste is made, so it gives the
   * address at once (the file can be written afterwards). Spaces and parentheses in the
   * address are written percent-encoded (`%20`), as a Markdown link destination needs.
   * Without it, images keep their addresses, except embedded ones (`data:`), which are
   * left out.
   */
  images?: (src: string, alt: string) => string | null;
}

/** The paste options of an editor, for pastes made from a table shown as a table or from the table menu. */
export const ltemPasteOptions = Facet.define<LtemPasteOptions, LtemPasteOptions>({
  combine: (values) => values[values.length - 1] ?? {},
});

/** What the clipboard holds. */
export interface LtemPasteData {
  html?: string | null;
  text?: string | null;
}

/** Where pasted cells go in a table: from cell `at` on. With `keepSelection`, the selection stays (a table shown as a table stays shown). */
export interface LtemPasteTarget {
  table: LtemTableInfo;
  at: GridPosition;
  keepSelection?: boolean;
}

/** The text of an HTML fragment that a reader would see, outside its tables if `tables` is false. */
function visibleText(html: string, tables: boolean): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, "");
  if (!tables) text = text.replace(/<table\b[\s\S]*?<\/table>/gi, "");
  return text.replace(/<img\b[^>]*>/gi, "x").replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").trim();
}

/** Whether an HTML fragment is only tables: no other text outside its `<table>` elements. */
function onlyTables(html: string): boolean {
  return visibleText(html, false) === "";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const escapeAttribute = (text: string): string => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** An address as a Markdown link destination: no spaces, no unbalanced parentheses (percent-encoded). */
function destination(url: string): string {
  return url.replace(/[\s()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/**
 * The HTML with its images given new addresses by `images` (or, without it, embedded
 * images left out): an image whose address becomes null is replaced by its description.
 * Link and image addresses are written as Markdown link destinations can hold them.
 */
export function rewriteImages(html: string, images?: (src: string, alt: string) => string | null): string {
  const links = html.replace(/<a\b[^>]*>/gi, (tag) => tag.replace(/(\shref\s*=\s*)(?:"([^"]*)"|'([^']*)')/i, (_m, lead: string, d?: string, s?: string) =>
    `${lead}"${escapeAttribute(destination(decodeEntities(d ?? s ?? "")))}"`));
  return links.replace(/<img\b[^>]*>/gi, (tag) => {
    const attribute = (name: string): string => {
      const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
      return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : "";
    };
    const src = attribute("src");
    const alt = attribute("alt");
    const next = images ? images(src, alt) : /^\s*data:/i.test(src) ? null : src;
    if (next === null) return escapeText(alt);
    return `<img src="${escapeAttribute(destination(next))}" alt="${escapeAttribute(alt)}">`;
  });
}

/** The tables a paste holds: the HTML's tables if it is only tables, or else tab-separated text. */
function pastedTables(data: LtemPasteData, options: LtemPasteOptions): { tables: Table[]; tsv: boolean } {
  const html = data.html ?? "";
  if (/<table\b/i.test(html) && onlyTables(html)) {
    const items = fromHtml(rewriteImages(html, options.images), { inline: options.inline ?? "markdown" });
    const warnings = items.flatMap((t, i) => t.warnings.map((w) => (items.length > 1 ? `table ${i + 1}: ${w}` : w)));
    if (warnings.length) options.onWarnings?.(warnings);
    if (items.length) return { tables: items.map((t) => t.table), tsv: false };
  }
  // HTML with other content (text around a table, as copied from a web page): its plain
  // text is not cells, even with tabs in it. Only an empty HTML wrapper counts as no HTML.
  if (html && visibleText(html, true) !== "") return { tables: [], tsv: false };
  const rows = data.text ? parseTsv(data.text) : null;
  const table = rows && tsvTable(rows, { inline: options.inline ?? "markdown" });
  return { tables: table ? [table] : [], tsv: true };
}

/** The cell a paste goes into: the top left cell of the selected cells, or the cell the cursor is in. */
function cellTarget(state: EditorState): LtemPasteTarget | null {
  const cells = selectedCells(state);
  if (cells) return { table: cells.table, at: { row: cells.range.top, col: cells.range.left } };
  const { from, to } = state.selection.main;
  const table = tableAt(state, from);
  if (!table || to > table.to) return null;
  const cell = cellAt(table, from);
  return cell ? { table, at: cellPosition(cell) } : null;
}

/**
 * The transaction for a paste, or null if it is left to the editor (text that is not a
 * block of cells, HTML with other content than tables). `target` overrides where cells go.
 */
export function pasteTables(state: EditorState, data: LtemPasteData, options: LtemPasteOptions = {}, target?: LtemPasteTarget | null): TransactionSpec | null {
  const into = target ?? cellTarget(state);
  const { tables, tsv } = pastedTables(data, options);
  if (into) {
    if (tables.length) {
      const t = tables[0];
      if (t.cells.some((c) => c.rowspan > 1 || c.colspan > 1)) {
        // Merged cells: the table is rewritten with them.
        const next = pasteTable(into.table.analysis.table, into.at, t);
        const last = ownerGrid(next)[into.at.row + t.rows - 1][into.at.col + t.cols - 1]!;
        return replaceTableSpec(state, into.table, next, {
          target: into.keepSelection ? null : { row: last.row, col: last.col }, userEvent: "input.paste.ltem",
        });
      }
      const texts = rangeTexts(t, { top: 0, left: 0, bottom: t.rows - 1, right: t.cols - 1 });
      return fillCellsSpec(state, into.table, into.at, texts, { moveCursor: !into.keepSelection });
    }
    const text = data.text ?? "";
    if (!target && state.facet(ltemCellRanges) && selectedCells(state) && text) {
      // Text over a range of cells goes into its top left cell, so that the table keeps its shape.
      return fillCellsSpec(state, into.table, into.at, [[text.replace(/\r\n?/g, "\n").replace(/\n+$/, "")]], { moveCursor: true });
    }
    if (!into.keepSelection && /\n/.test(text.trim()) && !text.includes("|")) {
      // Lines into one cell: line breaks in the cell (spec 4.2).
      const insert = cellSource(text.trim().replace(/\r\n?/g, "\n"), into.table.analysis.table.version);
      return { ...state.replaceSelection(insert), scrollIntoView: true, userEvent: "input.paste" };
    }
    return null;
  }
  if (!tables.length || (tsv && tables[0].rows < 2)) return null;
  const { from, to } = state.selection.main;
  const doc = state.doc;
  const lineBefore = doc.lineAt(from);
  const lineAfter = doc.lineAt(to);
  // A table needs its own lines, with a blank line before and after it.
  let prefix = "";
  if (doc.sliceString(lineBefore.from, from).trim()) prefix = "\n\n";
  else if (lineBefore.number > 1 && doc.line(lineBefore.number - 1).text.trim()) prefix = "\n";
  let suffix = "";
  if (doc.sliceString(to, lineAfter.to).trim()) suffix = "\n\n";
  else if (lineAfter.number < doc.lines && doc.line(lineAfter.number + 1).text.trim()) suffix = "\n";
  const body = prefix + tables.map((t) => writeAligned(t)).join("\n\n");
  return {
    changes: { from, to, insert: body + suffix },
    selection: { anchor: from + body.length },
    scrollIntoView: true,
    userEvent: "input.paste.ltem",
  };
}

/** `pasteTables` for HTML. */
export function pasteHtmlTables(state: EditorState, html: string, options: LtemPasteOptions = {}): TransactionSpec | null {
  return pasteTables(state, { html }, options);
}

/** Paste HTML tables and tab-separated text as LTEM tables or into LTEM tables. Other pastes are left to the editor. */
export function ltemPaste(options: LtemPasteOptions = {}): Extension {
  return [ltemPasteOptions.of(options), EditorView.domEventHandlers({
    paste(event, view) {
      const data = event.clipboardData;
      if (!data) return false;
      const html = data.getData("text/html");
      const state = view.state;
      const ranges = state.facet(ltemCellRanges);
      // A copy of the LTEM source pastes as that source, but into cells when ranges of cells
      // are on and it goes into a table.
      if (html.includes(SOURCE_COPY) && (!ranges || !cellTarget(state))) return false;
      // With ranges of cells off, a selection over cells is text, which the editor replaces.
      if (!ranges && selectedCells(state)) return false;
      const spec = pasteTables(state, { html, text: data.getData("text/plain") }, options);
      if (!spec) return false;
      event.preventDefault();
      view.dispatch(spec);
      return true;
    },
  })];
}
