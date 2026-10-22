/**
 * Markdown as markdown-it reads it without plugins, where CodeMirror's Markdown reads it
 * otherwise: no subscript, superscript or emoji shortcodes; strikethrough in runs of tildes
 * as markdown-it splits them; bare links as its linkify finds them (see linkify.ts). And
 * highlights (`==text==`) as markdown-it-mark reads them, to turn on with that plugin.
 */

import { Tag, tags } from "@lezer/highlight";
import type { DelimiterType, InlineContext, InlineParser, MarkdownConfig } from "@lezer/markdown";

import { linkifySyntax } from "./linkify.js";

// Unicode punctuation and symbols, as markdown-it (CommonMark 0.31) counts them.
const Punctuation = /[\p{S}\p{P}]/u;
const WhiteSpace = /^[\t\n\v\f\r \xA0\u1680\u2000-\u200A\u202F\u205F\u3000]$/;

/** The pairs of marks added so far in a run of inline content, by type, with how they can match. */
const added = new WeakMap<InlineContext, Map<DelimiterType, { open: boolean; close: boolean }[]>>();

/** How many pairs added so far are left open, as markdown-it matches them (a pair closes if it can, else opens). */
function leftOpen(list: readonly { open: boolean; close: boolean }[]): number {
  let open = 0;
  for (const d of list) {
    if (d.close && open > 0) open--;
    else if (d.open) open++;
  }
  return open;
}

/**
 * An inline parser for marks of two characters as markdown-it reads strikethrough (`~~`) and
 * markdown-it-mark reads highlights (`==`): a run of two or more is split into pairs (an odd
 * one is text), each pair opening or closing as the run can. Pairs of one run never
 * close each other: of a run that can both open and close, as many pairs close as there are
 * pairs left open before it, and the rest only open.
 */
function pairs(name: string, char: number, type: DelimiterType): InlineParser {
  return {
    name,
    after: "Emphasis",
    parse(cx: InlineContext, next: number, pos: number): number {
      if (next !== char) return -1;
      let end = pos;
      while (end < cx.end && cx.char(end) === char) end++;
      const length = end - pos;
      if (length < 2) return -1;
      const before = pos > cx.offset ? cx.slice(pos - 1, pos) : " ";
      const after = end < cx.end ? cx.slice(end, end + 1) : " ";
      const spaceBefore = WhiteSpace.test(before);
      const spaceAfter = WhiteSpace.test(after);
      const punctBefore = Punctuation.test(before);
      const punctAfter = Punctuation.test(after);
      const open = !spaceAfter && (!punctAfter || spaceBefore || punctBefore);
      const close = !spaceBefore && (!punctBefore || spaceAfter || punctAfter);
      let byType = added.get(cx);
      if (!byType) added.set(cx, (byType = new Map()));
      let list = byType.get(type);
      if (!list) byType.set(type, (list = []));
      // Pairs left open before this run. (Pairs in a link that has closed are no longer open;
      // when no opening pair is left at all, the parser says so.)
      let available = cx.findOpeningDelimiter(type) === null ? 0 : Math.max(1, leftOpen(list));
      const closes: boolean[] = [];
      for (let i = 0; i < length >> 1; i++) {
        const canClose = close && (!open || available > 0);
        if (canClose && open) available--;
        closes.push(canClose);
      }
      // An odd mark is text: before the pairs, but after the pairs that close (markdown-it
      // moves it after the closing tags).
      const closing = length % 2 ? closes.filter((c) => c).length : 0;
      closes.forEach((canClose, i) => {
        const at = pos + 2 * i + (length % 2 && i >= closing ? 1 : 0);
        cx.addDelimiter(type, at, at + 2, open, canClose);
        list.push({ open, close: canClose });
      });
      return end;
    },
  };
}

/**
 * Strikethrough as markdown-it reads it (see `pairs`). CodeMirror's Markdown (GFM) reads no
 * pair in a run of three or more tildes.
 */
export const strikethroughSyntax: MarkdownConfig = {
  parseInline: [pairs("MarkdownItStrikethrough", 126, { resolve: "Strikethrough", mark: "StrikethroughMark" })],
};

/** The highlighting tag of highlighted text (`==text==`). */
export const highlightTag = Tag.define(tags.content);

/**
 * Highlights, `==text==`, as markdown-it-mark reads them (see `pairs`): `Highlight` nodes
 * with `HighlightMark` marks. markdown-it renders them as `<mark>` with the plugin.
 */
export const highlightSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: { "Highlight/...": highlightTag } },
    { name: "HighlightMark", style: tags.processingInstruction },
  ],
  parseInline: [pairs("Highlight", 61, { resolve: "Highlight", mark: "HighlightMark" })],
};

/** Markdown as markdown-it reads it without plugins (see above). */
export const markdownItSyntax: MarkdownConfig[] = [
  { remove: ["Subscript", "Superscript", "Emoji", "Strikethrough"] },
  strikethroughSyntax,
  linkifySyntax,
];
