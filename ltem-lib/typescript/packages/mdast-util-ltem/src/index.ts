/**
 * mdast utilities for LTEM tables: from Markdown, to Markdown and to hast.
 *
 * ```ts
 * import { fromMarkdown } from "mdast-util-from-markdown";
 * import { toHast } from "mdast-util-to-hast";
 * import { ltem } from "micromark-extension-ltem";
 * import { ltemFromMarkdown, ltemHandlers } from "mdast-util-ltem";
 *
 * const tree = fromMarkdown(text, { extensions: [ltem()], mdastExtensions: [ltemFromMarkdown()] });
 * const hast = toHast(tree, { handlers: ltemHandlers });
 * ```
 *
 * @packageDocumentation
 */

export { ltemFromMarkdown } from "./from-markdown.js";
export { ltemHandlers, ltemTableHandler } from "./to-hast.js";
export { ltemToMarkdown } from "./to-markdown.js";

// LTEM's fields on mdast table nodes.
declare module "mdast" {
  interface Table {
    /**
     * Number of header rows: the first children of the table (LTEM spec 2.3). An LTEM
     * table has one or more; without the field, a table has one, as in GFM.
     */
    headerRows?: number | undefined;
  }

  interface TableCell {
    /** Grid row of the cell's origin, counting header and body rows together from 0. */
    row?: number | undefined;
    /** Grid column of the cell's origin, from 0. */
    col?: number | undefined;
    /** Number of rows the cell spans; 1 without the field. */
    rowspan?: number | undefined;
    /** Number of columns the cell spans; 1 without the field. */
    colspan?: number | undefined;
  }
}
