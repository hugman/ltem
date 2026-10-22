/**
 * markdown-it plugin for LTEM tables.
 *
 * ```ts
 * import markdownit from "markdown-it";
 * import ltem from "markdown-it-ltem";
 *
 * const md = markdownit("commonmark").use(ltem);
 * const html = md.render(text);
 * ```
 *
 * The plugin replaces markdown-it's GFM table rule. A table without LTEM notation
 * renders as before; LTEM tables get colspan, rowspan and several header rows.
 *
 * @packageDocumentation
 */

import {
  endsTableBody, isDelimiterRow, isUpperHeaderRow, parseTable, startsBlock, type CellSource, type Table,
} from "ltem-core";

// Minimal structural types for the parts of markdown-it this plugin uses. They match
// markdown-it 14 and 15 without importing either version's type definitions.

interface Token {
  type: string;
  attrs: [string, string | number][] | null;
  map: [number, number] | null;
  level: number;
  children: Token[] | null;
  content: string;
  meta: unknown;
}

interface TokenConstructor {
  new (type: string, tag: string, nesting: -1 | 0 | 1): Token;
}

type BlockRule = (state: StateBlock, startLine: number, endLine: number, silent: boolean) => boolean;

interface StateBlock {
  src: string;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  sCount: number[];
  blkIndent: number;
  line: number;
  parentType: string;
  md: { block: { ruler: { getRules(chainName: string): BlockRule[] } } };
  push(type: string, tag: string, nesting: -1 | 0 | 1): Token;
  isEmpty(line: number): boolean;
}

interface StateCore {
  tokens: Token[];
  Token: TokenConstructor;
}

// Rule functions are typed differently by markdown-it 14 (@types) and 15, so the ruler
// methods take them as `never` and the plugin's rules are cast when they are added.
interface Ruler {
  at(name: string, fn: never, options?: { alt?: string[] }): void;
  before(beforeName: string, ruleName: string, fn: never, options?: { alt?: string[] }): void;
  after(afterName: string, ruleName: string, fn: never, options?: { alt?: string[] }): void;
  enable(list: string | string[], ignoreInvalid?: boolean): string[];
}

/**
 * Where a cell is in the document, set as `meta.ltem` on its `th_open` or `td_open`
 * token. `line` is the document line of the cell's origin (counting from 0, like token
 * maps). `start` and `end` are UTF-16 offsets (JavaScript string indices) in that line of
 * markdown-it's source, counted from the line's first character, so a container prefix
 * such as "> " shifts them. They cover the cell's source without the spaces and tabs
 * around it, including any span attribute and escapes; an empty cell has start == end.
 */
export interface LtemCellPosition {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
  line: number;
  start: number;
  end: number;
}

/** The parts of a markdown-it instance that the plugin uses. */
export interface MarkdownItLike {
  block: { ruler: Ruler };
  core: { ruler: Ruler };
}

const ALT = ["paragraph", "reference"];

/** Replace the table rule of `md` with the LTEM table rule and enable it. */
export default function ltem(md: MarkdownItLike): void {
  const rule = ltemTable as never;
  try {
    md.block.ruler.at("table", rule, { alt: ALT });
  } catch {
    // The preset has no table rule; tables are tried before indented code, as in markdown-it.
    md.block.ruler.before("code", "table", rule, { alt: ALT });
  }
  md.block.ruler.enable("table");
  md.core.ruler.before("inline", "ltem_split_lines", splitCellLines as never);
  md.core.ruler.after("inline", "ltem_join_lines", joinCellLines as never);
}

export { ltem };

// -- the block rule --------------------------------------------------------------------

/** Line n as the LTEM core reads it: indentation relative to the block, then the text. */
function lineText(state: StateBlock, n: number): string {
  const indent = Math.max(0, state.sCount[n] - state.blkIndent);
  return " ".repeat(indent) + state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
}

/** Whether line n can belong to a table: not blank and inside the current container. */
function usable(state: StateBlock, n: number, endLine: number): boolean {
  return n < endLine && !state.isEmpty(n) && state.sCount[n] >= state.blkIndent;
}

function isCodeIndented(state: StateBlock, n: number): boolean {
  return state.sCount[n] - state.blkIndent >= 4;
}

/** Index of the first delimiter row if a table's header rows start at `start` (spec 2.3), else -1. */
function findDelimiter(state: StateBlock, start: number, endLine: number): number {
  for (let n = start; usable(state, n, endLine) && usable(state, n + 1, endLine); n++) {
    // Line n is the last header row: a paragraph line, as in GFM (spec 2.3), so not the start
    // of another block. isDelimiterRow rejects a delimiter row indented as code.
    if (isDelimiterRow(lineText(state, n + 1))) return startsBlock(lineText(state, n)) ? -1 : n + 1;
    // Header rows above the last one begin with a pipe, are not reserved and do not look
    // like a delimiter row (spec 2.3, 9).
    if (!isUpperHeaderRow(lineText(state, n))) return -1;
  }
  return -1;
}

/** Whether a body row ends before line n (spec 2.4), by the core's rules or markdown-it's. */
function endsBody(state: StateBlock, n: number, endLine: number, terminators: BlockRule[]): boolean {
  if (!usable(state, n, endLine) || isCodeIndented(state, n)) return true;
  if (endsTableBody(lineText(state, n))) return true;
  return terminators.some((rule) => rule(state, n, endLine, true));
}

function ltemTable(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (isCodeIndented(state, startLine)) return false;
  // Called to end a paragraph at startLine: if the line above is a pipe-led line of the
  // same paragraph, it would be a header row of any table here, so no table starts at
  // startLine (spec 2.3). Not so if startLine looks like a delimiter row: as a last
  // header row it stands alone.
  if (silent && startLine > 0 && isUpperHeaderRow(lineText(state, startLine - 1))
      && !isDelimiterRow(lineText(state, startLine))) return false;

  const delimiter = findDelimiter(state, startLine, endLine);
  if (delimiter < 0) return false;

  let stop = delimiter + 1;
  if (!silent) {
    // Body rows run until a blank line or a line that starts another block.
    const terminators = state.md.block.ruler.getRules("blockquote");
    const oldParentType = state.parentType;
    state.parentType = "table";
    while (!endsBody(state, stop, endLine, terminators)) stop++;
    state.parentType = oldParentType;
  }

  const lines: string[] = [];
  for (let n = startLine; n < stop; n++) lines.push(lineText(state, n));
  const result = parseTable(lines);
  // No table here, for example if the last header row does not fit (spec 2.3).
  if (result.table === null || result.start !== 0 || result.end !== lines.length) return false;
  if (silent) return true;

  emitTable(state, result.table, result.sources, startLine, delimiter, stop);
  state.line = stop;
  return true;
}

// -- tokens ----------------------------------------------------------------------------

/** The lines of each cell's inline token whose text has more than one line (spec 4.2). */
const cellLines = new WeakMap<Token, string[]>();
/** The cell token that each per-line inline token belongs to, while inlines are parsed. */
const lineOwner = new WeakMap<Token, Token>();

/**
 * The offset in document line n of markdown-it's source for offset i of `lineText(n)`,
 * which replaces the container prefix and indentation by spaces.
 */
function documentOffset(state: StateBlock, n: number, i: number): number {
  const lineStart = state.src.lastIndexOf("\n", state.bMarks[n] - 1) + 1;
  const indent = Math.max(0, state.sCount[n] - state.blkIndent);
  const textStart = state.bMarks[n] + state.tShift[n];
  return textStart + Math.max(0, i - indent) - lineStart;
}

function emitTable(
  state: StateBlock, table: Table, sources: CellSource[], start: number, delimiter: number, stop: number,
): void {
  const byRow = new Map<number, number[]>(); // indices into table.cells and sources
  table.cells.forEach((cell, i) => {
    const row = byRow.get(cell.row);
    if (row) row.push(i);
    else byRow.set(cell.row, [i]);
  });
  // Source line of each grid row: header rows, then (after the delimiter) body rows.
  const sourceLine = (r: number): number => (r < table.header_rows ? start + r : start + r + 1);

  const emitRow = (r: number): void => {
    const tag = r < table.header_rows ? "th" : "td";
    const line = sourceLine(r);
    state.push("tr_open", "tr", 1).map = [line, line + 1];
    for (const i of byRow.get(r) ?? []) {
      const cell = table.cells[i];
      const source = sources[i];
      const open = state.push(`${tag}_open`, tag, 1);
      open.map = [line, line + 1];
      const position: LtemCellPosition = {
        row: cell.row, col: cell.col, rowspan: cell.rowspan, colspan: cell.colspan, line,
        start: documentOffset(state, start + source.line, source.start),
        end: documentOffset(state, start + source.line, source.end),
      };
      open.meta = { ltem: position };
      const attrs: [string, string][] = [];
      if (cell.colspan > 1) attrs.push(["colspan", String(cell.colspan)]);
      if (cell.rowspan > 1) attrs.push(["rowspan", String(cell.rowspan)]);
      const align = table.align[cell.col];
      if (align) attrs.push(["style", `text-align:${align}`]);
      if (attrs.length) open.attrs = attrs;

      const lines = cell.text.split("\n");
      const inline = state.push("inline", "", 0);
      // A backslash before a line end is a hard break (spec 4.2: lines join with <br />).
      inline.content = lines.join("\\\n");
      inline.map = [line, line + 1];
      inline.children = [];
      if (lines.length > 1) cellLines.set(inline, lines);
      state.push(`${tag}_close`, tag, -1);
    }
    state.push("tr_close", "tr", -1);
  };

  state.push("table_open", "table", 1).map = [start, stop];
  state.push("thead_open", "thead", 1).map = [start, delimiter];
  for (let r = 0; r < table.header_rows; r++) emitRow(r);
  state.push("thead_close", "thead", -1);
  if (table.rows > table.header_rows) {
    state.push("tbody_open", "tbody", 1).map = [delimiter + 1, stop];
    for (let r = table.header_rows; r < table.rows; r++) emitRow(r);
    state.push("tbody_close", "tbody", -1);
  }
  state.push("table_close", "table", -1);
}

// -- line breaks in cells (spec 4.2) -----------------------------------------------------
//
// Each line of a cell is parsed as inlines on its own, so that emphasis or a code span
// cannot run across a `\\` line break. Just before markdown-it's "inline" core rule, a
// cell's inline token is replaced by one inline token per line; just after it, the
// lines' children are joined back into the cell's token with hard breaks between them.
// Every other core rule sees one inline token per cell.

function replaceTokens(state: StateCore, map: (token: Token, out: Token[]) => void): void {
  const out: Token[] = [];
  for (const token of state.tokens) map(token, out);
  state.tokens.length = 0;
  for (const token of out) state.tokens.push(token);
}

function splitCellLines(state: StateCore): void {
  if (!state.tokens.some((token) => cellLines.has(token))) return;
  replaceTokens(state, (token, out) => {
    const lines = cellLines.get(token);
    if (!lines) {
      out.push(token);
      return;
    }
    for (const line of lines) {
      const part = new state.Token("inline", "", 0);
      part.content = line;
      part.map = token.map;
      part.level = token.level;
      part.children = [];
      lineOwner.set(part, token);
      out.push(part);
    }
  });
}

function joinCellLines(state: StateCore): void {
  if (!state.tokens.some((token) => lineOwner.has(token))) return;
  replaceTokens(state, (token, out) => {
    const owner = lineOwner.get(token);
    if (!owner) {
      out.push(token);
      return;
    }
    const children = owner.children ?? [];
    if (out[out.length - 1] === owner) {
      children.push(new state.Token("hardbreak", "br", 0));
    } else {
      children.length = 0;
      out.push(owner);
    }
    for (const child of token.children ?? []) children.push(child);
    owner.children = children;
  });
}
