/**
 * marked extension for LTEM tables.
 *
 * ```ts
 * import { marked } from "marked";
 * import markedLtem from "marked-ltem";
 *
 * marked.use(markedLtem());
 * const html = marked.parse(text);
 * ```
 *
 * The extension takes over table recognition from marked. A table that needs no LTEM
 * feature becomes marked's own `table` token, so it renders as before; a table with
 * merged cells, several header rows or line breaks in cells becomes an `ltemTable`
 * token, rendered with colspan, rowspan and several header rows.
 *
 * @packageDocumentation
 */

import {
  endsTableBody, indentation, isDelimiterRow, isUpperHeaderRow, parseTable, startsBlock, type Alignment,
  type CellSource, type Table,
} from "ltem-core";
import type { MarkedExtension, RendererThis, Token, Tokens, TokenizerThis } from "marked";

/** A cell of an `ltemTable` token, in the row of its origin. */
export interface LtemTableCell {
  type: "ltemTableCell";
  /** The cell's source, without the spaces and tabs around it; empty for a cell added to a short row. */
  raw: string;
  /**
   * The cell text of the LTEM table model: its lines, each trimmed, joined by "\n", without
   * the span attribute, with `\|` read as `|` and the LTEM escapes without their backslash.
   */
  text: string;
  /** Inline tokens from marked's inline lexer; the lines of the cell are separated by `br` tokens. */
  tokens: Token[];
  header: boolean;
  align: Alignment;
  /** Grid position of the cell's origin and its size, counting header and body rows together. */
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

/** A table that needs LTEM features: merged cells, several header rows or line breaks in cells. */
export interface LtemTableToken {
  type: "ltemTable";
  raw: string;
  /** Alignment of each column; its length is the number of columns. */
  align: Alignment[];
  /** Header rows; each lists the cells whose origin is in that row, in column order. */
  header: LtemTableCell[][];
  /** Body rows, like `header`. A row whose positions are all covered by cells above is empty. */
  rows: LtemTableCell[][];
}

export interface MarkedLtemOptions {
  /**
   * Emit marked's own `table` token for a table with one header row, no merged cells and
   * no line breaks in cells, so that code which reads marked's tokens keeps working.
   * Default `true`. With `false`, every table is an `ltemTable` token.
   */
  nativeTables?: boolean;
}

/** The marked extension for LTEM tables. Use it with `marked.use(markedLtem())`. */
export default function markedLtem(options: MarkedLtemOptions = {}): MarkedExtension {
  const nativeTables = options.nativeTables ?? true;
  return {
    extensions: [
      {
        name: "ltemTable",
        level: "block",
        start: tableStart,
        tokenizer(src, tokens) {
          return tokenizeTable(this, src, tokens, nativeTables);
        },
        renderer: renderTable,
        childTokens: ["header", "rows"],
      },
      { name: "ltemLineBreak", level: "inline", tokenizer: lineBreak },
    ],
    // LTEM decides what is a table (spec 2.3): marked's own table rule must not find
    // tables that LTEM rejects, such as a last header row that does not fit.
    tokenizer: { table: () => undefined },
  };
}

export { markedLtem };

// -- lines -------------------------------------------------------------------------------

/** Blank as CommonMark defines it: empty or only spaces and tabs. */
function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

/** The lines of `src` up to its first blank line, and the offset of each. */
function blockLines(src: string): { lines: string[]; offsets: number[] } {
  const lines: string[] = [];
  const offsets: number[] = [];
  for (let pos = 0; pos <= src.length;) {
    const end = lineEnd(src, pos);
    const line = src.slice(pos, end);
    if (lines.length && isBlank(line)) break;
    lines.push(line);
    offsets.push(pos);
    pos = end + 1;
  }
  return { lines, offsets };
}

function lineEnd(src: string, pos: number): number {
  const end = src.indexOf("\n", pos);
  return end < 0 ? src.length : end;
}

function lastLine(raw: string): string {
  const text = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  return text.slice(text.lastIndexOf("\n") + 1);
}

// -- where a paragraph must end: marked's startBlock ---------------------------------------

/**
 * Where the next table begins in the paragraph that starts at `src`.
 *
 * marked calls this with the paragraph's source without its first character and cuts
 * the paragraph before the returned offset, so that the table rule gets the lines from
 * there (spec 2.3: a table may begin on any line of a paragraph). The lines are read up
 * to the first blank line, and the core decides where the first table begins: delimiter
 * rows are tried from the top.
 */
function tableStart(this: TokenizerThis, src: string): number | undefined {
  // Only paragraphs are cut. Elsewhere, as in tight list items, marked reads text one
  // line at a time and tries the table rule on each line.
  if (!this.lexer.state.top) return undefined;
  const { lines, offsets } = blockLines(src);
  // The first line lacks its first character. A placeholder keeps it a paragraph line
  // that is no header row: if the real line was one, the table rule rejects a table
  // directly below it.
  lines[0] = "\0" + lines[0];
  let result = parseTable(lines);
  let shift = 0;
  if (result.table !== null && result.start === 0) {
    // The table rule declined a table here (see tokenizeTable); look below this line.
    result = parseTable(lines.slice(1));
    shift = 1;
  }
  let cut = result.table === null ? Infinity : offsets[result.start + shift];

  // In GFM mode, marked's paragraph rule ends a paragraph before two lines that look
  // like a GFM header and delimiter row, even where LTEM finds no table, and the lines
  // from there would become a second paragraph. A cut there makes marked join that
  // paragraph back to this one, as it does after every cut: lines that are no table
  // stay in the paragraph (spec 2.3).
  const rules = this.lexer.options.tokenizer?.rules;
  const block = lines.join("\n"); // one character longer than src at the start
  const paragraph = rules?.block.paragraph.exec(block)?.[0];
  if (paragraph !== undefined && paragraph.length < block.length
      && rules!.block.table.exec(block.slice(paragraph.length + 1))) {
    cut = Math.min(cut, paragraph.length);
  }
  return cut === Infinity ? undefined : cut;
}

// -- the block tokenizer ---------------------------------------------------------------------

function tokenizeTable(
  self: TokenizerThis, src: string, tokens: Token[], nativeTables: boolean,
): Tokens.Table | LtemTableToken | undefined {
  const first = src.slice(0, lineEnd(src, 0));
  if (isBlank(first) || indentation(first) >= 4) return undefined;
  // A pipe-led line directly above, in the same paragraph, would be a header row of any
  // table here, so no table begins on this line (spec 2.3). Not so if this line looks
  // like a delimiter row: as a last header row it stands alone.
  const previous = tokens.at(-1);
  if ((previous?.type === "paragraph" || previous?.type === "text") && isUpperHeaderRow(lastLine(previous.raw))
      && !isDelimiterRow(first)) return undefined;

  // Header rows: pipe-led lines down to the line above the first delimiter row (spec 2.3).
  const lines = [first];
  let pos = first.length + 1;
  for (;;) {
    if (pos > src.length) return undefined;
    const line = src.slice(pos, lineEnd(src, pos));
    if (isBlank(line)) return undefined;
    const above = lines[lines.length - 1];
    lines.push(line);
    pos += line.length + 1;
    if (isDelimiterRow(line)) {
      // The last header row is a paragraph line, as in GFM: not the start of another block.
      if (startsBlock(above)) return undefined;
      break;
    }
    if (!isUpperHeaderRow(above)) return undefined;
  }
  // Body rows: until a line that ends the table (spec 2.4) or that interrupts a paragraph
  // in marked, such as the start of an HTML block.
  const paragraph = self.lexer.options.tokenizer?.rules.block.paragraph;
  while (pos <= src.length) {
    const line = src.slice(pos, lineEnd(src, pos));
    if (endsTableBody(line) || (paragraph !== undefined && interruptsParagraph(paragraph, line))) break;
    lines.push(line);
    pos += line.length + 1;
  }

  const result = parseTable(lines);
  // No table here, for example if the last header row does not fit (spec 2.3).
  if (result.table === null || result.start !== 0 || result.end !== lines.length) return undefined;
  const raw = lines.join("\n");
  return nativeTables && !needsLtem(result.table)
    ? nativeTable(self, raw, result.table)
    : ltemTable(self, raw, lines, result.table, result.sources);
}

/** Whether marked's paragraph rule stops before `line`. */
function interruptsParagraph(paragraph: RegExp, line: string): boolean {
  return paragraph.exec("x\n" + line)?.[0] === "x";
}

/** Whether a table needs more than marked's table token holds. */
function needsLtem(table: Table): boolean {
  return table.header_rows > 1
    || table.cells.some((cell) => cell.rowspan > 1 || cell.colspan > 1 || cell.text.includes("\n"));
}

function nativeTable(self: TokenizerThis, raw: string, table: Table): Tokens.Table {
  const cell = (r: number, c: number): Tokens.TableCell => {
    const text = table.cells[r * table.cols + c].text;
    return { text, tokens: self.lexer.inline(text), header: r === 0, align: table.align[c] };
  };
  const row = (r: number): Tokens.TableCell[] => Array.from({ length: table.cols }, (_, c) => cell(r, c));
  return {
    type: "table",
    raw,
    align: table.align,
    header: row(0),
    rows: Array.from({ length: table.rows - 1 }, (_, r) => row(r + 1)),
  };
}

/** Token arrays of cells with several lines, whose lines after the first begin with "\n". */
const multiLineCells = new WeakSet<Token[]>();

function ltemTable(
  self: TokenizerThis, raw: string, lines: string[], table: Table, sources: CellSource[],
): LtemTableToken {
  const rows: LtemTableCell[][] = Array.from({ length: table.rows }, () => []);
  table.cells.forEach((cell, i) => {
    const source = sources[i];
    // Each line of a cell is lexed on its own (spec 4.2), into the cell's token array.
    // marked lexes inlines after the blocks, in order; ltemLineBreak turns the "\n" at
    // the start of each later line into a br token.
    const [line, ...more] = cell.text.split("\n");
    const tokens = self.lexer.inline(line);
    for (const next of more) self.lexer.inline("\n" + next, tokens);
    if (more.length) multiLineCells.add(tokens);
    rows[cell.row].push({
      type: "ltemTableCell",
      raw: lines[source.line].slice(source.start, source.end),
      text: cell.text,
      tokens,
      header: cell.row < table.header_rows,
      align: table.align[cell.col],
      row: cell.row,
      col: cell.col,
      rowspan: cell.rowspan,
      colspan: cell.colspan,
    });
  });
  return {
    type: "ltemTable",
    raw,
    align: table.align,
    header: rows.slice(0, table.header_rows),
    rows: rows.slice(table.header_rows),
  };
}

// -- the inline tokenizer -----------------------------------------------------------------

/** The line break between two lines of an LTEM cell (see ltemTable). */
function lineBreak(this: TokenizerThis, src: string, tokens: Token[]): Tokens.Br | undefined {
  return src.startsWith("\n") && multiLineCells.has(tokens) ? { type: "br", raw: "\n" } : undefined;
}

// -- the renderer -----------------------------------------------------------------------------

/** HTML in the format of marked's table renderer, with colspan and rowspan. */
function renderTable(this: RendererThis, token: Tokens.Generic): string {
  const table = token as LtemTableToken;
  const row = (cells: LtemTableCell[]): string => {
    let html = "<tr>\n";
    for (const cell of cells) {
      const tag = cell.header ? "th" : "td";
      let attrs = "";
      if (cell.colspan > 1) attrs += ` colspan="${cell.colspan}"`;
      if (cell.rowspan > 1) attrs += ` rowspan="${cell.rowspan}"`;
      if (cell.align) attrs += ` align="${cell.align}"`;
      html += `<${tag}${attrs}>${this.parser.parseInline(cell.tokens)}</${tag}>\n`;
    }
    return html + "</tr>\n";
  };
  let html = "<table>\n<thead>\n" + table.header.map(row).join("") + "</thead>\n";
  if (table.rows.length) html += "<tbody>" + table.rows.map(row).join("") + "</tbody>";
  return html + "</table>\n";
}
