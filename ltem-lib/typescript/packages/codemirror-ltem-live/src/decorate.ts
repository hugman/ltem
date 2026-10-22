/**
 * The decorations of Live Preview for a part of the document: Markdown marks hidden where
 * the cursor is not, and the text they mark styled.
 *
 * Marks are shown again where the selection touches them: inline marks (emphasis, code,
 * links, images, escapes) when the selection touches their element, line marks (headings,
 * list items, block quotes, horizontal rules, code fences) when it touches their line or
 * block. LTEM tables are left to `codemirror-ltem`'s table widgets.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range, SelectionRange } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { NODE } from "codemirror-ltem";

import { RenderedWidget, drawnAsBlock, type Renderers } from "./blocks.js";
import { textLinks } from "./linkify.js";
import { linkTarget } from "./links.js";
import { footnoteLabelNumber, footnoteNumber } from "./footnotes.js";
import { BulletWidget, CheckboxWidget, FootnoteWidget, HardBreakWidget, HorizontalRuleWidget, ImageWidget, LanguageWidget } from "./widgets.js";

export interface DecorateOptions {
  /** Turns an image's address as written into one to show, or null to show none. See `LivePreviewOptions.resolveImage`. */
  resolveImage?: (src: string) => string | null;
  /** Style bare URLs and e-mail addresses as links (default true). */
  bareUrls?: boolean;
  /** The application's renderers of math, Mermaid and front matter. */
  renderers?: Renderers;
}

const hidden = Decoration.replace({});
const marks: Record<string, Decoration> = {
  Emphasis: Decoration.mark({ class: "cm-live-em" }),
  StrongEmphasis: Decoration.mark({ class: "cm-live-strong" }),
  Strikethrough: Decoration.mark({ class: "cm-live-strike" }),
  Highlight: Decoration.mark({ class: "cm-live-highlight" }),
  InlineCode: Decoration.mark({ class: "cm-live-code" }),
  link: Decoration.mark({ class: "cm-live-link" }),
  listNumber: Decoration.mark({ class: "cm-live-list-number" }),
  math: Decoration.mark({ class: "cm-live-math" }),
  muted: Decoration.mark({ class: "cm-live-muted" }),
  definition: Decoration.mark({ class: "cm-live-definition" }),
  hardBreakSource: Decoration.mark({ class: "cm-live-hardbreak-source" }),
};
const lineDecorations = new Map<string, Decoration>();

function lineDecoration(classes: string): Decoration {
  let deco = lineDecorations.get(classes);
  if (!deco) lineDecorations.set(classes, (deco = Decoration.line({ class: classes })));
  return deco;
}

/** The decorations of Live Preview for the parts of the document from `ranges` (the visible ones). */
export function liveDecorations(state: EditorState, ranges: readonly { from: number; to: number }[], options: DecorateOptions = {}): DecorationSet {
  const doc = state.doc;
  const selection = state.selection.ranges;
  const out: Range<Decoration>[] = [];
  const lines = new Map<number, Set<string>>();
  const tree = syntaxTree(state);

  const touches = (from: number, to: number): boolean => selection.some((r: SelectionRange) => r.from <= to && r.to >= from);
  const lineTouched = (pos: number): boolean => {
    const line = doc.lineAt(pos);
    return touches(line.from, line.to);
  };
  const addLine = (pos: number, cls: string): void => {
    const from = doc.lineAt(pos).from;
    let set = lines.get(from);
    if (!set) lines.set(from, (set = new Set()));
    set.add(cls);
  };
  const eachLine = (from: number, to: number, f: (lineFrom: number) => void): void => {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      f(line.from);
      pos = line.to + 1;
    }
  };
  const hide = (from: number, to: number): void => {
    if (to > from) out.push(hidden.range(from, to));
  };
  /** Hide a mark and the spaces after it (up to the end of its line). */
  const hideWithSpaces = (from: number, to: number): void => {
    const end = doc.lineAt(to).to;
    let stop = to;
    while (stop < end && (doc.sliceString(stop, stop + 1) === " " || doc.sliceString(stop, stop + 1) === "\t")) stop++;
    hide(from, stop);
  };
  const seen = new Set<number>(); // nodes reached from two visible ranges
  const quoteDepth = new Map<number, number>(); // line start -> nesting of block quotes
  const renderers = options.renderers ?? {};

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(ref) {
        const node = ref.node;
        const name = ref.name;
        const key = ref.from * 4096 + ref.type.id;
        if (seen.has(key)) return name !== NODE.table;
        seen.add(key);
        switch (name) {
          case NODE.table:
            return false; // shown by the table widgets
          case "ATXHeading1": case "ATXHeading2": case "ATXHeading3":
          case "ATXHeading4": case "ATXHeading5": case "ATXHeading6":
            addLine(ref.from, `cm-live-heading cm-live-h${name.slice(-1)}`);
            bareLinks(node);
            break;
          case "SetextHeading1": case "SetextHeading2": {
            const level = name.slice(-1);
            const underline = node.getChild("HeaderMark");
            const active = touches(ref.from, ref.to);
            eachLine(ref.from, underline ? underline.from - 1 : ref.to, (l) => addLine(l, `cm-live-heading cm-live-h${level}`));
            bareLinks(node);
            if (underline && !active) {
              // The underline's line stays, empty, as space under the heading.
              addLine(underline.from, "cm-live-hidden-marks");
              hide(underline.from, underline.to);
            }
            break;
          }
          case "HeaderMark": {
            const parent = node.parent;
            if (!parent || !parent.name.startsWith("ATXHeading") || lineTouched(ref.from)) break;
            if (ref.from === parent.from) hideWithSpaces(ref.from, ref.to);
            else {
              // A closing sequence: hide it with the spaces before it.
              let start = ref.from;
              while (start > parent.from && doc.sliceString(start - 1, start) === " ") start--;
              hide(start, ref.to);
            }
            break;
          }
          case "Emphasis": case "StrongEmphasis": case "Strikethrough": case "Highlight": case "InlineCode":
            out.push(marks[name].range(ref.from, ref.to));
            break;
          case "EmphasisMark": case "StrikethroughMark": case "HighlightMark": {
            const parent = node.parent;
            if (parent && !touches(parent.from, parent.to)) hide(ref.from, ref.to);
            break;
          }
          case "CodeMark": {
            const parent = node.parent;
            if (parent?.name === "InlineCode" && !touches(parent.from, parent.to)) hide(ref.from, ref.to);
            break;
          }
          case "Link":
            decorateLink(node);
            return true;
          case "Autolink": {
            const url = node.getChild("URL");
            if (url) out.push(marks.link.range(url.from, url.to));
            if (!touches(ref.from, ref.to)) for (const mark of node.getChildren("LinkMark")) hide(mark.from, mark.to);
            return false;
          }
          case "URL": {
            const parent = node.parent?.name;
            if (options.bareUrls !== false && parent !== "Link" && parent !== "Image" && parent !== "Autolink" && parent !== "LinkReference"
                && linkTarget(state, node) !== null) {
              out.push(marks.link.range(ref.from, ref.to));
            }
            break;
          }
          case "Image":
            if (!touches(ref.from, ref.to)) {
              const alt = imageAlt(node);
              const widget = new ImageWidget(linkTarget(state, node), doc.sliceString(alt.from, alt.to), options.resolveImage);
              out.push(Decoration.replace({ widget }).range(ref.from, ref.to));
              return false;
            }
            break;
          case "Escape":
            if (!touches(ref.from, ref.to)) hide(ref.from, ref.from + 1);
            break;
          case "ListMark": {
            const list = node.parent?.parent;
            if (list?.name === "OrderedList") out.push(marks.listNumber.range(ref.from, ref.to));
            else if (list?.name === "BulletList" && !lineTouched(ref.from)) {
              out.push(Decoration.replace({ widget: new BulletWidget(listDepth(node)) }).range(ref.from, ref.to));
            }
            break;
          }
          case "TaskMarker":
            if (!lineTouched(ref.from)) {
              const checked = /[xX]/.test(doc.sliceString(ref.from + 1, ref.from + 2));
              out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(ref.from, ref.to));
            }
            break;
          case "Blockquote":
            eachLine(ref.from, ref.to, (l) => quoteDepth.set(l, (quoteDepth.get(l) ?? 0) + 1));
            break;
          case "QuoteMark":
            // On a continuation line the mark belongs to the paragraph inside the quote.
            if (!lineTouched(ref.from)) hideWithSpaces(ref.from, ref.to);
            break;
          case "FencedCode": {
            const first = doc.lineAt(ref.from);
            const last = doc.lineAt(ref.to);
            const active = touches(first.from, last.to);
            if (!active && drawnAsBlock(state, node, renderers)) return false; // a diagram drawn by the application
            const closing = node.lastChild?.name === "CodeMark" && node.lastChild.from >= last.from && last.number > first.number;
            eachLine(ref.from, ref.to, (l) => addLine(l, "cm-live-codeblock"));
            addLine(first.from, "cm-live-codeblock-begin");
            addLine(last.from, "cm-live-codeblock-end");
            if (!active) {
              // The fence lines stay, as the block's top and bottom; the first shows the language.
              const info = node.getChild("CodeInfo");
              const language = info ? doc.sliceString(info.from, info.to).trim() : "";
              addLine(first.from, "cm-live-hidden-marks");
              if (language) out.push(Decoration.replace({ widget: new LanguageWidget(language) }).range(first.from, first.to));
              else hide(first.from, first.to);
              if (closing) {
                addLine(last.from, "cm-live-hidden-marks");
                hide(last.from, last.to);
              }
            }
            return false; // the code inside is highlighted by its language
          }
          case "CodeBlock":
            eachLine(ref.from, ref.to, (l) => addLine(l, "cm-live-codeblock"));
            return false;
          case "HardBreak": {
            // The node ends with the line break itself, which stays.
            const end = ref.to - 1;
            if (!lineTouched(ref.from)) out.push(Decoration.replace({ widget: new HardBreakWidget() }).range(ref.from, end));
            else if (doc.sliceString(ref.from, ref.from + 1) === " ") out.push(marks.hardBreakSource.range(ref.from, end));
            break;
          }
          case "FootnoteRef": case "InlineFootnote": {
            const number = footnoteNumber(state, ref.from);
            if (number === null) return name === "InlineFootnote"; // an undefined label: text
            if (!touches(ref.from, ref.to)) {
              const title = name === "InlineFootnote" ? doc.sliceString(ref.from + 2, ref.to - 1) : "";
              out.push(Decoration.replace({ widget: new FootnoteWidget(number, "ref", title) }).range(ref.from, ref.to));
              return false;
            }
            out.push(marks.muted.range(ref.from, ref.from + 2), marks.muted.range(ref.to - 1, ref.to));
            return name === "InlineFootnote";
          }
          case "FootnoteDefinition":
            eachLine(ref.from, ref.to, (l) => addLine(l, "cm-live-footnote"));
            break;
          case "FootnoteLabel": {
            const number = footnoteLabelNumber(state, doc.sliceString(ref.from + 2, ref.to - 2));
            if (number !== null && !lineTouched(ref.from)) {
              out.push(Decoration.replace({ widget: new FootnoteWidget(String(number), "label") }).range(ref.from, ref.to));
            } else {
              out.push(marks.muted.range(ref.from, ref.to));
            }
            break;
          }
          case "HorizontalRule":
            if (!lineTouched(ref.from)) out.push(Decoration.replace({ widget: new HorizontalRuleWidget() }).range(ref.from, ref.to));
            break;
          case "LinkReference":
            out.push(marks.definition.range(ref.from, ref.to));
            return false;
          case "HTMLBlock": case "CommentBlock": case "ProcessingInstructionBlock":
            return false;
          case "FrontMatter":
            if (drawnAsBlock(state, node, renderers) && !touches(doc.lineAt(ref.from).from, doc.lineAt(ref.to).to)) return false;
            eachLine(ref.from, ref.to, (l) => addLine(l, "cm-live-frontmatter"));
            return false;
          case "Paragraph":
            // Display math drawn as a block (see blocks.ts) is left to it.
            if (drawnAsBlock(state, node, renderers) && !touches(doc.lineAt(ref.from).from, doc.lineAt(ref.to).to)) return false;
            bareLinks(node);
            break;
          case "Task":
            bareLinks(node);
            break;
          case "InlineMath": case "DisplayMath": {
            const display = name === "DisplayMath";
            const oneLine = doc.lineAt(ref.from).number === doc.lineAt(ref.to).number;
            const draw = renderers.math;
            if (draw && oneLine && !touches(ref.from, ref.to)) {
              const open = display ? 2 : 1;
              const tex = doc.sliceString(ref.from + open, ref.to - open).trim();
              const widget = new RenderedWidget("math", tex, (el) => draw(tex, display, el), true);
              out.push(Decoration.replace({ widget }).range(ref.from, ref.to));
              return false;
            }
            out.push(marks.math.range(ref.from, ref.to));
            if (!touches(ref.from, ref.to)) for (const mark of node.getChildren("MathMark")) out.push(marks.muted.range(mark.from, mark.to));
            return false;
          }
        }
        return true;
      },
    });
  }

  /** Bare links in the runs of text of a block (step 2 of markdown-it's linkify, see linkify.ts). */
  function bareLinks(block: SyntaxNode): void {
    if (options.bareUrls === false) return;
    for (const link of textLinks(state, block)) out.push(marks.link.range(link.from, link.to));
  }

  function decorateLink(node: SyntaxNode): void {
    const linkMarks = node.getChildren("LinkMark");
    const open = linkMarks[0];
    const close = linkMarks.find((m) => doc.sliceString(m.from, m.to) === "]");
    if (!open || !close) return;
    // A link only if it goes somewhere: an address, or a label that the document defines.
    if (linkTarget(state, node) === null) return;
    if (close.from > open.to) out.push(marks.link.range(open.to, close.from));
    if (!touches(node.from, node.to)) {
      hide(open.from, open.to);
      hide(close.from, node.to);
    }
  }

  for (const [from, depth] of quoteDepth) addLine(from, `cm-live-quote cm-live-quote-${Math.min(depth, 4)}`);
  for (const [from, set] of lines) out.push(lineDecoration([...set].join(" ")).range(from));
  return Decoration.set(out, true);
}

/** How deep a list item's list is among bullet and ordered lists (1 for the outermost). */
function listDepth(mark: SyntaxNode): number {
  let depth = 0;
  for (let n: SyntaxNode | null = mark.parent; n; n = n.parent) if (n.name === "BulletList" || n.name === "OrderedList") depth++;
  return depth;
}

/** The text between an image's `![` and `]`. */
function imageAlt(node: SyntaxNode): { from: number; to: number } {
  const linkMarks = node.getChildren("LinkMark");
  const open = linkMarks[0];
  const close = linkMarks.find((m, i) => i > 0);
  return { from: open ? open.to : node.from, to: close ? close.from : node.from };
}
