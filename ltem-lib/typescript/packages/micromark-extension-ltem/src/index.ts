/**
 * micromark extension for LTEM tables.
 *
 * ```ts
 * import { micromark } from "micromark";
 * import { ltem, ltemHtml } from "micromark-extension-ltem";
 *
 * const html = micromark(text, { extensions: [ltem()], htmlExtensions: [ltemHtml()] });
 * ```
 *
 * The syntax extension replaces micromark's GFM table construct. A table without LTEM
 * notation reads as before; LTEM tables get merged cells and several header rows.
 *
 * @packageDocumentation
 */

export { ltemHtml } from "./html.js";
export { ltem, type LtemCellInfo, type LtemTableInfo } from "./syntax.js";
