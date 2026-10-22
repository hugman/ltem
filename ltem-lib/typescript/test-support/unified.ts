/** Shared support for the tests of the micromark, mdast and remark packages. */

/**
 * micromark's block constructs. A micromark extension that turns them off makes any
 * single line a paragraph, so that a line of cell text is parsed as inlines only.
 */
export const BLOCK_CONSTRUCTS = ["blockQuote", "codeFenced", "codeIndented", "definition", "headingAtx", "htmlFlow",
  "list", "setextUnderline", "thematicBreak", "ltemTable"];

/** The inline HTML of a document that is one paragraph: without `<p>` and `</p>`. */
export function paragraphContent(html: string): string {
  return html.replace(/^<p>/, "").replace(/<\/p>\n?$/, "");
}
