/**
 * remark plugin for LTEM tables.
 *
 * ```ts
 * import rehypeStringify from "rehype-stringify";
 * import remarkLtem, { ltemHandlers } from "remark-ltem";
 * import remarkParse from "remark-parse";
 * import remarkRehype from "remark-rehype";
 * import { unified } from "unified";
 *
 * const html = String(await unified()
 *   .use(remarkParse)
 *   .use(remarkLtem)
 *   .use(remarkRehype, { handlers: ltemHandlers })
 *   .use(rehypeStringify)
 *   .process(text));
 * ```
 *
 * The plugin replaces the GFM table syntax, also when remark-gfm is used. A table without
 * LTEM notation reads as before; LTEM tables get merged cells and several header rows.
 *
 * @packageDocumentation
 */

import { ltemFromMarkdown, ltemToMarkdown } from "mdast-util-ltem";
import { ltem } from "micromark-extension-ltem";
import type {} from "remark-parse";
import type {} from "remark-stringify";
import type { Processor } from "unified";

/** Add LTEM tables to remark: parsing to mdast and writing Markdown. */
export default function remarkLtem(this: Processor): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(ltem());
  (data.fromMarkdownExtensions ??= []).push(ltemFromMarkdown());
  (data.toMarkdownExtensions ??= []).push(ltemToMarkdown());
}

export { remarkLtem };
export { ltemHandlers } from "mdast-util-ltem";
