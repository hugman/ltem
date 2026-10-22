/**
 * Clipboard formats for cells: tab-separated text (TSV) as spreadsheets write and read it,
 * and HTML tables.
 */

import { fromHtml, plainInline, renderHtml, type InlineRenderer, type Table } from "ltem-core";

import { rangeTable, rangeTexts, type CellRange } from "./model.js";

/**
 * The rows of tab-separated text as Excel and other spreadsheets put it on the clipboard:
 * cells separated by tabs, rows by line breaks; a cell in double quotes may hold tabs, line
 * breaks and doubled quotes. Rows are padded to the same length. Null if the text holds no
 * tab, which is then not a block of cells.
 */
export function parseTsv(text: string): string[][] | null {
  if (!text.includes("\t")) return null;
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;
  while (i <= n) {
    let cell = "";
    if (text[i] === '"') {
      // A quoted cell: up to the closing quote, "" standing for one quote.
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            cell += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        cell += text[j++];
      }
      if (closed && (j >= n || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) {
        i = j;
      } else {
        // Not a quoted cell after all: read it as plain text.
        cell = "";
        while (i < n && text[i] !== "\t" && text[i] !== "\n" && text[i] !== "\r") cell += text[i++];
      }
    } else {
      while (i < n && text[i] !== "\t" && text[i] !== "\n" && text[i] !== "\r") cell += text[i++];
    }
    row.push(cell);
    if (i >= n) {
      rows.push(row);
      break;
    }
    if (text[i] === "\t") {
      i++;
      continue;
    }
    // A line break ends the row.
    if (text[i] === "\r" && text[i + 1] === "\n") i++;
    i++;
    rows.push(row);
    row = [];
    if (i >= n) break;
  }
  // A line break after the last row (spreadsheets write one) is not an empty row.
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  if (!rows.length) return null;
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => (r.length < width ? [...r, ...new Array(width - r.length).fill("")] : r));
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

/**
 * The table model for rows of cells read from tab-separated text, the first row as the
 * header row. The texts are plain text and are escaped as the LTEM core escapes text taken
 * from HTML, so that they read the same in Markdown.
 */
export function tsvTable(rows: string[][], options: { inline?: "markdown" | "plain" } = {}): Table | null {
  const html = `<table>${rows.map((row) =>
    `<tr>${row.map((cell) => `<td>${escapeHtml(cell).replace(/\r?\n/g, "<br>")}</td>`).join("")}</tr>`).join("")}</table>`;
  const [first] = fromHtml(html, { headerRows: 1, inline: options.inline ?? "plain" });
  return first?.table ?? null;
}

/** Cell text (inline Markdown) as plain text: backslash escapes of punctuation removed. */
function plainText(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

/** A range of cells as tab-separated text, quoted as spreadsheets quote it. */
export function rangeTsv(table: Table, range: CellRange): string {
  return rangeTexts(table, range).map((row) => row.map((text) => {
    const plain = plainText(text);
    return /[\t\n"]/.test(plain) ? `"${plain.replace(/"/g, '""')}"` : plain;
  }).join("\t")).join("\n");
}

/** A range of cells as an HTML table, merged cells kept. */
export function rangeHtml(table: Table, range: CellRange, render: InlineRenderer = plainInline): string {
  return renderHtml(rangeTable(table, range), render).replace("<thead>\n</thead>\n", "");
}

/**
 * Put text and HTML on the clipboard from a user action such as a menu choice or a key,
 * through a copy command. Returns false if the browser refused.
 */
export function writeClipboard(doc: Document, plain: string, html: string | null): boolean {
  let written = false;
  const onCopy = (event: ClipboardEvent): void => {
    if (!event.clipboardData) return;
    event.clipboardData.clearData();
    event.clipboardData.setData("text/plain", plain);
    if (html !== null) event.clipboardData.setData("text/html", html);
    event.preventDefault();
    event.stopImmediatePropagation();
    written = true;
  };
  doc.addEventListener("copy", onCopy, true);
  try {
    doc.execCommand("copy");
  } finally {
    doc.removeEventListener("copy", onCopy, true);
  }
  return written;
}
