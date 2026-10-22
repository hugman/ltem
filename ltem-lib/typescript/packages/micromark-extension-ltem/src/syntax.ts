/** The syntax extension: where LTEM tables are and how their cells divide (spec Sections 2 and 3). */

import {
  endsTableBody, indentation, isDelimiterRow, isUpperHeaderRow, parseTable, startsBlock, type Alignment,
} from "ltem-core";
import type {
  Code, Construct, Effects, Event, Extension, ParseContext, Point, State, Token, TokenizeContext,
} from "micromark-util-types";

/** The table: set on `ltemTable` tokens. */
export interface LtemTableInfo {
  /** Alignment of each column; its length is the number of columns. */
  align: Alignment[];
  /** Number of header rows: the first rows of the table. */
  headerRows: number;
}

/** A cell, in the row of its origin: set on `ltemTableCell` tokens. */
export interface LtemCellInfo {
  /** Grid position of the cell's origin, counting header and body rows together from 0. */
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
  header: boolean;
  /** Alignment of the cell's origin column. */
  align: Alignment;
}

/** A row as the core reads it, set on rows while they are tokenized. */
interface RowInfo {
  line: string;
  /** Columns of indentation, written as spaces at the start of `line`. */
  indent: number;
}

declare module "micromark-util-types" {
  interface TokenTypeMap {
    ltemTable: "ltemTable";
    ltemTableHead: "ltemTableHead";
    ltemTableBody: "ltemTableBody";
    ltemTableRow: "ltemTableRow";
    ltemTableDelimiterRow: "ltemTableDelimiterRow";
    ltemTableCell: "ltemTableCell";
    ltemTableLineBreak: "ltemTableLineBreak";
    ltemTableText: "ltemTableText";
    ltemTableWhitespace: "ltemTableWhitespace";
    ltemTablePipe: "ltemTablePipe";
    ltemTableBackslash: "ltemTableBackslash";
    ltemTableEscape: "ltemTableEscape";
  }

  interface Token {
    _ltemTable?: LtemTableInfo | undefined;
    _ltemCell?: LtemCellInfo | undefined;
    /** On rows: the empty cells added at the end of a short row (rule V14), which have no source. */
    _ltemPadding?: LtemCellInfo[] | undefined;
    _ltemRow?: RowInfo | undefined;
  }
}

// Character codes as micromark passes them.
const HT = -2;
const VS = -1; // a column of a tab after its first
const SPACE = 32;
const LESS_THAN = 60;
const BACKSLASH = 92;
const PIPE = 124;

function isLineEnding(code: Code): boolean {
  return code !== null && code < HT; // carriage return, line feed, or both
}

function isSpace(code: Code): boolean {
  return code === HT || code === VS || code === SPACE;
}

/**
 * The micromark extension for LTEM tables.
 *
 * It replaces the GFM table construct (named `table`, which it turns off) with one that
 * recognizes LTEM tables: header rows above the last one, merged cells and line breaks.
 */
export function ltem(): Extension {
  return {
    flow: { [LESS_THAN]: tableBeforeHtml, null: table },
    text: { [BACKSLASH]: pipeEscape },
    string: { [BACKSLASH]: pipeEscape },
    disable: { null: ["table"] },
  };
}

const table: Construct = { name: "ltemTable", tokenize: tokenizer(false), resolveAll: resolveTables };

/**
 * The same construct, tried before HTML blocks: a last header row is a paragraph line
 * unless it begins one of the blocks of spec 2.3, which do not include HTML. Body rows
 * are left to HTML blocks, as to the host's other blocks (spec 2.4).
 */
const tableBeforeHtml: Construct = { name: "ltemTable", tokenize: tokenizer(true), resolveAll: resolveTables };

// -- tokenizing -------------------------------------------------------------------------------
//
// A table is tokenized in two kinds of steps, like micromark's GFM table: the header rows
// and the delimiter row at once, then each body row on its own, when the flow tries its
// constructs on the next line. Rows are tokenized into runs of text, whitespace, pipes and
// backslashes; resolveTables turns them into rows and cells once the core has read the
// table.

function tokenizer(beforeHtml: boolean) {
  return function tokenizeTable(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    const self = this;
    const lines: string[] = [];
    let text = ""; // the current line, from its first character that is no space or tab
    let indent = 0;
    let lineEnd: (code: Code, line: string) => State | undefined;
    let belowUpperRow = false;
    return start;

    function start(code: Code): State | undefined {
      indent = prefixWidth(self);
      if (continuesTable(self.events)) {
        // A body row. Lines that start with "<" are left to HTML blocks first.
        if (beforeHtml || self.parser.lazy[self.now().line]) return nok(code);
        lineEnd = bodyRowEnd;
        effects.enter("ltemTableRow");
        return content(code);
      }
      // A table whose header rows begin here; lines that start with "<" were tried already.
      if (!beforeHtml && code === LESS_THAN) return nok(code);
      // Ending a paragraph: a pipe-led line of it directly above would be a header row of
      // any table here, so none begins on this line, unless it looks like a delimiter row:
      // as a last header row, it stands alone (spec 2.3).
      if (self.interrupt) belowUpperRow = isUpperHeaderRow(previousLine(self));
      lineEnd = headLineEnd;
      effects.enter("ltemTableHead");
      effects.enter("ltemTableRow");
      return content(code);
    }

    /** In a row, after its indentation. */
    function content(code: Code): State | undefined {
      if (code === null || isLineEnding(code)) {
        const line = " ".repeat(indent) + text; // as the core reads it
        effects.exit("ltemTableRow")._ltemRow = { line, indent };
        return lineEnd(code, line);
      }
      if (isSpace(code)) {
        effects.enter("ltemTableWhitespace");
        return whitespace(code);
      }
      if (code === PIPE || code === BACKSLASH) {
        const type = code === PIPE ? "ltemTablePipe" : "ltemTableBackslash";
        effects.enter(type);
        text += String.fromCharCode(code);
        effects.consume(code);
        effects.exit(type);
        return content;
      }
      effects.enter("ltemTableText");
      return textRun(code);
    }

    function whitespace(code: Code): State | undefined {
      if (!isSpace(code)) {
        effects.exit("ltemTableWhitespace");
        return content(code);
      }
      if (code !== VS) text += code === HT ? "\t" : " ";
      effects.consume(code);
      return whitespace;
    }

    function textRun(code: Code): State | undefined {
      if (code === null || isLineEnding(code) || isSpace(code) || code === PIPE || code === BACKSLASH) {
        effects.exit("ltemTableText");
        return content(code);
      }
      text += String.fromCharCode(code);
      effects.consume(code);
      return textRun;
    }

    /** At the end of a line of the header rows or of the delimiter row (spec 2.3). */
    function headLineEnd(code: Code, line: string): State | undefined {
      lines.push(line);
      const above = lines[lines.length - 2];
      if (above === undefined) {
        if (belowUpperRow && !isDelimiterRow(line)) return nok(code);
      } else if (isDelimiterRow(line)) {
        // The last header row is a paragraph line, as in GFM, and must fit the columns.
        if (startsBlock(above) || indentation(above) >= 4) return nok(code);
        const result = parseTable(lines);
        if (result.table === null || result.start !== 0) return nok(code);
        effects.exit("ltemTableHead");
        return ok(code);
      } else if (!isUpperHeaderRow(above)) {
        return nok(code);
      }
      if (code === null) return nok(code);
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      return headLineStart;
    }

    function headLineStart(code: Code): State | undefined {
      // A lazy line belongs to no container of the table: the paragraph goes on there.
      if (code === null || self.parser.lazy[self.now().line]) return nok(code);
      text = "";
      indent = 0;
      if (!isSpace(code)) return headRowStart(code);
      effects.enter("linePrefix");
      return headLinePrefix(code);
    }

    function headLinePrefix(code: Code): State | undefined {
      if (!isSpace(code)) {
        effects.exit("linePrefix");
        return headRowStart(code);
      }
      indent++; // a tab is a horizontal tab and a virtual space per further column
      effects.consume(code);
      return headLinePrefix;
    }

    function headRowStart(code: Code): State | undefined {
      if (code === null || isLineEnding(code)) return nok(code); // a blank line
      effects.enter("ltemTableRow");
      return content(code);
    }

    /** At the end of a body row: it ends the table if it starts another block (spec 2.4). */
    function bodyRowEnd(code: Code, line: string): State | undefined {
      return endsTableBody(line) ? nok(code) : ok(code);
    }
  };
}

/** Columns of the line prefix that the flow tokenized right before the construct. */
function prefixWidth(self: TokenizeContext): number {
  const last = self.events[self.events.length - 1];
  return last !== undefined && last[0] === "exit" && last[1].type === "linePrefix"
    ? self.sliceSerialize(last[1], true).length
    : 0;
}

/** Whether the construct starts right after a row of a table, so on a body row. */
function continuesTable(events: Event[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const [kind, token] = events[i];
    if (token.type === "lineEnding" || token.type === "linePrefix") continue;
    return kind === "exit" && (token.type === "ltemTableHead" || token.type === "ltemTableRow");
  }
  return false;
}

/** The line of the paragraph that the construct is asked to end, as the core reads it. */
function previousLine(self: TokenizeContext): string {
  const events = self.events;
  for (let i = events.length - 1; i >= 0; i--) {
    const [kind, token] = events[i];
    if (token.type === "lineEnding" || token.type === "linePrefix") continue;
    if (kind !== "exit" || token.type !== "chunkContent") return "";
    // The first line of a paragraph starts after the flow's line prefix; later lines
    // include their indentation.
    const before = token.previous === undefined ? events[i - 3] : undefined;
    const prefix = before !== undefined && before[0] === "exit" && before[1].type === "linePrefix"
      ? " ".repeat(self.sliceSerialize(before[1], true).length)
      : "";
    return prefix + self.sliceSerialize(token, true);
  }
  return "";
}

// -- resolving --------------------------------------------------------------------------------

/**
 * Offsets of the backslashes that escape a pipe in cells, per parse. The core removes them
 * from the cell text before inline parsing (spec 2.1); the pipeEscape construct does the
 * same where the inline text is parsed.
 */
const pipeEscapes = new WeakMap<ParseContext, Set<number>>();

/** A row's token, the tokens of its runs, and the line ending and prefix after it. */
interface Row {
  token: Token;
  runs: Token[];
  after: Event[];
}

/** Replace the tokens of each table by tables, rows and cells, as the core reads them. */
function resolveTables(events: Event[], context: TokenizeContext): Event[] {
  const out: Event[] = [];
  for (let i = 0; i < events.length; i++) {
    const [kind, token] = events[i];
    if (kind !== "enter" || token.type !== "ltemTableHead" || token._ltemTable !== undefined) {
      out.push(events[i]);
      continue;
    }
    // The head's rows, then body rows, with line endings and line prefixes between.
    const rows: Row[] = [];
    let end = i;
    let inRow = false;
    let inHead = true;
    for (let j = i + 1; j < events.length; j++) {
      const event = events[j];
      const type = event[1].type;
      if (type === "ltemTableRow") {
        inRow = event[0] === "enter";
        if (inRow) rows.push({ token: event[1], runs: [], after: [] });
        end = j;
      } else if (inRow) {
        if (event[0] === "enter") rows[rows.length - 1].runs.push(event[1]);
      } else if (type === "ltemTableHead") {
        inHead = false;
        end = j;
      } else if (type === "lineEnding" || type === "linePrefix") {
        rows[rows.length - 1].after.push(event);
      } else if (!inHead) {
        break;
      }
    }
    // Line endings after the last row follow the table.
    rows[rows.length - 1].after = [];
    for (const event of buildTable(rows, context)) out.push(event);
    i = end;
  }
  return out;
}

/**
 * Events of a table: the table, its head and body, rows, cells and the cells' inline text.
 * The line endings between rows stay, for micromark to divide the events among lines.
 */
function buildTable(rows: Row[], context: TokenizeContext): Event[] {
  const lines = rows.map((r) => r.token._ltemRow!.line);
  const { table, sources } = parseTable(lines);
  if (table === null) throw new Error("micromark-extension-ltem: expected the lines of a table");
  const delimiter = table.header_rows;
  const escapes = pipeEscapes.get(context.parser) ?? new Set<number>();
  pipeEscapes.set(context.parser, escapes);

  const events: Event[] = [];
  const add = (token: Token): void => {
    events.push(["enter", token, context], ["exit", token, context]);
  };
  const span = (type: Token["type"], start: Point, end: Point, fields: Partial<Token> = {}): Token =>
    ({ ...fields, type, start: { ...start }, end: { ...end } });

  let next = 0; // the next cell; cells are sorted by row
  /** A grid row's events. Grid rows are the source rows without the delimiter row. */
  const addRow = (r: number): void => {
    const source = rows[r < delimiter ? r : r + 1];
    const points = runPoints(source, context);
    const { line, indent } = source.token._ltemRow!;
    const row = span("ltemTableRow", source.token.start, source.token.end, { _ltemPadding: [] });
    events.push(["enter", row, context]);
    for (; next < table.cells.length && table.cells[next].row === r; next++) {
      const cell = table.cells[next];
      const info: LtemCellInfo = {
        row: cell.row, col: cell.col, rowspan: cell.rowspan, colspan: cell.colspan,
        header: cell.row < table.header_rows, align: table.align[cell.col],
      };
      // A cell added to a short row has no source; the core puts it at the end of the line.
      if (sources[next].start === line.length) {
        row._ltemPadding!.push(info);
        continue;
      }
      const start = sources[next].start - indent;
      const end = sources[next].end - indent;
      const cellToken = span("ltemTableCell", points.at(start), points.at(end), { _ltemCell: info });
      events.push(["enter", cellToken, context]);
      cellParts(line.slice(indent), start, end, cell.text !== "", (kind, from, to) => {
        if (kind === "text") add(span("chunkText", points.at(from), points.at(to), { contentType: "text" }));
        else if (kind === "break") add(span("ltemTableLineBreak", points.at(from), points.at(to)));
        else escapes.add(points.at(from).offset);
      });
      events.push(["exit", cellToken, context]);
    }
    events.push(["exit", row, context], ...source.after);
  };

  const first = rows[0].token;
  const last = rows[rows.length - 1].token;
  const info: LtemTableInfo = { align: table.align, headerRows: table.header_rows };
  const tableToken = span("ltemTable", first.start, last.end, { _ltemTable: info });
  const delimiterRow = rows[delimiter];
  const head = span("ltemTableHead", first.start, delimiterRow.token.end, { _ltemTable: info });
  events.push(["enter", tableToken, context], ["enter", head, context]);
  for (let r = 0; r < table.header_rows; r++) addRow(r);
  add(span("ltemTableDelimiterRow", delimiterRow.token.start, delimiterRow.token.end));
  events.push(["exit", head, context], ...delimiterRow.after);
  if (table.rows > table.header_rows) {
    const body = span("ltemTableBody", rows[delimiter + 1].token.start, last.end);
    events.push(["enter", body, context]);
    for (let r = table.header_rows; r < table.rows; r++) addRow(r);
    events.push(["exit", body, context]);
  }
  events.push(["exit", tableToken, context]);
  return events;
}

/** Where each offset of a row's text is, at the starts and ends of its runs. */
function runPoints(row: Row, context: TokenizeContext): { at(offset: number): Point } {
  const points = new Map<number, Point>([[0, row.token.start]]);
  let offset = 0;
  for (const run of row.runs) {
    points.set(offset, run.start);
    offset += context.sliceSerialize(run).length;
    points.set(offset, run.end);
  }
  return {
    at(at: number): Point {
      const point = points.get(at);
      if (point === undefined) throw new Error(`micromark-extension-ltem: no token boundary at ${at}`);
      return point;
    },
  };
}

/** A span attribute at the end of a cell (spec 2.6). */
const SPAN_ATTRIBUTE = /(?:^|(?<=[ \t]))\{[cr]:[0-9]+(?:,[cr]:[0-9]+)*\}$/;

/**
 * The parts of a cell's source, from `start` to `end` in the row's text: the text of
 * each line (spec 4.2), the `\\` line breaks between lines, and the backslashes that
 * escape pipes (spec 2.1). A cell with text drops its span attribute (spec 2.6); a cell
 * without text, such as a placeholder or a marker, has no parts.
 */
function cellParts(
  row: string, start: number, end: number, hasText: boolean,
  part: (kind: "text" | "break" | "escape", from: number, to: number) => void,
): void {
  if (!hasText) return;
  const attribute = SPAN_ATTRIBUTE.exec(row.slice(start, end));
  let stop = attribute === null ? end : start + attribute.index;
  while (stop > start && (row[stop - 1] === " " || row[stop - 1] === "\t")) stop--;

  // Backslashes pair from left to right, after each backslash before a pipe is removed.
  let lineStart = start;
  const flush = (to: number): void => {
    let from = lineStart;
    while (from < to && (row[from] === " " || row[from] === "\t")) from++;
    while (to > from && (row[to - 1] === " " || row[to - 1] === "\t")) to--;
    if (from < to) part("text", from, to);
  };
  for (let i = start; i < stop; i++) {
    if (row[i] !== "\\") continue;
    if (row[i + 1] === "|") {
      part("escape", i, i + 1);
      i++;
    } else if (row[i + 1] === "\\" && row[i + 2] !== "|") {
      flush(i);
      part("break", i, i + 2);
      lineStart = i + 2;
      i++;
    }
  }
  flush(stop);
}

// -- escaped pipes in inline text -------------------------------------------------------------

/**
 * In cells, a backslash before a pipe is removed before inline parsing (spec 2.1), so the
 * cell text `a\|b` is read as `a|b`, and `x\\|` as `x\|`, an escaped pipe. Code spans,
 * which keep backslashes, are handled where the cells are compiled.
 */
const pipeEscape: Construct = { name: "ltemPipeEscape", tokenize: tokenizePipeEscape };

function tokenizePipeEscape(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const self = this;
  return start;

  function start(code: Code): State | undefined {
    const escapes = pipeEscapes.get(self.parser);
    const offset = self.now().offset;
    if (escapes === undefined) return nok(code);
    if (escapes.has(offset)) {
      // A removed backslash: the pipe after it is text.
      effects.enter("ltemTableEscape");
      effects.consume(code);
      effects.exit("ltemTableEscape");
      return ok;
    }
    if (!escapes.has(offset + 1)) return nok(code);
    // A backslash right before a removed one escapes the pipe in the cell text.
    effects.enter("characterEscape");
    effects.enter("escapeMarker");
    effects.consume(code);
    effects.exit("escapeMarker");
    return removed;
  }

  function removed(code: Code): State | undefined {
    effects.enter("ltemTableEscape");
    effects.consume(code);
    effects.exit("ltemTableEscape");
    return pipe;
  }

  function pipe(code: Code): State | undefined {
    effects.enter("characterEscapeValue");
    effects.consume(code);
    effects.exit("characterEscapeValue");
    effects.exit("characterEscape");
    return ok;
  }
}
