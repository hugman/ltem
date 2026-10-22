/** Finding the LTEM tables of an editor state and the cell at a position. */

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import { analyzeTable, cellAtOffset, deriveAnalysis, type SourceCell, type SourceRow, type TableAnalysis } from "./analysis.js";
import { TextCache } from "./cache.js";
import { NODE, holdsTables } from "./syntax.js";

/** An LTEM table of the document. */
export interface LtemTableInfo {
  /** Document range of the table, from its first header row to its last body row. */
  from: number;
  to: number;
  /** Document position where each of the table's lines starts (after any container prefix). */
  lineStarts: number[];
  analysis: TableAnalysis;
  /** The syntax node of the table. */
  node: SyntaxNode;
}

/** The cell at a position: its source row and cell, and the document range of the cell's text. */
export interface LtemCellInfo {
  table: LtemTableInfo;
  row: SourceRow;
  cell: SourceCell;
  /** Index of the cell in its row's source. */
  index: number;
}

// An analysis takes some 30 times the memory of the table's text, so the cache is bounded by
// the text it holds (about 60 MB at most) as well as by its number of tables.
const cache = new TextCache<TableAnalysis | null>(256, 2_000_000);

// The tables analysed last. A table typed in or lined up differs little from one of them,
// and its analysis is derived from that one's when it can be (`deriveAnalysis`).
const recent: TableAnalysis[] = [];

function analyzeCached(lines: string[]): TableAnalysis | null {
  const key = lines.join("\n");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const analysis = analyzeFrom(lines) ?? analyzeTable(lines);
  cache.set(key, analysis);
  if (analysis) {
    recent.unshift(analysis);
    if (recent.length > 4) recent.pop();
  }
  return analysis;
}

function analyzeFrom(lines: string[]): TableAnalysis | null {
  for (const old of recent) {
    if (old.lines.length !== lines.length || old.lines[0].length === 0) continue;
    const derived = deriveAnalysis(old, lines);
    if (derived) return derived;
  }
  return null;
}

/** The table described by a table syntax node. */
export function tableFromNode(state: EditorState, node: SyntaxNode): LtemTableInfo | null {
  const lines: string[] = [];
  const lineStarts: number[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === NODE.headerRow || child.name === NODE.delimiterRow || child.name === NODE.row) {
      lines.push(state.doc.sliceString(child.from, child.to));
      lineStarts.push(child.from);
    }
  }
  const analysis = analyzeCached(lines);
  return analysis ? { from: node.from, to: node.to, lineStarts, analysis, node } : null;
}

/** The LTEM table that contains `pos`, if any. */
export function tableAt(state: EditorState, pos: number): LtemTableInfo | null {
  const tree = syntaxTree(state);
  for (const side of [-1, 1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name === NODE.table) return tableFromNode(state, node);
    }
  }
  return null;
}

/** The LTEM tables that overlap a range of the document. */
export function tablesIn(state: EditorState, from = 0, to = state.doc.length): LtemTableInfo[] {
  const out: LtemTableInfo[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== NODE.table) return holdsTables(node.type);
      const table = tableFromNode(state, node.node);
      if (table) out.push(table);
      return false;
    },
  });
  return out;
}

/** The cell of a table that contains `pos` (between the pipes around it), if any. */
export function cellAt(table: LtemTableInfo, pos: number): LtemCellInfo | null {
  for (const row of table.analysis.rows) {
    const start = table.lineStarts[row.line];
    const end = start + table.analysis.lines[row.line].length;
    if (pos < start || pos > end) continue;
    let cell = cellAtOffset(row, pos - start);
    // Before the first pipe or after the last one: the nearest cell of the row.
    if (!cell && row.cells.length) cell = pos - start < row.bounds[0].from ? row.cells[0] : row.cells[row.cells.length - 1];
    if (!cell) return null;
    return { table, row, cell, index: row.cells.indexOf(cell) };
  }
  return null;
}
