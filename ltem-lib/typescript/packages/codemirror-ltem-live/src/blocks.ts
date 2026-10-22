/**
 * Blocks drawn by the application: Mermaid diagrams (code blocks of language `mermaid`),
 * display math on lines of its own (`$$ ... $$`) and front matter. Each is drawn where the
 * selection is not, by a function the application gives; the selection in it shows its
 * source. The blocks span lines, so they are a state field (block decorations), updated
 * only where a change or a cursor move happened.
 */

import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { changedRegions, holdsTables, selectionLines } from "codemirror-ltem";

/** Draws a block's source into an element; may finish later (a promise). */
export type BlockRenderer = (source: string, element: HTMLElement) => void | Promise<void>;
/** Draws TeX math into an element, inline or as display math. */
export type MathRenderer = (tex: string, display: boolean, element: HTMLElement) => void | Promise<void>;

export interface Renderers {
  math?: MathRenderer;
  mermaid?: BlockRenderer;
  frontMatter?: BlockRenderer;
}

/** A block drawn by the application. A click on it shows its source. */
export class RenderedWidget extends WidgetType {
  constructor(readonly kind: "math" | "mermaid" | "frontmatter", readonly source: string, readonly draw: (element: HTMLElement) => void | Promise<void>, readonly inline = false) {
    super();
  }

  override eq(other: RenderedWidget): boolean {
    return other.kind === this.kind && other.source === this.source && other.inline === this.inline;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement(this.inline ? "span" : "div");
    element.className = `cm-live-rendered cm-live-rendered-${this.kind}`;
    const failed = (): void => {
      element.classList.add("cm-live-rendered-error");
      element.textContent = this.source;
    };
    try {
      const done = this.draw(element);
      if (done && typeof (done as Promise<void>).then === "function") {
        (done as Promise<void>).then(() => view.requestMeasure(), failed);
      }
    } catch {
      failed();
    }
    if (!this.inline) {
      element.addEventListener("mousedown", (event) => {
        event.preventDefault();
        view.dispatch({ selection: { anchor: view.posAtDOM(element) }, scrollIntoView: true, userEvent: "select.pointer" });
        view.focus();
      });
    }
    return element;
  }

  override ignoreEvent(): boolean {
    return !this.inline;
  }

  override get estimatedHeight(): number {
    return this.inline ? -1 : 80;
  }
}

/**
 * The text from `from` to `to` without the marks of block quotes around it (`>` and the
 * space after it), as markdown-it reads the text of a block quote.
 */
export function withoutQuoteMarks(state: EditorState, from: number, to: number): string {
  let out = "";
  let pos = from;
  syntaxTree(state).iterate({ from, to, enter: (n) => {
    if (n.name !== "QuoteMark" || n.from < pos || n.to > to) return;
    out += state.doc.sliceString(pos, n.from);
    pos = Math.min(to, state.doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to);
  } });
  return out + state.doc.sliceString(pos, to);
}

/** The source of a block to draw, and its widget, or null if it is not one to draw. */
function blockFor(state: EditorState, node: SyntaxNode, renderers: Renderers): RenderedWidget | null {
  const doc = state.doc;
  if (node.name === "FencedCode" && renderers.mermaid) {
    const info = node.getChild("CodeInfo");
    if (!info || doc.sliceString(info.from, info.to).trim().toLowerCase() !== "mermaid") return null;
    // The code text pieces joined: lines in a block quote are pieces, without the marks.
    const source = node.getChildren("CodeText").map((c) => doc.sliceString(c.from, c.to)).join("");
    const draw = renderers.mermaid;
    return new RenderedWidget("mermaid", source, (el) => draw(source, el));
  }
  if (node.name === "FrontMatter" && renderers.frontMatter) {
    const content = node.getChild("FrontMatterContent");
    const source = content ? doc.sliceString(content.from, content.to) : "";
    const draw = renderers.frontMatter;
    return new RenderedWidget("frontmatter", source, (el) => draw(source, el));
  }
  if (node.name === "Paragraph" && renderers.math) {
    // Display math alone in its paragraph, over several lines.
    const math = node.firstChild;
    if (!math || math.name !== "DisplayMath" || math.from !== node.from || math.to !== node.to) return null;
    if (doc.lineAt(node.from).number === doc.lineAt(node.to).number) return null;
    const source = withoutQuoteMarks(state, math.from + 2, math.to - 2).trim();
    const draw = renderers.math;
    return new RenderedWidget("math", source, (el) => draw(source, true, el));
  }
  return null;
}

/** Whether a node is drawn as a block (see `blockFor`), so that Live Preview does not decorate its lines. */
export function drawnAsBlock(state: EditorState, node: SyntaxNode, renderers: Renderers): boolean {
  return blockFor(state, node, renderers) !== null;
}

function rebuild(state: EditorState, renderers: Renderers, decorations: DecorationSet, regions: { from: number; to: number }[]): DecorationSet {
  if (!regions.length) return decorations;
  const add: Range<Decoration>[] = [];
  const seen = new Set<number>();
  const selection = state.selection.ranges;
  for (const region of regions) {
    syntaxTree(state).iterate({ from: region.from, to: region.to, enter(n) {
      if (n.name !== "FencedCode" && n.name !== "FrontMatter" && n.name !== "Paragraph") return holdsTables(n.type);
      if (seen.has(n.from)) return false;
      seen.add(n.from);
      const from = state.doc.lineAt(n.from).from;
      const to = state.doc.lineAt(n.to).to;
      if (selection.some((r) => r.to >= from && r.from <= to)) return false;
      const widget = blockFor(state, n.node, renderers);
      if (widget) add.push(Decoration.replace({ widget, block: true }).range(from, to));
      return false;
    } });
  }
  return decorations.update({ filter: (from, to) => !regions.some((r) => from <= r.to && to >= r.from), add, sort: true });
}

/** Blocks drawn by the application's renderers (none if it gives none of mermaid, frontMatter or math). */
export function renderedBlocks(renderers: Renderers): Extension {
  if (!renderers.mermaid && !renderers.frontMatter && !renderers.math) return [];
  return StateField.define<DecorationSet>({
    create: (state) => rebuild(state, renderers, Decoration.none, [{ from: 0, to: state.doc.length }]),
    update(decorations, tr) {
      if (tr.docChanged) return rebuild(tr.state, renderers, decorations.map(tr.changes), changedRegions(tr));
      if (syntaxTree(tr.state) !== syntaxTree(tr.startState)) return rebuild(tr.state, renderers, Decoration.none, [{ from: 0, to: tr.state.doc.length }]);
      if (tr.selection) return rebuild(tr.state, renderers, decorations, [...selectionLines(tr.startState), ...selectionLines(tr.state)]);
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
