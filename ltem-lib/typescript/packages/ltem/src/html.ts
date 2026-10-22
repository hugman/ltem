/** HTML output for LTEM tables (spec Section 6). */

import type { Cell, Table } from "./model.js";

/** Renders one line of cell text (inline Markdown) as HTML. */
export type InlineRenderer = (text: string) => string;

const ASCII_PUNCTUATION = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~");
const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/**
 * Render inline text with only CommonMark backslash escapes and HTML escaping.
 *
 * Used when markdown-it is not available. Emphasis, links and code are left as text.
 */
export function plainInline(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    let ch = text[i];
    if (ch === "\\" && i + 1 < text.length && ASCII_PUNCTUATION.has(text[i + 1])) {
      ch = text[i + 1];
      i++;
    }
    out += HTML_ESCAPES[ch] ?? ch;
  }
  return out;
}

interface MarkdownItLike {
  renderInline(src: string): string;
}

type MarkdownItFactory = (presetName: string) => MarkdownItLike;

/**
 * Load markdown-it, an optional peer dependency, with its "commonmark" preset.
 *
 * It is loaded synchronously through Node's `require`, so that `renderHtml` stays
 * synchronous. Where that is not possible (for example in a browser), this returns
 * null; pass an inline renderer to `renderHtml` there.
 */
function loadMarkdownIt(): InlineRenderer | null {
  try {
    const nodeModule = globalThis.process?.getBuiltinModule?.("node:module");
    if (!nodeModule) return null;
    const required = nodeModule.createRequire(import.meta.url)("markdown-it") as
      MarkdownItFactory | { default: MarkdownItFactory };
    const markdownit = "default" in required ? required.default : required;
    const md = markdownit("commonmark");
    return (text) => md.renderInline(text);
  } catch {
    return null;
  }
}

let cachedInline: InlineRenderer | undefined;

/** CommonMark inline rendering via markdown-it if it can be loaded, else `plainInline`. */
export function defaultInline(): InlineRenderer {
  cachedInline ??= loadMarkdownIt() ?? plainInline;
  return cachedInline;
}

/**
 * Render a table as HTML, in the format of the specification's examples.
 *
 * `inline` renders one line of cell text; lines of a cell are joined with `<br />`.
 * For example, with a markdown-it instance: `renderHtml(table, (s) => md.renderInline(s))`.
 */
export function renderHtml(table: Table, inline?: InlineRenderer): string {
  const render = inline ?? defaultInline();
  const byRow = new Map<number, Cell[]>();
  for (const cell of table.cells) {
    const row = byRow.get(cell.row);
    if (row) row.push(cell);
    else byRow.set(cell.row, [cell]);
  }

  const rowHtml = (r: number): string[] => {
    const tag = r < table.header_rows ? "th" : "td";
    const out = ["<tr>"];
    const cells = [...(byRow.get(r) ?? [])].sort((a, b) => a.col - b.col);
    for (const cell of cells) {
      let attrs = "";
      if (cell.colspan > 1) attrs += ` colspan="${cell.colspan}"`;
      if (cell.rowspan > 1) attrs += ` rowspan="${cell.rowspan}"`;
      const align = table.align[cell.col];
      if (align) attrs += ` align="${align}"`;
      const content = cell.text.split("\n").map((line) => render(line)).join("<br />");
      out.push(`<${tag}${attrs}>${content}</${tag}>`);
    }
    out.push("</tr>");
    return out;
  };

  const parts = ["<table>", "<thead>"];
  for (let r = 0; r < table.header_rows; r++) parts.push(...rowHtml(r));
  parts.push("</thead>");
  if (table.rows > table.header_rows) {
    parts.push("<tbody>");
    for (let r = table.header_rows; r < table.rows; r++) parts.push(...rowHtml(r));
    parts.push("</tbody>");
  }
  parts.push("</table>");
  return parts.join("\n");
}
