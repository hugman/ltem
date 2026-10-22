/** Line-level syntax: rows, delimiter rows, cell kinds and span attributes (spec Section 2). */

import type { Alignment } from "./model.js";

export const DELIMITER_CELL = /^:?-+:?$/;
/** A span attribute ends the cell and is the whole cell or follows a space or tab (spec 2.6). */
export const SPAN_ATTRIBUTE = /(?:^|(?<=[ \t]))\{([cr]:[0-9]+(?:,[cr]:[0-9]+)*)\}$/;
/** Reserved table-identifier line (spec Section 9). */
export const IDENTIFIER_ROW = /^ {0,3}\|[ \t]*#[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*\|[ \t]*$/;
/** A line that begins with a pipe after at most three spaces (spec 2.3). */
export const PIPE_LED = /^ {0,3}\|/;
const LINE_BREAK = /\\\\/;

export const COLSPAN_MARKER = "<<";
export const ROWSPAN_MARKER = "^^";

function isSpaceOrTab(ch: string): boolean {
  return ch === " " || ch === "\t";
}

/** Remove leading and trailing spaces and tabs. */
export function stripSpaces(s: string): string {
  let i = 0;
  let j = s.length;
  while (i < j && isSpaceOrTab(s[i])) i++;
  while (j > i && isSpaceOrTab(s[j - 1])) j--;
  return s.slice(i, j);
}

/** Remove trailing spaces and tabs. */
function rstripSpaces(s: string): string {
  let j = s.length;
  while (j > 0 && isSpaceOrTab(s[j - 1])) j--;
  return s.slice(0, j);
}

/** A cell of a row and where it is: its trimmed text, and the start and end of its source. */
export type CellSpan = [text: string, start: number, end: number];

/**
 * Split a row into cells, as GFM does (spec 2.1), keeping where each cell is.
 *
 * `text` is trimmed of spaces and tabs, and a pipe preceded by a backslash becomes a
 * literal pipe. `start` and `end` index `line` (in UTF-16 code units) and cover the
 * cell's source without the spaces and tabs around it; for an empty cell both are the end
 * of its space between the pipes.
 */
export function splitRowSpans(line: string): CellSpan[] {
  let b = 0;
  let e = line.length;
  while (b < e && isSpaceOrTab(line[b])) b++;
  while (e > b && isSpaceOrTab(line[e - 1])) e--;
  if (b < e && line[b] === "|") b++;
  if (e > b && line[e - 1] === "|" && !(e - 2 >= b && line[e - 2] === "\\")) e--;
  const cells: CellSpan[] = [];
  let cur = "";
  let cellStart = b;
  for (let i = b; i < e; i++) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < e && line[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cellSpan(line, cellStart, i, cur));
      cur = "";
      cellStart = i + 1;
    } else {
      cur += ch;
    }
  }
  cells.push(cellSpan(line, cellStart, e, cur));
  return cells;
}

function cellSpan(line: string, from: number, to: number, text: string): CellSpan {
  let start = from;
  let end = to;
  while (start < end && isSpaceOrTab(line[start])) start++;
  while (end > start && isSpaceOrTab(line[end - 1])) end--;
  return [stripSpaces(text), start, end];
}

/**
 * Split a row into trimmed cell texts, as GFM does (spec 2.1).
 *
 * A pipe preceded by a backslash does not split cells and becomes a literal pipe.
 */
export function splitRow(line: string): string[] {
  return splitRowSpans(line).map(([text]) => text);
}

/** Width of the leading spaces and tabs, with tab stops every 4 columns. */
export function indentation(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

const LIST_DASH = /^ {0,3}-[ \t]/;

/**
 * A GFM delimiter row (spec 2.2).
 *
 * It has at least one pipe, is indented less than 4 spaces, and does not begin a list
 * item: a line such as "- | -" is a list item, as in GFM.
 */
export function isDelimiterRow(line: string): boolean {
  if (!line.includes("|") || indentation(line) >= 4 || LIST_DASH.test(line)) return false;
  return splitRow(line).every((c) => DELIMITER_CELL.test(c));
}

/**
 * Whether a line can be a header row above the last one (spec 2.3, 9).
 *
 * It begins with a pipe, is not a reserved identifier line and does not look like a
 * delimiter row.
 */
export function isUpperHeaderRow(line: string): boolean {
  return PIPE_LED.test(line) && !IDENTIFIER_ROW.test(line) && !isDelimiterRow(line);
}

/** Lines that start another block and so end a table body (spec 2.4). */
const BODY_END = new RegExp("^ {0,3}(?:"
  + ">"                                         // block quote
  + "|#{1,6}(?:[ \\t]|$)"                       // ATX heading
  + "|`{3,}|~{3,}"                              // fenced code
  + "|([-*_])(?:[ \\t]*\\1){2,}[ \\t]*$"          // thematic break
  + "|(?:[-+*]|[0-9]{1,9}[.)])(?:[ \\t]|$)"     // list item
  + ")");

const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;

/** A line of "=" or of "-" characters, which underlines a paragraph line as a heading. */
export function isSetextUnderline(line: string): boolean {
  return SETEXT_UNDERLINE.test(line);
}

/** Whether a line begins a block quote, ATX heading, fenced code, thematic break or list item. */
export function startsBlock(line: string): boolean {
  return BODY_END.test(line);
}

/** Whether a table ends before this line (spec 2.4): blank, indented code, or another block. */
export function endsTableBody(line: string): boolean {
  return !stripSpaces(line) || indentation(line) >= 4 || startsBlock(line);
}

/** The alignment a delimiter cell sets (spec 2.2). */
export function alignment(cell: string): Alignment {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

export interface Attribute {
  colspan: number | null;
  rowspan: number | null;
  problems: string[];
}

/**
 * Remove a trailing span attribute from a content cell (spec 2.6).
 *
 * Returns the remaining text and the attribute, or `[text, null]` if there is none.
 */
export function splitAttribute(text: string): [string, Attribute | null] {
  const m = SPAN_ATTRIBUTE.exec(text);
  if (!m) return [text, null];
  let colspan: number | null = null;
  let rowspan: number | null = null;
  const problems: string[] = [];
  for (const spec of m[1].split(",")) {
    const [key, value] = spec.split(":") as [string, string];
    let n = Number.parseInt(value, 10);
    if (n < 1) {
      problems.push(`span value must be a positive integer, got ${value}`);
      n = 1;
    }
    if (key === "c") {
      if (colspan !== null) {
        problems.push("'c' appears more than once");
        continue;
      }
      colspan = n;
    } else {
      if (rowspan !== null) {
        problems.push("'r' appears more than once");
        continue;
      }
      rowspan = n;
    }
  }
  return [rstripSpaces(text.slice(0, m.index)), { colspan, rowspan, problems }];
}

// The LTEM escapes of spec 4.3, as written in cell source.
const ESCAPED_MARKER = /^\\(<<|\^\^)$/;
const ESCAPED_ATTRIBUTE = /(?:^|(?<=[ \t]))\\(\{[cr]:[0-9]+(?:,[cr]:[0-9]+)*\})$/;

/** Remove the backslash of an LTEM escape (spec 4.3), as GFM does for `\|`. */
export function unescapeLtem(line: string): string {
  const m = ESCAPED_MARKER.exec(line);
  if (m) return m[1];
  return line.replace(ESCAPED_ATTRIBUTE, "$1");
}

/**
 * Turn cell source into model text (spec Section 7).
 *
 * Split at each `\\`, trim each line and remove LTEM escapes.
 */
export function cellLines(text: string): string {
  return text
    .split(LINE_BREAK)
    .map((part) => unescapeLtem(stripSpaces(part)))
    .join("\n");
}
