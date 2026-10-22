/** How LTEM tables look in the editor: line decorations, highlighting and theme. */

import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range as DecoRange } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

import { pipePositions } from "./analysis.js";
import { NODE, holdsTables, ltemTags } from "./syntax.js";

const lineClass = {
  [NODE.headerRow]: Decoration.line({ class: "cm-ltem-row cm-ltem-header" }),
  [NODE.delimiterRow]: Decoration.line({ class: "cm-ltem-row cm-ltem-delimiter" }),
  [NODE.row]: Decoration.line({ class: "cm-ltem-row cm-ltem-body" }),
} as const;
const pendingLine = Decoration.line({ class: "cm-ltem-row cm-ltem-pending" });
const pipeMark = Decoration.mark({ class: "cm-ltem-pipe" });

interface Range { from: number; to: number }

/** The tables, row lines and pipes in the visible part of the document. */
function rowLines(state: EditorState, ranges: readonly Range[]): { tables: Range[]; lines: { from: number; deco: Decoration }[]; pipes: number[] } {
  const tables: Range[] = [];
  const lines: { from: number; deco: Decoration }[] = [];
  const pipes: number[] = [];
  const tree = syntaxTree(state);
  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name === NODE.table) {
          tables.push({ from: node.from, to: node.to });
          return true;
        }
        const deco = lineClass[node.name as keyof typeof lineClass];
        if (deco) {
          lines.push({ from: state.doc.lineAt(node.from).from, deco });
          if (node.name !== NODE.delimiterRow) {
            for (const p of pipePositions(state.doc.sliceString(node.from, node.to))) pipes.push(node.from + p);
          }
          return false;
        }
        return holdsTables(node.type);
      },
    });
  }
  return { tables, lines, pipes };
}

/**
 * Line decorations for table rows. Two kinds of tolerance while typing:
 *
 * - During an IME composition the decorations are only mapped, never rebuilt, so the
 *   composition is not disturbed.
 * - When an edit breaks the table the cursor is in (for example while a header row has a
 *   cell more than the delimiter row), its lines keep a table look, marked as pending,
 *   until the cursor leaves them or the lines form a table again.
 */
class TableLines {
  decorations: DecorationSet;
  /** The table that held the cursor at the last build. */
  private cursorTable: Range | null = null;
  /** The visible tables at the last build, and whether a broken table is shown as pending. */
  private tables: Range[] = [];
  private pending = false;

  constructor(view: EditorView) {
    this.decorations = this.build(view, null);
  }

  update(update: ViewUpdate): void {
    if (update.view.composing) {
      this.decorations = this.decorations.map(update.changes);
      if (this.cursorTable && update.docChanged) this.cursorTable = mapRange(this.cursorTable, update);
      return;
    }
    if (update.selectionSet && !update.docChanged && !update.viewportChanged && !this.pending
        && syntaxTree(update.startState) === syntaxTree(update.state)) {
      // The cursor moved: the decorations stay, only the table it is in is noted.
      const head = update.state.selection.main.head;
      this.cursorTable = this.tables.find((t) => head >= t.from && head <= t.to) ?? null;
      return;
    }
    if (update.docChanged || update.viewportChanged || update.selectionSet
        || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      const previous = this.cursorTable && update.docChanged ? mapRange(this.cursorTable, update) : this.cursorTable;
      this.decorations = this.build(update.view, previous);
    }
  }

  private build(view: EditorView, previous: Range | null): DecorationSet {
    const state = view.state;
    const head = state.selection.main.head;
    const { tables, lines, pipes } = rowLines(state, view.visibleRanges);
    this.tables = tables;
    this.cursorTable = tables.find((t) => head >= t.from && head <= t.to) ?? null;
    let pending: Range | null = null;
    if (!this.cursorTable && previous && head >= previous.from && head <= previous.to
        && !tables.some((t) => t.from < previous.to && t.to > previous.from)) {
      pending = previous;
      this.cursorTable = previous;
    }
    this.pending = pending !== null;
    const all = [...lines];
    if (pending) {
      for (let pos = pending.from; pos <= pending.to;) {
        const line = state.doc.lineAt(pos);
        all.push({ from: line.from, deco: pendingLine });
        pos = line.to + 1;
      }
    }
    const ranges: DecoRange<Decoration>[] = [];
    const seen = new Set<number>();
    for (const { from, deco } of all) {
      if (seen.has(from)) continue;
      seen.add(from);
      ranges.push(deco.range(from));
    }
    for (const p of pipes) ranges.push(pipeMark.range(p, p + 1));
    return Decoration.set(ranges, true);
  }
}

function mapRange(range: Range, update: ViewUpdate): Range {
  return { from: update.changes.mapPos(range.from, -1), to: update.changes.mapPos(range.to, 1) };
}

export const ltemTableLines = ViewPlugin.fromClass(TableLines, { decorations: (v) => v.decorations });

/** Colours for the parts of a table, readable on light and dark backgrounds. */
export const ltemHighlightStyle = HighlightStyle.define([
  { tag: ltemTags.delimiter, color: "#8a8f98" },
  { tag: ltemTags.header, fontWeight: "bold" },
  { tag: ltemTags.marker, color: "#b04fc4", fontWeight: "bold" },
  { tag: ltemTags.attribute, color: "#c18401" },
  { tag: ltemTags.lineBreak, color: "#2b8fd6", fontWeight: "bold" },
]);

export function ltemTheme(options: { monospace?: boolean } = {}): Extension {
  return EditorView.baseTheme({
    ".cm-ltem-row": options.monospace === false ? {} : {
      fontFamily: "ui-monospace, 'D2Coding', 'Nanum Gothic Coding', 'Cascadia Mono', Consolas, monospace",
    },
    "&light .cm-ltem-header": { backgroundColor: "rgba(80, 120, 200, 0.07)" },
    "&dark .cm-ltem-header": { backgroundColor: "rgba(120, 160, 255, 0.10)" },
    "&light .cm-ltem-body": { backgroundColor: "rgba(0, 0, 0, 0.015)" },
    "&dark .cm-ltem-body": { backgroundColor: "rgba(255, 255, 255, 0.03)" },
    ".cm-ltem-pipe": { color: "#8a8f98" },
    ".cm-ltem-pending": { boxShadow: "inset 3px 0 0 rgba(200, 140, 0, 0.6)" },
    "&light .cm-ltem-selectedCell": { backgroundColor: "rgba(60, 130, 230, 0.16)" },
    "&dark .cm-ltem-selectedCell": { backgroundColor: "rgba(100, 160, 255, 0.22)" },
    ".cm-ltem-widget": { position: "relative", padding: "4px 0", cursor: "text", overflowX: "auto" },
    // Painted apart from what is around it (the edit box over a cell), so that typing in the
    // box does not paint the table again.
    ".cm-ltem-widget table": { borderCollapse: "collapse", contain: "paint", overflowClipMargin: "2px" },
    ".cm-ltem-widget table.cm-ltem-partial": { tableLayout: "fixed" },
    ".cm-ltem-widget .cm-ltem-gap td": { padding: "0", border: "none" },
    ".cm-ltem-widget .cm-ltem-partial td, .cm-ltem-widget .cm-ltem-partial th": { overflowWrap: "anywhere" },
    ".cm-ltem-widget th, .cm-ltem-widget td": { border: "1px solid #c6cbd1", padding: "2px 8px", verticalAlign: "top" },
    "&light .cm-ltem-widget th": { backgroundColor: "rgba(80, 120, 200, 0.08)" },
    "&dark .cm-ltem-widget th": { backgroundColor: "rgba(120, 160, 255, 0.12)" },
    "&dark .cm-ltem-widget th, &dark .cm-ltem-widget td": { borderColor: "#444c56" },
    "&light .cm-ltem-widget .cm-ltem-selected": { backgroundColor: "rgba(60, 130, 230, 0.18)" },
    "&dark .cm-ltem-widget .cm-ltem-selected": { backgroundColor: "rgba(100, 160, 255, 0.25)" },
    ".cm-ltem-keys": {
      position: "absolute", opacity: "0", padding: "2px 8px", border: "none", resize: "none", overflow: "hidden",
      font: "inherit", whiteSpace: "pre", zIndex: "2", pointerEvents: "none",
    },
    ".cm-ltem-keys.cm-ltem-keys-composing": { opacity: "1", outline: "2px solid #4a8fe0" },
    "&light .cm-ltem-keys": { backgroundColor: "#ffffff", color: "#1f2328" },
    "&dark .cm-ltem-keys": { backgroundColor: "#22272e", color: "#e6edf3" },
    ".cm-ltem-widget.cm-ltem-dragging": { userSelect: "none" },
    // Tables shown as tables sit in a frame, with room at their left for a handle to their
    // source (`--cm-ltem-gutter`); their source, while shown, gets the same room, for the
    // handle back to the table.
    ".cm-ltem-frame": { position: "relative" },
    "&.cm-ltem-handles .cm-ltem-frame": { paddingLeft: "var(--cm-ltem-gutter, 22px)" },
    "&.cm-ltem-handles .cm-line.cm-ltem-row": { paddingLeft: "calc(6px + var(--cm-ltem-gutter, 22px))" },
    ".cm-ltem-handle": {
      position: "absolute", width: "18px", height: "18px", padding: "0", display: "flex", alignItems: "center",
      justifyContent: "center", borderRadius: "4px", border: "1px solid transparent", cursor: "pointer",
      background: "transparent", zIndex: "2",
    },
    "&light .cm-ltem-handle": { color: "#6e7781" },
    "&dark .cm-ltem-handle": { color: "#8b949e" },
    "&light .cm-ltem-handle:hover": { backgroundColor: "rgba(0, 0, 0, 0.06)", borderColor: "#d0d7de", color: "#24292f" },
    "&dark .cm-ltem-handle:hover": { backgroundColor: "rgba(255, 255, 255, 0.08)", borderColor: "#444c56", color: "#e6edf3" },
    ".cm-ltem-frame > .cm-ltem-source-button": {
      left: "calc(var(--cm-ltem-gutter, 22px) - 20px)", top: "6px", opacity: "0", transition: "opacity 0.12s",
    },
    ".cm-ltem-frame:hover > .cm-ltem-source-button, .cm-ltem-frame > .cm-ltem-source-button:focus-visible": { opacity: "1" },
    ".cm-ltem-handle-layer .cm-ltem-table-button": { opacity: "0.7" },
    ".cm-ltem-handle-layer .cm-ltem-table-button:hover": { opacity: "1" },
    ".cm-ltem-widget .cm-ltem-editing": {
      position: "absolute", zIndex: "3", boxSizing: "border-box", whiteSpace: "pre-wrap", overflowWrap: "anywhere",
      cursor: "text", outline: "2px solid #4a8fe0", outlineOffset: "-2px", willChange: "transform",
      fontFamily: "ui-monospace, 'D2Coding', 'Nanum Gothic Coding', 'Cascadia Mono', Consolas, monospace",
    },
    "&light .cm-ltem-widget .cm-ltem-editing": { backgroundColor: "#ffffff" },
    "&dark .cm-ltem-widget .cm-ltem-editing": { backgroundColor: "#22272e" },
  });
}

/**
 * `ltemHighlightStyle` as a fallback highlighter, like CodeMirror's default highlight style:
 * it applies together with the default style, and steps aside when the editor has its own
 * highlight style. Such an editor styles the LTEM tags through their parent tags, or adds
 * `syntaxHighlighting(ltemHighlightStyle)` itself.
 */
export const ltemHighlighting: Extension = syntaxHighlighting(ltemHighlightStyle, { fallback: true });
