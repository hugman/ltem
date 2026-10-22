/**
 * LTEM (LLM-friendly Table-Enhanced Markdown).
 *
 * TypeScript implementation of the LTEM specification, version 1.0:
 * Markdown pipe tables with merged cells and multi-row headers.
 *
 * ```ts
 * import { parseTable, renderHtml, write } from "ltem-core";
 *
 * const { table, problems } = parseTable([
 *   "| Region | Revenue | <<  |",
 *   "| ^^     | Q1      | Q2  |",
 *   "|--------|---------|-----|",
 *   "| Asia   | 100     | 120 |",
 * ]);
 * renderHtml(table!); // <table> with colspan and rowspan
 * write(table!);      // canonical LTEM
 *
 * htmlToLtem("<table><tr><th>A</th><th>B</th></tr></table>"); // "| A | B |\n| --- | --- |"
 * ```
 *
 * @packageDocumentation
 */

export { fromHtml, htmlToLtem, type FromHtmlOptions, type HtmlTable } from "./fromhtml/index.js";
export { defaultInline, plainInline, renderHtml, type InlineRenderer } from "./html.js";
export {
  MODEL_VERSION,
  checkTable,
  formatProblem,
  isHeader,
  ownerGrid,
  problemSeverity,
  problemToJSON,
  tableFromJSON,
  type Alignment,
  type Cell,
  type CellSource,
  type Problem,
  type Table,
} from "./model.js";
export { findTables, parseTable, type ParseResult, type TableResult } from "./parser.js";
export type { RowForm } from "./grid.js";
export { SPEC_VERSION, VERSION } from "./version.js";
export { write, writeWithSources } from "./writer.js";

// Line-level helpers for Markdown parser plugins, which find tables themselves and
// hand the lines of each one to parseTable.
export {
  endsTableBody, indentation, isDelimiterRow, isUpperHeaderRow, splitRow, splitRowSpans, startsBlock, type CellSpan,
} from "./syntax.js";
