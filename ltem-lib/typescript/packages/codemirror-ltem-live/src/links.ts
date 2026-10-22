/**
 * Where links go: an inline address, a reference to a definition in the document, an
 * autolink, or a bare URL or e-mail address (as markdown-it's linkify finds them).
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { holdsTables } from "codemirror-ltem";

import { textLinks } from "./linkify.js";

/** A link label as CommonMark matches labels: case and runs of white space do not matter. */
function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toUpperCase().toLowerCase();
}

const definitionCache = new WeakMap<Tree, Map<string, string>>();

/** The link reference definitions of the document, by normalized label; the first one counts (CommonMark). */
function definitions(state: EditorState): Map<string, string> {
  const tree = syntaxTree(state);
  let map = definitionCache.get(tree);
  if (map) return map;
  map = new Map();
  const found = map;
  tree.iterate({
    enter(n) {
      if (n.name === "LinkReference") {
        const label = n.node.getChild("LinkLabel");
        const url = n.node.getChild("URL");
        if (label && url) {
          const key = normalizeLabel(state.doc.sliceString(label.from + 1, label.to - 1));
          if (!found.has(key)) found.set(key, unbracket(state.doc.sliceString(url.from, url.to)));
        }
        return false;
      }
      return holdsTables(n.type);
    },
  });
  definitionCache.set(tree, map);
  return map;
}

function unbracket(url: string): string {
  return url.startsWith("<") && url.endsWith(">") ? url.slice(1, -1) : url;
}

const SCHEME_URL = /^(?:https?|ftp):\/\/\S/i;
const EMAIL = /^[\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/**
 * The address a link, image, autolink or bare URL node goes to, as written; null if it is
 * not a link (a reference to a label the document does not define, or a bare `www.` address,
 * which markdown-it's linkify leaves as text).
 */
export function linkTarget(state: EditorState, node: SyntaxNode): string | null {
  const doc = state.doc;
  const text = (n: { from: number; to: number }): string => doc.sliceString(n.from, n.to);
  if (node.name === "URL" && node.parent?.name !== "Link" && node.parent?.name !== "Image") {
    const url = text(node);
    if (node.parent?.name === "Autolink") return EMAIL.test(url) ? `mailto:${url}` : url;
    if (SCHEME_URL.test(url)) return url;
    if (EMAIL.test(url)) return `mailto:${url}`;
    return null;
  }
  if (node.name === "Autolink") {
    const url = node.getChild("URL");
    return url ? linkTarget(state, url) : null;
  }
  if (node.name !== "Link" && node.name !== "Image") return null;
  const url = node.getChild("URL");
  if (url) return unbracket(text(url));
  // An inline link with no address, `[text]()`, goes to "" (the document itself).
  if (node.getChildren("LinkMark").some((m) => text(m) === "(")) return "";
  // A reference: [text][label], [text][] or [text].
  const label = node.getChild("LinkLabel");
  const marks = node.getChildren("LinkMark");
  const open = marks[0];
  const close = marks.find((m, i) => i > 0 && text(m) === "]");
  const key = label ? text(label).slice(1, -1) : open && close ? doc.sliceString(open.to, close.from) : "";
  if (!key.trim()) {
    // [text][]: the text is the label.
    if (label && open && close) return definitions(state).get(normalizeLabel(doc.sliceString(open.to, close.from))) ?? null;
    return null;
  }
  return definitions(state).get(normalizeLabel(key)) ?? null;
}

/** Blocks of inline text, in which markdown-it's linkify finds bare links in runs of text. */
const TEXT_BLOCKS = /^(?:Paragraph|Task|ATXHeading\d|SetextHeading\d)$/;

/**
 * The link (or autolink, or bare URL or e-mail address) at a document position, where it
 * is and where it goes. `node` is its syntax node, or null for a bare link that markdown-it
 * finds in a run of text (see `textLinks`).
 */
export function linkAt(state: EditorState, pos: number): { node: SyntaxNode | null; from: number; to: number; url: string } | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) {
      if (n.name === "Link" || n.name === "Autolink" || (n.name === "URL" && n.parent?.name !== "Link" && n.parent?.name !== "Image")) {
        const url = linkTarget(state, n);
        if (url !== null) return { node: n, from: n.from, to: n.to, url };
      }
      if (TEXT_BLOCKS.test(n.name)) {
        const link = textLinks(state, n).find((l) => l.from <= pos && l.to >= pos);
        if (link) return { node: null, ...link };
        break;
      }
      if (n.type.isTop) break;
    }
  }
  return null;
}
