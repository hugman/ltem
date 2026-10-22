/**
 * A small, forgiving HTML tree builder that closes table elements implicitly, as the
 * Python implementation of LTEM does. Traversals use explicit stacks, so deeply nested
 * input cannot overflow the call stack.
 */

import { tokenize, type Attribute, type Sink } from "./tokenizer.js";

/** Void elements: they have no content and no end tag. */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source",
  "track", "wbr"]);
/** Table cells. */
export const CELL = new Set(["td", "th"]);
/** Row groups. */
export const GROUP = new Set(["thead", "tbody", "tfoot"]);

/** An element. A child is another element or text. */
export interface HtmlNode {
  tag: string;
  /** Attributes; a repeated name takes its last value, and a name without a value has "". */
  attrs: Map<string, string>;
  children: (HtmlNode | string)[];
  parent: HtmlNode | null;
}

function element(tag: string, attrs: Attribute[], parent: HtmlNode | null): HtmlNode {
  return { tag, attrs: new Map(attrs.map(([k, v]) => [k, v ?? ""])), children: [], parent };
}

class Builder implements Sink {
  readonly root = element("#root", [], null);
  private cur = this.root;

  /** Close open elements up to and including the nearest one in `tags`, not past one in `stop`. */
  private closeUntil(tags: ReadonlySet<string>, stop: ReadonlySet<string>): void {
    let node: HtmlNode | null = this.cur;
    while (node !== null && !stop.has(node.tag)) {
      if (tags.has(node.tag)) {
        this.cur = node.parent ?? this.root;
        return;
      }
      node = node.parent;
    }
  }

  startTag(tag: string, attrs: Attribute[]): void {
    if (CELL.has(tag)) {
      this.closeUntil(CELL, new Set(["tr", "table"]));
    } else if (tag === "tr") {
      this.closeUntil(new Set(["tr"]), new Set(["table", ...GROUP]));
      this.closeUntil(CELL, new Set(["table"]));
    } else if (GROUP.has(tag)) {
      this.closeUntil(GROUP, new Set(["table"]));
    } else if (tag === "p") {
      this.closeUntil(new Set(["p"]), new Set([...CELL, "table"]));
    } else if (tag === "li") {
      this.closeUntil(new Set(["li"]), new Set(["ul", "ol", ...CELL]));
    }
    const node = element(tag, attrs, this.cur);
    this.cur.children.push(node);
    if (!VOID.has(tag)) this.cur = node;
  }

  startEndTag(tag: string, attrs: Attribute[]): void {
    this.cur.children.push(element(tag, attrs, this.cur));
  }

  endTag(tag: string): void {
    if (VOID.has(tag)) return;
    let node: HtmlNode | null = this.cur;
    while (node !== null && node !== this.root) {
      if (node.tag === tag) {
        this.cur = node.parent ?? this.root;
        return;
      }
      node = node.parent;
    }
  }

  data(text: string): void {
    // The tokenizer may deliver one run of text in pieces (it splits at a lone "<").
    // Keep a run together so that escaping sees its neighbours.
    const children = this.cur.children;
    const last = children.length - 1;
    if (last >= 0 && typeof children[last] === "string") children[last] += text;
    else children.push(text);
  }
}

/** Parse an HTML document into a tree. Its root has the tag "#root". */
export function parseHtml(html: string): HtmlNode {
  const builder = new Builder();
  tokenize(html, builder);
  return builder.root;
}

/**
 * The elements with the given tag below `node`, in document order. The search does not
 * descend into a match, nor into elements whose tag is in `stop`.
 */
export function findAll(node: HtmlNode, tag: string, stop: ReadonlySet<string> = new Set()): HtmlNode[] {
  const out: HtmlNode[] = [];
  const stack: [HtmlNode, number][] = [[node, 0]];
  while (stack.length) {
    const top = stack[stack.length - 1];
    const child = top[0].children[top[1]];
    if (child === undefined) {
      stack.pop();
      continue;
    }
    top[1]++;
    if (typeof child === "string") continue;
    if (child.tag === tag) out.push(child);
    else if (!stop.has(child.tag)) stack.push([child, 0]);
  }
  return out;
}

/** All text below `node`, in document order. */
export function textContent(node: HtmlNode): string {
  let out = "";
  const stack: [HtmlNode, number][] = [[node, 0]];
  while (stack.length) {
    const top = stack[stack.length - 1];
    const child = top[0].children[top[1]];
    if (child === undefined) {
      stack.pop();
      continue;
    }
    top[1]++;
    if (typeof child === "string") out += child;
    else stack.push([child, 0]);
  }
  return out;
}

/** The element children of a row that are table cells. */
export function cellsOf(row: HtmlNode): HtmlNode[] {
  return row.children.filter((c): c is HtmlNode => typeof c !== "string" && CELL.has(c.tag));
}
