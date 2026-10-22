/** Finding and parsing LTEM tables (spec Sections 2 and 3). */

import { GridBuilder, type RowForm } from "./grid.js";
import { MODEL_VERSION, type Cell, type CellSource, type Problem, type Table } from "./model.js";
import {
  alignment, cellLines, endsTableBody, indentation, isDelimiterRow, isSetextUnderline, isUpperHeaderRow, splitRow,
  splitRowSpans, startsBlock, stripSpaces,
} from "./syntax.js";

const LINE_ENDING = /\r\n|\r|\n/; // CommonMark line endings
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The result of parsing one block of lines. */
export interface ParseResult {
  /** The table, or null if the block holds no table. */
  table: Table | null;
  problems: Problem[];
  /** Lines before the table that stay a paragraph (spec 2.3, Section 9). */
  before: string[];
  /** Lines after the table that start another block (spec 2.4). */
  after: string[];
  /** How each row was read: "grid", "compact" or "padded". */
  forms: RowForm[];
  /** Index of the table's first line (its first header row) in the parsed text. */
  start: number;
  /** Index just past the table's last line in the parsed text. */
  end: number;
  /** Where each cell of the table is in the parsed text, in the order of table.cells. */
  sources: CellSource[];
}

function rstripCR(line: string): string {
  let j = line.length;
  while (j > 0 && line[j - 1] === "\r") j--;
  return line.slice(0, j);
}

function noTable(lines: string[]): ParseResult {
  return { table: null, problems: [], before: lines, after: [], forms: [], start: 0, end: 0, sources: [] };
}

/**
 * Parse one block of consecutive non-blank lines that may contain a table.
 *
 * A table may begin on any line of the block, as a GFM table may begin inside a
 * paragraph. Delimiter rows are tried in order; the first one whose header rows fit
 * makes the table (spec 2.3). Lines above the header rows are returned in `before`;
 * lines from the first line that starts another block after the table are returned in
 * `after`. `start` and `end` give the table's lines, counted from `offset`.
 */
export function parseTable(block: string | readonly string[], offset = 0): ParseResult {
  const lines = (typeof block === "string" ? block.split("\n") : [...block]).map(rstripCR);
  for (let d = 1; d < lines.length; d++) {
    // The last header row is a paragraph line, as in GFM: not indented as code, not the
    // start of another block such as a list item or heading, and not a setext heading
    // underline below another paragraph line (spec 2.3).
    if (!isDelimiterRow(lines[d]) || indentation(lines[d - 1]) >= 4 || startsBlock(lines[d - 1])) continue;
    if (d >= 2 && isSetextUnderline(lines[d - 1]) && !startsBlock(lines[d - 2])) continue;
    const result = tryTable(lines, d, offset);
    if (result !== null) return result;
  }
  return noTable(lines);
}

/** The table whose delimiter row is lines[d], or null if its last header row does not fit. */
function tryTable(lines: string[], d: number, offset: number): ParseResult | null {
  // Header rows: the line above the delimiter, plus pipe-led lines above it (spec 2.3).
  // A last header row that looks like a delimiter row is the only header row.
  let top = d - 1;
  const alone = isDelimiterRow(lines[d - 1]);
  while (top > 0 && !alone && isUpperHeaderRow(lines[top - 1])) top--;
  let end = d + 1;
  while (end < lines.length && !endsTableBody(lines[end])) end++;

  const header = lines.slice(top, d);
  const body = lines.slice(d + 1, end);
  const align = splitRow(lines[d]).map(alignment);
  const spans = [...header, ...body].map(splitRowSpans);
  const rows = spans.map((row) => row.map(([text]) => text));
  const builder = new GridBuilder(align.length, header.length, rows.length);
  const forms = rows.map((texts, r) => builder.addRow(r, texts));
  if (forms[header.length - 1] === "padded") return null; // the last header row must fit exactly (spec 2.3)

  const origins = [...builder.origins].sort((a, b) => a.row - b.row || a.col - b.col);
  const cells: Cell[] = origins.map((o) => ({
    row: o.row, col: o.col, rowspan: o.rowspan, colspan: o.colspan, text: cellLines(o.text),
  }));
  const sources: CellSource[] = origins.map((o) => {
    const line = top + o.row + (o.row >= header.length ? 1 : 0); // body rows follow the delimiter
    let start: number;
    let stop: number;
    if (o.source !== null) [, start, stop] = spans[o.row][o.source];
    else start = stop = lines[line].length;
    return { row: o.row, col: o.col, rowspan: o.rowspan, colspan: o.colspan, line: offset + line, start, end: stop };
  });
  const table: Table = {
    version: MODEL_VERSION,
    rows: rows.length,
    cols: align.length,
    header_rows: header.length,
    align,
    cells,
  };
  return {
    table,
    problems: builder.problems,
    before: lines.slice(0, top),
    after: lines.slice(end),
    forms,
    start: offset + top,
    end: offset + end,
    sources,
  };
}

/** A parse result that holds a table. */
export type TableResult = ParseResult & { table: Table };

/**
 * Find the LTEM tables in a Markdown document.
 *
 * This is a light scan, not a full CommonMark parser: it splits the text at blank
 * lines and skips fenced and indented code blocks. Lines end at "\n", "\r\n" or "\r",
 * as in CommonMark. `start` and `end` of each result are line indices in `markdown`.
 * To render whole documents, use LTEM through a Markdown parser plugin instead.
 */
export function findTables(markdown: string): TableResult[] {
  const results: TableResult[] = [];
  let block: string[] = [];
  let blockStart = 0;
  let fence: string | null = null;

  const flush = (): void => {
    let pending = block;
    let offset = blockStart;
    block = [];
    while (pending.length) {
      const result = parseTable(pending, offset);
      if (result.table === null) return;
      results.push(result as TableResult);
      offset = result.end;
      pending = result.after;
    }
  };

  markdown.split(LINE_ENDING).forEach((line, i) => {
    if (fence !== null) {
      const m = FENCE.exec(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !stripSpaces(line.slice(m[0].length))) {
        fence = null; // a closing fence (CommonMark)
      }
      return;
    }
    const m = FENCE.exec(line);
    if (m) {
      flush();
      fence = m[1];
      return;
    }
    if (!stripSpaces(line)) {
      flush(); // a blank line has only spaces and tabs (CommonMark)
    } else if (!block.length && line.startsWith("    ")) {
      return; // indented code block
    } else {
      if (!block.length) blockStart = i;
      block.push(line);
    }
  });
  flush();
  return results;
}
