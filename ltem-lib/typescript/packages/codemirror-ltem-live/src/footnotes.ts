/**
 * The footnotes of a document and their numbers, as markdown-it-footnote numbers them: in
 * the order of their first reference (an inline footnote takes the next number where it
 * is); a footnote referred to again shows its number and how many times it was referred to
 * before (`[1:1]`). A reference to a label the document does not define is no footnote.
 *
 * The references and definitions are kept in a state field, updated only where a change
 * happened, so that numbering costs little in a large document.
 */

import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState } from "@codemirror/state";
import { changedRegions } from "codemirror-ltem";

interface Reference {
  from: number;
  to: number;
  /** The label, or null for an inline footnote. */
  label: string | null;
}

interface Definition {
  from: number;
  to: number;
  label: string;
}

interface Numbers {
  /** What each reference shows, by its start: "1", "1:1"; absent for an undefined label. */
  refs: Map<number, string>;
  /** The number of each referenced label. */
  labels: Map<string, number>;
}

class FootnoteIndex {
  private numbers: Numbers | null = null;

  constructor(readonly refs: readonly Reference[], readonly defs: readonly Definition[]) {}

  get empty(): boolean {
    return this.refs.length === 0 && this.defs.length === 0;
  }

  numbered(): Numbers {
    if (this.numbers) return this.numbers;
    const defined = new Set(this.defs.map((d) => d.label));
    const refs = new Map<number, string>();
    const labels = new Map<string, number>();
    const counts = new Map<string, number>();
    let next = 1;
    for (const r of this.refs) {
      if (r.label === null) {
        refs.set(r.from, String(next++));
      } else if (defined.has(r.label)) {
        let id = labels.get(r.label);
        if (id === undefined) labels.set(r.label, (id = next++));
        const count = counts.get(r.label) ?? 0;
        counts.set(r.label, count + 1);
        refs.set(r.from, count ? `${id}:${count}` : String(id));
      }
    }
    return (this.numbers = { refs, labels });
  }
}

/** The footnote references and definitions in parts of the document. */
function scan(state: EditorState, regions: readonly { from: number; to: number }[]): { refs: Reference[]; defs: Definition[] } {
  const refs: Reference[] = [];
  const defs: Definition[] = [];
  const seen = new Set<number>();
  const doc = state.doc;
  for (const region of regions) {
    syntaxTree(state).iterate({ from: region.from, to: region.to, enter(n) {
      if (n.name === "FootnoteRef" || n.name === "InlineFootnote") {
        if (!seen.has(n.from)) {
          seen.add(n.from);
          refs.push({ from: n.from, to: n.to, label: n.name === "FootnoteRef" ? doc.sliceString(n.from + 2, n.to - 1) : null });
        }
        return n.name === "InlineFootnote";
      }
      if (n.name === "FootnoteLabel" && !seen.has(n.from)) {
        seen.add(n.from);
        defs.push({ from: n.from, to: n.to, label: doc.sliceString(n.from + 2, n.to - 2) });
      }
      return true;
    } });
  }
  return { refs, defs };
}

const byPosition = (a: { from: number }, b: { from: number }): number => a.from - b.from;

export const footnoteIndex = StateField.define<FootnoteIndex>({
  create(state) {
    const { refs, defs } = scan(state, [{ from: 0, to: state.doc.length }]);
    return new FootnoteIndex(refs.sort(byPosition), defs.sort(byPosition));
  },
  update(index, tr) {
    if (tr.docChanged) {
      const regions = changedRegions(tr);
      const outside = (e: { from: number; to: number }): boolean => !regions.some((r) => e.from <= r.to && e.to >= r.from);
      const map = <T extends { from: number; to: number }>(e: T): T => ({ ...e, from: tr.changes.mapPos(e.from, 1), to: tr.changes.mapPos(e.to, -1) });
      const found = scan(tr.state, regions);
      const refs = [...index.refs.map(map).filter(outside), ...found.refs].sort(byPosition);
      const defs = [...index.defs.map(map).filter(outside), ...found.defs].sort(byPosition);
      if (!refs.length && !defs.length && index.empty) return index;
      return new FootnoteIndex(refs, defs);
    }
    if (syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      const { refs, defs } = scan(tr.state, [{ from: 0, to: tr.state.doc.length }]);
      return refs.length || defs.length || !index.empty ? new FootnoteIndex(refs.sort(byPosition), defs.sort(byPosition)) : index;
    }
    return index;
  },
});

/** What the footnote reference (or inline footnote) at `from` shows, or null if it is no footnote. */
export function footnoteNumber(state: EditorState, from: number): string | null {
  return state.field(footnoteIndex, false)?.numbered().refs.get(from) ?? null;
}

/** The number of a defined label, or null if nothing refers to it. */
export function footnoteLabelNumber(state: EditorState, label: string): number | null {
  return state.field(footnoteIndex, false)?.numbered().labels.get(label) ?? null;
}

/** Where a label is defined, or null. */
export function footnoteDefinition(state: EditorState, label: string): number | null {
  return state.field(footnoteIndex, false)?.defs.find((d) => d.label === label)?.from ?? null;
}

/** Where a label is first referred to, or null. */
export function footnoteFirstReference(state: EditorState, label: string): number | null {
  return state.field(footnoteIndex, false)?.refs.find((r) => r.label === label)?.from ?? null;
}
