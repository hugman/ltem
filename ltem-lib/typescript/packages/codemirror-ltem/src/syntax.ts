/**
 * LTEM tables in the Lezer Markdown parser that CodeMirror uses.
 *
 * The extension replaces the GFM table parser. When a paragraph ends, it hands the
 * paragraph's lines to the LTEM core (`parseTable`), which decides where tables are, and
 * turns each table into syntax nodes. Tables are therefore found exactly as the LTEM core,
 * and every renderer built on it, finds them.
 */

import { commonmarkLanguage, markdown } from "@codemirror/lang-markdown";
import { foldNodeProp, type LanguageSupport } from "@codemirror/language";
import { Tag, tags } from "@lezer/highlight";
import {
  Autolink, Emoji, Strikethrough, Subscript, Superscript, TaskList,
  type BlockContext, type Element, type LeafBlock, type LeafBlockParser, type Line, type MarkdownConfig,
  type MarkdownExtension,
} from "@lezer/markdown";
import type { NodeType, Tree } from "@lezer/common";
import { endsTableBody, isDelimiterRow, parseTable, splitRowSpans } from "ltem-core";

import { attributeKeys } from "./analysis.js";
import { TextCache } from "./cache.js";

/** Highlighting tags for the parts of an LTEM table. Each falls back to a common tag. */
export const ltemTags = {
  /** The delimiter row. */
  delimiter: Tag.define(tags.processingInstruction),
  /** The text of header rows. */
  header: Tag.define(tags.heading),
  /** The span markers `<<` and `^^`. */
  marker: Tag.define(tags.operator),
  /** A span attribute such as `{c:2}`. */
  attribute: Tag.define(tags.attributeName),
  /** A line break `\\` inside a cell. */
  lineBreak: Tag.define(tags.escape),
};

/** Names of the syntax nodes that the extension adds. */
/**
 * Whether LTEM tables can be found inside a node of this type: the document and container
 * blocks (block quotes, lists, list items, and containers that other extensions add).
 * Searching only these skips paragraphs and inline content.
 */
export function holdsTables(type: NodeType): boolean {
  return type.isTop || type.is("BlockContext");
}

export const NODE = {
  table: "LtemTable",
  headerRow: "LtemHeaderRow",
  delimiterRow: "LtemDelimiterRow",
  row: "LtemRow",
  colspan: "LtemColspanMarker",
  rowspan: "LtemRowspanMarker",
  attribute: "LtemSpanAttribute",
  lineBreak: "LtemLineBreak",
} as const;

/** A line of a paragraph as the LTEM core reads it, and where it is in the document. */
interface BlockLine {
  /** Indentation relative to the block, then the line's text. */
  text: string;
  /** Number of indentation spaces at the start of `text`. */
  indent: number;
  /** Document position of `text[indent]`. */
  from: number;
  /** Document position of the end of the line. */
  to: number;
  /** Offset of the line's start in the leaf's content. */
  contentFrom: number;
  contentTo: number;
}

class LtemTableParser implements LeafBlockParser {
  /** For each line after the first: where its text starts and its indentation in the block. */
  private readonly next: { pos: number; indent: number }[] = [];

  nextLine(_cx: BlockContext, line: Line): boolean {
    this.next.push({ pos: line.pos, indent: Math.max(0, line.indent - line.baseIndent) });
    return false;
  }

  finish(cx: BlockContext, leaf: LeafBlock): boolean {
    const content = leaf.content;
    if (!content.includes("|")) return false;
    const raw = content.split("\n");
    if (raw.length !== this.next.length + 1) return false;
    const lines: BlockLine[] = [];
    let offset = 0;
    for (let k = 0; k < raw.length; k++) {
      const pos = k === 0 ? 0 : this.next[k - 1].pos;
      const indent = k === 0 ? 0 : this.next[k - 1].indent;
      lines.push({
        text: " ".repeat(indent) + raw[k].slice(pos),
        indent,
        from: leaf.start + offset + pos,
        to: leaf.start + offset + raw[k].length,
        contentFrom: offset,
        contentTo: offset + raw[k].length,
      });
      offset += raw[k].length + 1;
    }
    const texts = lines.map((l) => l.text);
    const elements: Element[] = [];
    let i = 0;
    let found = false;
    while (i < lines.length) {
      const table = findTable(texts, i);
      if (table === null) break;
      found = true;
      if (table.start > i) elements.push(paragraph(cx, leaf, lines, i, table.start));
      elements.push(tableElement(cx, lines, table.start, table.end, table.headerRows));
      i = table.end;
    }
    if (!found) return false;
    if (i < lines.length) elements.push(paragraph(cx, leaf, lines, i, lines.length));
    for (const element of elements) addWithMarks(cx, leaf, element);
    return true;
  }
}

/**
 * The first table in `texts` from line `i`, as the LTEM core's `parseTable` finds it.
 *
 * Only the header rows and the delimiter row are given to the core: whether a delimiter
 * row starts a table depends on the lines above it alone (spec 2.3), and the body runs to
 * the first line that ends it (`endsTableBody`, spec 2.4). This gives the core's answer
 * without resolving every body row on each keystroke.
 */
function findTable(texts: string[], i: number): { start: number; end: number; headerRows: number } | null {
  for (let d = i + 1; d < texts.length; d++) {
    if (!isDelimiterRow(texts[d])) continue;
    const result = parseTable(texts.slice(i, d + 1), i);
    if (result.table !== null && result.end === d + 1) {
      let end = d + 1;
      while (end < texts.length && !endsTableBody(texts[end])) end++;
      return { start: result.start, end, headerRows: result.table.header_rows };
    }
  }
  return null;
}

/** Add an element of a leaf, with only the container marks that fall inside it. */
function addWithMarks(cx: BlockContext, leaf: LeafBlock, element: Element): void {
  const holder = leaf as unknown as { marks: Element[] };
  const all = holder.marks;
  holder.marks = all.filter((m) => m.from >= element.from && m.to <= element.to);
  cx.addLeafElement(leaf, element);
  holder.marks = all;
}

function paragraph(cx: BlockContext, leaf: LeafBlock, lines: BlockLine[], from: number, to: number): Element {
  const a = lines[from].contentFrom;
  const b = lines[to - 1].contentTo;
  const start = leaf.start + a;
  return cx.elt("Paragraph", start, leaf.start + b, cx.parser.parseInline(leaf.content.slice(a, b), start));
}

function tableElement(cx: BlockContext, lines: BlockLine[], from: number, to: number, headerRows: number): Element {
  const rows: Element[] = [];
  for (let k = from; k < to; k++) {
    const r = k - from;
    const type = r < headerRows ? NODE.headerRow : r === headerRows ? NODE.delimiterRow : NODE.row;
    rows.push(rowElement(cx, lines[k], type));
  }
  return cx.elt(NODE.table, lines[from].from, lines[to - 1].to, rows);
}

/**
 * The nodes of a row, as a template with positions relative to the row's text. Rows are
 * cached by their text, so that typing in one row of a large table re-reads only that
 * row; the others are copied from the cache.
 */
interface Template { name: string | null; tree: Tree | null; from: number; to: number; children: Template[] }

const rowCache = new TextCache<Template[]>(20_000, 2_000_000);

function rowElement(cx: BlockContext, line: BlockLine, type: string): Element {
  const key = `${type}\u0000${line.indent}\u0000${line.text}`;
  let templates = rowCache.get(key);
  if (templates === undefined) {
    templates = rowTemplates(cx, line, type);
    rowCache.set(key, templates);
  }
  const base = line.from;
  const make = (t: Template): Element =>
    t.tree ? cx.elt(t.tree, t.from + base) : cx.elt(t.name!, t.from + base, t.to + base, t.children.map(make));
  return cx.elt(type, line.from, line.to, templates.map(make));
}

/** The children of a row element, with positions relative to the row's text (position 0). */
function rowTemplates(cx: BlockContext, line: BlockLine, type: string): Template[] {
  const at = (i: number): number => Math.max(0, i - line.indent);
  // Only the parts of a cell that need a node of their own get one: markers, attributes,
  // line breaks and inline Markdown. Plain text, pipes and the delimiter row get none (pipes
  // are drawn as decorations), which keeps large tables cheap to re-read on each keystroke.
  const children: Element[] = [];
  if (type !== NODE.delimiterRow) {
    for (const [, start, end] of splitRowSpans(line.text)) {
      if (end > start) children.push(...cellElements(cx, line.text.slice(start, end), at(start)));
    }
  }
  const types = cx.parser.nodeSet.types;
  const toTemplate = (e: Element): Template => {
    const tree = (e as unknown as { tree?: Tree }).tree;
    if (tree) return { name: null, tree, from: e.from, to: e.to, children: [] };
    const kids = (e as unknown as { children: readonly Element[] }).children;
    return { name: types[e.type].name, tree: null, from: e.from, to: e.to, children: kids.map(toTemplate) };
  };
  return children.map(toTemplate);
}

// Characters that can start inline Markdown in a cell (`$` for math and `=` for highlights,
// which extensions add). A cell without any of them is plain text, and the inline parser is
// not run on it.
const MAY_HAVE_INLINE = /[*_`[\]!<&\\~^:@$=]|www\.|https?:|ftp:/i;

function inline(cx: BlockContext, text: string, from: number): Element[] {
  return MAY_HAVE_INLINE.test(text) ? cx.parser.parseInline(text, from) : [];
}

function cellElements(cx: BlockContext, source: string, from: number): Element[] {
  const to = from + source.length;
  if (source === "<<") return [cx.elt(NODE.colspan, from, to)];
  if (source === "^^") return [cx.elt(NODE.rowspan, from, to)];
  const children: Element[] = [];
  const attribute = attributeKeys(source);
  const textEnd = attribute ? attribute.from : source.length;
  // Inline content, split at the `\\` line breaks (spec 4.2).
  let start = 0;
  const breaks = /\\\\/g;
  for (let m = breaks.exec(source); m && m.index < textEnd; m = breaks.exec(source)) {
    children.push(...inline(cx, source.slice(start, m.index), from + start));
    children.push(cx.elt(NODE.lineBreak, from + m.index, from + m.index + 2));
    start = m.index + 2;
  }
  children.push(...inline(cx, source.slice(start, textEnd), from + start));
  if (attribute) children.push(cx.elt(NODE.attribute, from + attribute.from, to));
  return children;
}

/**
 * The Lezer Markdown extension for LTEM tables. Use it in place of GFM tables:
 *
 * ```ts
 * markdown({ base: markdownLanguage, extensions: ltemMarkdown })
 * ```
 */
export const ltemMarkdown: MarkdownConfig = {
  defineNodes: [
    { name: NODE.table, block: true },
    { name: NODE.headerRow, style: { [`${NODE.headerRow}/...`]: ltemTags.header } },
    { name: NODE.delimiterRow, style: ltemTags.delimiter },
    NODE.row,
    { name: NODE.colspan, style: ltemTags.marker },
    { name: NODE.rowspan, style: ltemTags.marker },
    { name: NODE.attribute, style: ltemTags.attribute },
    { name: NODE.lineBreak, style: ltemTags.lineBreak },
  ],
  parseBlock: [{
    name: NODE.table,
    leaf: () => new LtemTableParser(),
    after: "LinkReference",
  }],
  remove: ["Table"],
  props: [
    foldNodeProp.add({
      [NODE.table]: (node, state) => {
        const first = state.doc.lineAt(node.from);
        return first.to < node.to ? { from: first.to, to: node.to } : null;
      },
    }),
  ],
};

/**
 * The Markdown extensions of CodeMirror's `markdownLanguage` (GFM, subscript, superscript,
 * emoji), with LTEM tables in place of GFM tables. Use them on top of `commonmarkLanguage`:
 * the GFM table parser cannot be fully removed from `markdownLanguage`, because its rule
 * that ends a paragraph before a delimiter row stays.
 */
export const ltemMarkdownExtensions: MarkdownExtension[] = [
  Strikethrough, TaskList, Autolink, Subscript, Superscript, Emoji, ltemMarkdown,
];

/** Markdown language support with LTEM tables. Takes the options of `markdown()`, except `base`. */
export function ltemMarkdownLanguage(config: Omit<Parameters<typeof markdown>[0] & object, "base"> = {}): LanguageSupport {
  const extra = config.extensions ?? [];
  return markdown({
    ...config,
    base: commonmarkLanguage,
    extensions: [...ltemMarkdownExtensions, ...(Array.isArray(extra) ? extra : [extra])],
  });
}
