/**
 * The Markdown language of Live Preview: CodeMirror's Markdown with LTEM tables, read as
 * markdown-it reads it, and quick in a large document.
 *
 * - CodeMirror's `markdown()` parses code blocks and HTML with their languages inside the
 *   Markdown parse, over the whole document at every change. Here the Markdown parse is not
 *   nested, and the visible code blocks and HTML are highlighted by their language on their
 *   own (code.ts); `nestedLanguages: true` parses as `markdown()` does.
 * - Markdown as markdown-it reads it (`markdownItSyntax`), and HTML as text unless `html`.
 * - Extensions apply in order: a `remove` in one also removes the parsers that earlier ones
 *   add.
 */

import { commonmarkLanguage, markdown } from "@codemirror/lang-markdown";
import { html as htmlLanguage } from "@codemirror/lang-html";
import { Language, LanguageSupport } from "@codemirror/language";
import type { InlineContext, MarkdownConfig, MarkdownExtension, MarkdownParser } from "@lezer/markdown";
import { ltemMarkdownExtensions } from "codemirror-ltem";

import { codeHighlighting } from "./code.js";
import { validLink } from "./linkify.js";
import { markdownItSyntax } from "./markdownit.js";

const AUTOLINK = /^([a-zA-Z][a-zA-Z0-9+.-]{1,31}):([^<>\x00-\x20]*)$/;
const EMAIL = /^([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/;

/**
 * HTML as markdown-it reads it with `html: false` (its default): as text. Only autolinks
 * (`<https://example.com>`, `<me@example.com>`) are read, as markdown-it reads them.
 * `liveMarkdownLanguage` (without `html`) also lets a line that would start an HTML block go
 * on with a paragraph.
 */
export const noHtmlMarkdown: MarkdownConfig = {
  remove: ["HTMLBlock", "HTMLTag"],
  parseInline: [{
    name: "MarkdownItAutolink",
    before: "Emphasis",
    parse(cx: InlineContext, next: number, start: number): number {
      if (next !== 60) return -1;
      let end = start + 1;
      for (; ; end++) {
        if (end >= cx.end) return -1;
        const c = cx.char(end);
        if (c === 60) return -1;
        if (c === 62) break;
      }
      const url = cx.slice(start + 1, end);
      if (!(AUTOLINK.test(url) && validLink(url)) && !(EMAIL.test(url) && validLink(`mailto:${url}`))) return -1;
      return cx.addElement(cx.elt("Autolink", start, end + 1, [
        cx.elt("LinkMark", start, start + 1),
        cx.elt("URL", start + 1, end),
        cx.elt("LinkMark", end, end + 1),
      ]));
    },
  }],
};

/**
 * Take out of a parser the rule that a line starting an HTML block ends a paragraph, which
 * markdown-it with `html: false` does not have. Lezer has no option for it; the rule is
 * found by what it answers, and nothing changes if it is not found.
 */
function withoutHtmlEndLeaf(parser: MarkdownParser): void {
  const ends = (parser as unknown as { endLeafBlock?: unknown }).endLeafBlock;
  if (!Array.isArray(ends)) return;
  const line = (text: string): object => ({ text, pos: 0, next: text.charCodeAt(0), indent: 0, baseIndent: 0, depth: 0 });
  const answers = (end: (...a: unknown[]) => unknown, text: string): boolean => {
    try {
      return end(null, line(text), null) === true;
    } catch {
      return false;
    }
  };
  const index = ends.findIndex((end) => typeof end === "function" && answers(end, "<div>") && !answers(end, "plain text"));
  if (index >= 0) ends.splice(index, 1);
}

/**
 * Markdown extensions in order, with each `remove` applied to the parsers of the extensions
 * before it too. Lezer applies `remove` only to the parsers of the parser being configured,
 * so an extension could not remove what an earlier one in the same list adds (GFM's
 * autolinks, subscript, superscript).
 */
function inOrder(extensions: readonly MarkdownExtension[]): MarkdownConfig[] {
  const configs: MarkdownConfig[] = [];
  const flatten = (e: MarkdownExtension): void => {
    if (Array.isArray(e)) e.forEach(flatten);
    else configs.push(e as MarkdownConfig);
  };
  extensions.forEach(flatten);
  for (let i = configs.length - 1; i > 0; i--) {
    const remove = configs[i]!.remove;
    if (!remove?.length) continue;
    for (let j = 0; j < i; j++) {
      const c = configs[j]!;
      const keep = <T extends { name: string }>(list: readonly T[] | undefined): T[] | undefined => list?.filter((p) => !remove.includes(p.name));
      if (c.parseInline?.some((p) => remove.includes(p.name)) || c.parseBlock?.some((p) => remove.includes(p.name))) {
        configs[j] = { ...c, parseInline: keep(c.parseInline), parseBlock: keep(c.parseBlock) };
      }
    }
  }
  return configs;
}

/** The HTML language `markdown()` uses for HTML in Markdown, made when first needed. */
let htmlNoMatch: LanguageSupport | undefined;

/** Options of `liveMarkdownLanguage`: those of `markdown()` except `base`, and these. */
export type LiveMarkdownLanguageConfig = Omit<Parameters<typeof markdown>[0] & object, "base"> & {
  /**
   * Parse code blocks and HTML with their languages inside the Markdown parse, as
   * `markdown()` does. This costs several milliseconds per keystroke in a large document.
   * By default (false) the Markdown parse is not nested, and the visible code blocks and
   * HTML are highlighted by their language (`codeLanguages`, `defaultCodeLanguage`,
   * `htmlTagLanguage`) on their own.
   */
  nestedLanguages?: boolean;
  /**
   * Read HTML blocks and tags, as markdown-it does with `html: true` (default false, as
   * markdown-it's default `html: false`: HTML is text, but autolinks).
   */
  html?: boolean;
};

/**
 * The Markdown language of Live Preview: LTEM tables (`ltemMarkdownExtensions`), Markdown as
 * markdown-it reads it (`markdownItSyntax`), then `extensions` in order. It has the key
 * bindings, folding, URL pasting and HTML tag completion of `markdown()`.
 */
export function liveMarkdownLanguage(config: LiveMarkdownLanguageConfig = {}): LanguageSupport {
  const { nestedLanguages = false, html = false, ...options } = config;
  const extra = options.extensions ?? [];
  const extensions = inOrder([
    ...ltemMarkdownExtensions, ...markdownItSyntax, ...(html ? [] : [noHtmlMarkdown]), ...(Array.isArray(extra) ? extra : [extra]),
  ]);
  const support = markdown({ ...options, base: commonmarkLanguage, extensions });
  if (nestedLanguages) {
    if (!html) withoutHtmlEndLeaf(support.language.parser as MarkdownParser);
    return support;
  }
  // The same language without the nested parse; the support extensions (key bindings,
  // folding, completion) belong to the language's data facet, which the two share.
  const parser = (commonmarkLanguage.parser as MarkdownParser).configure(extensions);
  if (!html) withoutHtmlEndLeaf(parser);
  const language = new Language(commonmarkLanguage.data, parser, [], "markdown");
  const { codeLanguages, defaultCodeLanguage } = options;
  const htmlTagLanguage = html ? options.htmlTagLanguage ?? (htmlNoMatch ??= htmlLanguage({ matchClosingTags: false })) : null;
  const code = codeHighlighting({
    languages: codeLanguages,
    defaultLanguage: defaultCodeLanguage instanceof LanguageSupport ? defaultCodeLanguage.language : defaultCodeLanguage,
    html: htmlTagLanguage?.language,
  });
  return new LanguageSupport(language, [support.support, code]);
}
