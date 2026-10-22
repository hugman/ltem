/**
 * Tables whose source is shown although the cursor alone would not show it: with the
 * widget option `revealSource: "altClick"`, a table stays shown as a table with the cursor
 * in it, and only an Alt- or Ctrl-click (or the table menu's Edit source) shows its source,
 * until the cursor leaves it.
 */

import { StateEffect, StateField, type EditorState } from "@codemirror/state";

/** Show the source of the table from `from` to `to` (whole lines), while the cursor is in it. */
export const revealTableSource = StateEffect.define<{ from: number; to: number }>();

/** Stop showing the source of the tables in this range (whole lines): they are shown as tables again. */
export const concealTableSource = StateEffect.define<{ from: number; to: number }>();

export const revealedTables = StateField.define<readonly { from: number; to: number }[]>({
  create: () => [],
  update(value, tr) {
    let out = value;
    if (tr.docChanged) out = out.map((r) => ({ from: tr.changes.mapPos(r.from, -1), to: tr.changes.mapPos(r.to, 1) }));
    for (const e of tr.effects) {
      if (e.is(revealTableSource)) out = [...out.filter((r) => r.from !== e.value.from), e.value];
      if (e.is(concealTableSource)) out = out.filter((r) => r.to < e.value.from || r.from > e.value.to);
    }
    // A table stays revealed while the cursor is in it.
    if (out.length && (tr.selection || tr.docChanged)) {
      out = out.filter((r) => tr.state.selection.ranges.some((s) => s.to >= r.from && s.from <= r.to));
    }
    return out;
  },
});

/** Whether the source of the table from `from` to `to` was revealed. */
export function isRevealed(state: EditorState, from: number, to: number): boolean {
  return state.field(revealedTables, false)?.some((r) => r.from <= to && r.to >= from) ?? false;
}
