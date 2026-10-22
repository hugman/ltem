/** From mdast to Markdown: tables in LTEM's canonical form (spec Section 8). */

import { write, type Cell } from "ltem-core";
import type { Parents, PhrasingContent, Table, TableCell } from "mdast";
import type { Info, Options, State } from "mdast-util-to-markdown";

import { layout } from "./grid.js";

declare module "mdast-util-to-markdown" {
  interface ConstructNameMap {
    /** A table written by mdast-util-ltem. */
    ltemTable: "ltemTable";
    /** A line of a table cell written by mdast-util-ltem. */
    ltemTableCell: "ltemTableCell";
  }
}

/**
 * The mdast-util-to-markdown extension for LTEM tables.
 *
 * Every `table` node is written in LTEM's canonical form with the core's writer: grid rows,
 * `^^` and `<<` for merged positions, all header rows above the delimiter row, and ` \\ `
 * between the lines of a cell. Where cells overlap or reach past the table, their spans
 * are cut, so that the output is always a valid table.
 */
export function ltemToMarkdown(): Options {
  return {
    unsafe: [
      { character: "\r", inConstruct: "ltemTableCell" },
      { character: "\n", inConstruct: "ltemTableCell" },
      // A line that looks like a delimiter row would turn the paragraph above into a table.
      { atBreak: true, character: "|", after: "[\t :-]" },
      { atBreak: true, character: ":", after: "-" },
      { atBreak: true, character: "-", after: "[:|-]" },
    ],
    handlers: { table: handleTable },
  };
}

function handleTable(node: Table, _: Parents | undefined, state: State, info: Info): string {
  if (!node.children.length) return ""; // LTEM has no table without rows
  const grid = layout(node);
  const exit = state.enter("ltemTable");
  const cells: Cell[] = [];
  grid.rows.forEach((row, r) => {
    for (const { node: cell, col, rowspan, colspan } of row) {
      cells.push({ row: r, col, rowspan, colspan, text: cellText(cell, state, info) });
    }
    for (const col of grid.holes[r]) cells.push({ row: r, col, rowspan: 1, colspan: 1, text: "" });
  });
  exit();
  cells.sort((a, b) => a.row - b.row || a.col - b.col);
  return write({
    version: "1.0",
    rows: node.children.length,
    cols: grid.cols,
    header_rows: grid.headerRows,
    align: Array.from({ length: grid.cols }, (_, c) => node.align?.[c] ?? null),
    cells,
  });
}

/** The cell text of the table model: one line per line between `break` nodes. */
function cellText(cell: TableCell, state: State, info: Info): string {
  const lines: PhrasingContent[][] = [[]];
  for (const child of cell.children) {
    if (child.type === "break") lines.push([]);
    else lines[lines.length - 1].push(child);
  }
  const exit = state.enter("ltemTableCell");
  const exitPhrasing = state.enter("phrasing");
  const text = lines.map((children) => lineText(cell, children, state, info)).join("\n");
  exitPhrasing();
  exit();
  return text;
}

/**
 * One line of cell text, as inline Markdown.
 *
 * The cell text cannot hold two backslashes in a row, which LTEM reads as a line break
 * (spec 4.2, Appendix B): an escaped backslash in text is written `&#92;`, and code, math
 * or raw HTML that holds two backslashes is written as text. Pipes are not escaped here;
 * the core's writer escapes every pipe, as it does `<<`, `^^` and span attributes.
 */
function lineText(cell: TableCell, children: PhrasingContent[], state: State, info: Info): string {
  // Code, math and raw HTML are written as they are. While the text around them is
  // escaped, they are stand-ins: a number between two of a private-use character that the
  // line does not hold.
  const verbatim: string[] = [];
  const used = JSON.stringify(children);
  let code = 0xe000;
  while (used.includes(String.fromCharCode(code))) code++;
  const mark = String.fromCharCode(code);
  const prepare = (node: PhrasingContent, parent: Parents): PhrasingContent => {
    if (node.type === "break") return { type: "text", value: " " }; // a line break inside markup
    if ("children" in node) {
      const copy = { ...node, children: [] as PhrasingContent[] };
      copy.children = node.children.map((child) => prepare(child, node));
      return copy as PhrasingContent;
    }
    if (node.type === "text" || !("value" in node) || typeof node.value !== "string") return node;
    if (node.value.includes("\\\\")) return { type: "text", value: node.value };
    verbatim.push(state.handle(node, parent, state, { ...info, before: " ", after: " " }));
    return { type: "text", value: mark + (verbatim.length - 1) + mark };
  };
  const line = { type: "paragraph" as const, children: children.map((child) => prepare(child, cell)) };
  return state.containerPhrasing(line, { ...info, before: " ", after: " " })
    .replace(/\\(.)/g, (escape, char: string) => (char === "\\" ? "&#92;" : char === "|" ? "|" : escape))
    .replace(new RegExp(`${mark}(\\d+)${mark}`, "g"), (_, index: string) => verbatim[Number(index)]);
}
