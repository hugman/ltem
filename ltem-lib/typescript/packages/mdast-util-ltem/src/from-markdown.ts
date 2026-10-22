/** From micromark tokens to mdast: LTEM tables as table, tableRow and tableCell nodes. */

import type { AlignType, Nodes, TableCell, TableRow } from "mdast";
import type { CompileContext, Extension, Token } from "mdast-util-from-markdown";

/** What micromark-extension-ltem sets on its `ltemTable`, `ltemTableRow` and `ltemTableCell` tokens. */
interface LtemFields {
  _ltemTable?: { align: AlignType[]; headerRows: number };
  _ltemCell?: CellFields;
  _ltemPadding?: CellFields[];
}

interface CellFields {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

function fields(token: Token): LtemFields {
  return token as unknown as LtemFields;
}

/**
 * The mdast-util-from-markdown extension for LTEM tables, for use with the micromark
 * syntax extension of micromark-extension-ltem.
 *
 * A table is a `table` node with `align` and `headerRows`; its rows are `tableRow` nodes,
 * header rows first; each row holds the cells whose origin is in it, as `tableCell` nodes
 * with `row`, `col`, `rowspan` and `colspan`. A line break in a cell is a `break` node.
 * Positions are those of the source: a cell covers its source without the spaces around
 * it, including a span attribute; an empty cell added to a short row (rule V14) is an
 * empty range at the end of its row.
 */
export function ltemFromMarkdown(): Extension {
  return {
    enter: {
      ltemTable(token) {
        const { align, headerRows } = fields(token)._ltemTable!;
        this.enter({ type: "table", align: [...align], headerRows, children: [] }, token);
      },
      ltemTableRow(token) {
        this.enter({ type: "tableRow", children: [] }, token);
      },
      ltemTableCell(token) {
        const { row, col, rowspan, colspan } = fields(token)._ltemCell!;
        this.enter({ type: "tableCell", row, col, rowspan, colspan, children: [] }, token);
      },
      ltemTableLineBreak(token) {
        this.enter({ type: "break" }, token);
      },
    },
    exit: {
      ltemTable: exit,
      ltemTableRow(token) {
        const row = this.stack[this.stack.length - 1] as TableRow;
        const { line, column, offset } = token.end;
        for (const { row: r, col, rowspan, colspan } of fields(token)._ltemPadding ?? []) {
          row.children.push({
            type: "tableCell", row: r, col, rowspan, colspan, children: [],
            position: { start: { line, column, offset }, end: { line, column, offset } },
          });
        }
        this.exit(token);
      },
      ltemTableCell(token) {
        const cell = this.stack[this.stack.length - 1] as TableCell;
        // A cell without content has nothing to unescape, and may have an empty source.
        if (cell.children.length) unescapePipes(cell, this.sliceSerialize(token), token.start.offset);
        this.exit(token);
      },
      ltemTableLineBreak: exit,
    },
  };
}

function exit(this: CompileContext, token: Token): undefined {
  this.exit(token);
}

/**
 * Remove the backslash before each pipe in code, math, raw HTML and autolinks of a cell.
 *
 * The backslash that escapes a pipe is not part of the cell text (spec 2.1), but these
 * keep their source as written. Every pipe in a cell's source is escaped, so each
 * backslash before a pipe in them is such a backslash. `source` is the cell's source,
 * which starts at `offset` in the document.
 */
function unescapePipes(node: Nodes, source: string, offset: number): void {
  const unescape = (value: string): string => value.replaceAll("\\|", "|");
  if ((node.type === "inlineCode" || node.type === "html" || (node.type as string) === "inlineMath")
      && "value" in node) {
    node.value = unescape(node.value);
    // mdast-util-math keeps the value for hast too.
    for (const child of node.data?.hChildren ?? []) if (child.type === "text") child.value = unescape(child.value);
    return;
  }
  if (node.type === "link" && source[node.position!.start.offset! - offset] === "<") {
    node.url = unescape(node.url); // an autolink: its text is its address
    for (const child of node.children) if (child.type === "text") child.value = unescape(child.value);
    return;
  }
  if ("children" in node) for (const child of node.children) unescapePipes(child, source, offset);
}
