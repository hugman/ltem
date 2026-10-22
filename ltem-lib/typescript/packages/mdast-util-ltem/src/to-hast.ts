/** From mdast to hast: LTEM tables as HTML tables (spec Section 6), for remark-rehype. */

import type { Element, ElementContent, Properties } from "hast";
import type { Table } from "mdast";
import type { Handler, Handlers, State } from "mdast-util-to-hast";

import { layout } from "./grid.js";

/**
 * The `table` handler of mdast-util-to-hast for LTEM tables.
 *
 * It puts all header rows in `<thead>` with `<th>` cells and the body rows in `<tbody>`,
 * gives cells `colSpan` and `rowSpan` above 1 and the alignment of their origin column,
 * and leaves out the positions that merged cells cover. A table without LTEM fields comes
 * out as with mdast-util-to-hast's own handler.
 */
export const ltemTableHandler: Handler = (state: State, node: Table): Element => {
  const grid = layout(node);
  const element = (tagName: string, children: ElementContent[], properties: Properties = {}): Element =>
    ({ type: "element", tagName, properties, children });

  const rows = node.children.map((row, r) => {
    const tagName = r < grid.headerRows ? "th" : "td";
    const properties = (col: number, rowspan = 1, colspan = 1): Properties => {
      const result: Properties = {};
      if (colspan > 1) result.colSpan = colspan;
      if (rowspan > 1) result.rowSpan = rowspan;
      const align = node.align?.[col];
      if (align) result.align = align;
      return result;
    };
    const cells = grid.rows[r].map((cell) => {
      const td = element(tagName, state.all(cell.node), properties(cell.col, cell.rowspan, cell.colspan));
      state.patch(cell.node, td);
      return state.applyData(cell.node, td);
    });
    // Positions that no cell covers get empty cells, as a short GFM row does.
    for (const col of grid.holes[r]) cells.push(element(tagName, [], properties(col)));
    const tr = element("tr", state.wrap(cells, true));
    state.patch(row, tr);
    return state.applyData(row, tr);
  });

  const group = (tagName: string, from: number, to: number): Element => {
    const result = element(tagName, state.wrap(rows.slice(from, to), true));
    const start = node.children[from]?.position?.start;
    const end = node.children[to - 1]?.position?.end;
    if (start && end) result.position = { start, end };
    return result;
  };
  const content = [group("thead", 0, grid.headerRows)];
  if (rows.length > grid.headerRows) content.push(group("tbody", grid.headerRows, rows.length));
  const result = element("table", state.wrap(content, true));
  state.patch(node, result);
  return state.applyData(node, result);
};

/** Handlers for mdast-util-to-hast, to pass to remark-rehype as `handlers`. */
export const ltemHandlers: Handlers = { table: ltemTableHandler };
