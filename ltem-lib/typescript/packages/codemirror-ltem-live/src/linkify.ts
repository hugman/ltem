/**
 * Bare links and HTML as markdown-it reads them, for Live Preview to match the preview.
 *
 * markdown-it (with `linkify: true`) finds bare links in two steps, both with linkify-it:
 *
 * 1. While it reads inline content, at `://` after a scheme that starts right there (no
 *    letter, digit, `+`, `-` or `.` before it in the same run of text), it takes the link
 *    that linkify-it finds from the scheme on. Nothing inside it is read as anything else.
 *    `linkifySyntax` does this in the parser, as `URL` nodes.
 * 2. After that, it looks for links in each run of plain text (between emphasis marks,
 *    code, math, escapes and so on), if linkify-it finds a link in the block's text at all.
 *    `textLinks` does this for a block, from its syntax tree.
 */

import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";
import { LinkifyIt } from "linkify-it";

import { linkTarget } from "./links.js";

let linkifier: LinkifyIt | undefined;

/** linkify-it as markdown-it sets it up (its defaults). */
function linkify(): LinkifyIt {
  return (linkifier ??= new LinkifyIt());
}

const BAD_PROTOCOL = /^(vbscript|javascript|file|data):/;
const GOOD_DATA = /^data:image\/(gif|png|jpeg|webp);/;

/** markdown-it's `validateLink`: no script, file or data links (but images in data links). */
export function validLink(url: string): boolean {
  const s = url.trim().toLowerCase();
  return !BAD_PROTOCOL.test(s) || GOOD_DATA.test(s);
}

const isAlpha = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isSchemeChar = (c: number): boolean => isAlpha(c) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46;

/** Whether the character before `pos` ends an escape (`\.`): the run of text starts after it. */
function afterEscape(cx: InlineContext, pos: number): boolean {
  let backslashes = 0;
  for (let i = pos - 2; i >= cx.offset && cx.char(i) === 92; i--) backslashes++;
  return backslashes % 2 === 1;
}

/** Step 1 of markdown-it's linkify, and its autolinks without bare links of GFM in their way. */
export const linkifySyntax: MarkdownConfig = {
  remove: ["Autolink"], // GFM's bare links (extended autolinks)
  parseInline: [{
    name: "Linkify",
    before: "Emphasis",
    parse(cx: InlineContext, next: number, pos: number): number {
      if (!isAlpha(next)) return -1;
      // The scheme starts here: the character before is not one of a scheme, or it ends a token.
      if (pos > cx.offset && isSchemeChar(cx.char(pos - 1)) && !afterEscape(cx, pos)) return -1;
      let colon = pos;
      while (colon < cx.end && colon - pos <= 10 && isSchemeChar(cx.char(colon))) colon++;
      if (colon === pos || colon - pos > 10 || cx.char(colon) !== 58 || cx.char(colon + 1) !== 47 || cx.char(colon + 2) !== 47) return -1;
      // Not in the text of a link (markdown-it does not linkify there).
      if (cx.hasOpenLink) return -1;
      let lineEnd = colon;
      while (lineEnd < cx.end && cx.char(lineEnd) !== 10) lineEnd++;
      const link = linkify().matchAtStart(cx.slice(pos, lineEnd));
      if (!link) return -1;
      let url = link.url;
      if (url.length <= colon - pos) return -1;
      url = url.replace(/\*+$/, "");
      if (!validLink(url)) return -1;
      return cx.addElement(cx.elt("URL", pos, pos + url.length));
    },
  }],
};

// -- step 2: links in runs of plain text --------------------------------------------------------

/** A bare link that step 2 finds: where it is, and where it goes. */
export interface TextLink {
  from: number;
  to: number;
  url: string;
}

/** Inline nodes whose content is part of the surrounding text (their marks end runs of it). */
const SPANS = new Set(["Emphasis", "StrongEmphasis", "Strikethrough", "Highlight"]);
/** Inline nodes that markdown-it reads as `text_special` tokens. */
const SPECIAL = new Set(["Escape", "Entity"]);

/**
 * The links found in blocks by their text, from the block's start: a block's syntax
 * depends only on its text, unless it has references to link labels (not cached).
 */
const found = new Map<string, TextLink[]>();
const FOUND_MAX = 2000;

/**
 * The bare links that step 2 of markdown-it's linkify finds in the text of a block
 * (a paragraph or a heading), or in the text of an inline footnote.
 */
export function textLinks(state: EditorState, block: SyntaxNode): TextLink[] {
  const text = state.doc.sliceString(block.from, block.to);
  const cached = found.get(text);
  if (cached) return cached.map((l) => ({ from: block.from + l.from, to: block.from + l.to, url: l.url }));
  const references = { found: false };
  const out = findTextLinks(state, block, references);
  if (!references.found) {
    if (found.size >= FOUND_MAX) found.delete(found.keys().next().value!);
    found.set(text, out.map((l) => ({ from: l.from - block.from, to: l.to - block.from, url: l.url })));
  }
  return out;
}

function findTextLinks(state: EditorState, block: SyntaxNode, references: { found: boolean }): TextLink[] {
  const doc = state.doc;
  // The quote marks of continuation lines: not children of the block, but in its range.
  const marks: { from: number; to: number }[] = [];
  for (let n: SyntaxNode | null = block.parent; n; n = n.parent) {
    if (n.name !== "Blockquote") continue;
    for (const mark of n.getChildren("QuoteMark")) if (mark.from > block.from && mark.to <= block.to) marks.push(mark);
  }
  marks.sort((a, b) => a.from - b.from);
  // markdown-it looks for links in the runs only if it finds one in the block's text.
  let content = "";
  let at = block.from;
  for (const mark of marks) {
    content += doc.sliceString(at, mark.from);
    at = mark.to;
  }
  content += doc.sliceString(at, block.to);
  const out: TextLink[] = [];
  if (!linkify().test(content)) return out;

  // What is not text: tokens of their own (code, math, escapes, links, the marks of
  // emphasis...), and the quote marks of continuation lines.
  const breaks: { from: number; to: number; special: boolean }[] = marks.map((m) => ({ ...m, special: false }));
  const walk = (node: SyntaxNode, brackets: boolean): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      // The brackets of a link that goes nowhere are text (see below).
      if (brackets && (child.name === "LinkMark" || child.name === "LinkLabel")) continue;
      if ((child.name === "Link" || child.name === "Image") && !child.getChild("URL") && !child.getChildren("LinkMark").some((m) => doc.sliceString(m.from, m.to) === "(")) {
        references.found = true; // a reference: whether it is a link depends on the rest of the document
      }
      if (SPANS.has(child.name)) walk(child, false);
      // A reference to a label that is not defined is no link for markdown-it: its brackets
      // are text, and what is in them is read as usual.
      else if ((child.name === "Link" || child.name === "Image") && linkTarget(state, child) === null) walk(child, true);
      else {
        // The text of an inline footnote is a block of text of its own (markdown-it-footnote).
        if (child.name === "InlineFootnote") out.push(...findTextLinks(state, child, references));
        breaks.push({ from: child.from, to: child.to, special: SPECIAL.has(child.name) });
      }
    }
  };
  walk(block, false);
  breaks.sort((a, b) => a.from - b.from);
  // The runs of text between them; each line is a run (a line break is a token of its own).
  const runs: { from: number; to: number; afterSpecial: boolean }[] = [];
  const addRuns = (from: number, to: number, afterSpecial: boolean): void => {
    let start = from;
    for (let pos = from; pos <= to; pos++) {
      if (pos < to && doc.sliceString(pos, pos + 1) !== "\n") continue;
      if (pos > start) runs.push({ from: start, to: pos, afterSpecial: start === from && afterSpecial });
      start = pos + 1;
    }
  };
  let pos = block.from;
  let special = false;
  for (const b of breaks) {
    if (b.from > pos) addRuns(pos, b.from, special);
    if (b.to > pos) {
      pos = b.to;
      special = b.special;
    }
  }
  if (block.to > pos) addRuns(pos, block.to, special);
  for (const run of runs) {
    let links = linkify().match(doc.sliceString(run.from, run.to)) ?? [];
    // markdown-it: no link right after an escape (`http\://example.com`).
    if (links.length && links[0]!.index === 0 && run.afterSpecial) links = links.slice(1);
    for (const link of links) {
      if (validLink(link.url)) out.push({ from: run.from + link.index, to: run.from + link.lastIndex, url: link.url });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}
