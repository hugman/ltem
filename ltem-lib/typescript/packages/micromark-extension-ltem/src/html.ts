/** The HTML extension: LTEM tables in micromark's HTML output (spec Section 6). */

import type { HtmlExtension } from "micromark-util-types";

import type { LtemCellInfo } from "./syntax.js";

/**
 * The micromark HTML extension for LTEM tables, for use with `ltem()`.
 *
 * It writes the HTML of the specification: all header rows in `<thead>`, `colspan` and
 * `rowspan` above 1, alignment as `align`, and line breaks in cells as `<br />`.
 */
export function ltemHtml(): HtmlExtension {
  return {
    enter: {
      ltemTable() {
        this.lineEndingIfNeeded();
        this.tag("<table>");
      },
      ltemTableHead() {
        this.lineEndingIfNeeded();
        this.tag("<thead>");
      },
      ltemTableBody() {
        this.lineEndingIfNeeded();
        this.tag("<tbody>");
      },
      ltemTableRow() {
        this.lineEndingIfNeeded();
        this.tag("<tr>");
      },
      ltemTableCell(token) {
        const cell = token._ltemCell!;
        this.lineEndingIfNeeded();
        this.tag(`<${tagName(cell)}${attributes(cell)}>`);
        this.buffer();
      },
      ltemTableLineBreak() {
        this.tag("<br />");
      },
    },
    exit: {
      ltemTable() {
        this.lineEndingIfNeeded();
        this.tag("</table>");
      },
      ltemTableHead() {
        this.lineEndingIfNeeded();
        this.tag("</thead>");
      },
      ltemTableBody() {
        this.lineEndingIfNeeded();
        this.tag("</tbody>");
      },
      ltemTableRow(token) {
        for (const cell of token._ltemPadding ?? []) {
          this.lineEndingIfNeeded();
          this.tag(`<${tagName(cell)}${attributes(cell)}></${tagName(cell)}>`);
        }
        this.lineEndingIfNeeded();
        this.tag("</tr>");
      },
      ltemTableCell(token) {
        // A code span keeps its backslashes, but the backslash before a pipe is not part
        // of the cell text (spec 2.1). Every pipe in a cell's source is escaped, so every
        // backslash before a pipe in the cell's code is such a backslash.
        this.raw(this.resume().replace(/<code>[^]*?<\/code>/g, (code) => code.replaceAll("\\|", "|")));
        this.tag(`</${tagName(token._ltemCell!)}>`);
      },
    },
  };
}

function tagName(cell: LtemCellInfo): string {
  return cell.header ? "th" : "td";
}

function attributes(cell: LtemCellInfo): string {
  let result = "";
  if (cell.colspan > 1) result += ` colspan="${cell.colspan}"`;
  if (cell.rowspan > 1) result += ` rowspan="${cell.rowspan}"`;
  if (cell.align) result += ` align="${cell.align}"`;
  return result;
}
