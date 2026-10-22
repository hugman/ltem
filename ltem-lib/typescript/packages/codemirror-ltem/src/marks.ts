/**
 * Marks on cells of tables shown as tables, from the application: a class and a title for
 * each marked cell, for example cells to check after table recognition. Set them with the
 * `setLtemCellMarks` effect; the widgets put them on the cells when they draw a table, and
 * again whenever it is drawn again. A mark's table is any position in the table (for example
 * `LtemTableInfo.from`); marks follow the document as it changes.
 */

import { StateEffect, StateField } from "@codemirror/state";

/** A mark on the cell whose origin is at (row, col) of the table at `table`. */
export interface LtemCellMark {
  /** A position in the table, such as the start of its first line. */
  table: number;
  /** The grid row of the cell's origin, counting header rows from 0 (as `data-row` and markdown-it-ltem's `meta.ltem.row`). */
  row: number;
  /** The grid column of the cell's origin (as `data-col` and `meta.ltem.col`). */
  col: number;
  /** Classes to add to the cell (separated by spaces). */
  class?: string;
  /** A title for the cell (shown on hover). */
  title?: string;
}

/** Replace the marks on cells with these. */
export const setLtemCellMarks = StateEffect.define<readonly LtemCellMark[]>();

export const ltemCellMarks = StateField.define<readonly LtemCellMark[]>({
  create: () => [],
  update(marks, tr) {
    let out = marks;
    if (tr.docChanged && out.length) out = out.map((m) => ({ ...m, table: tr.changes.mapPos(m.table) }));
    for (const e of tr.effects) if (e.is(setLtemCellMarks)) out = e.value;
    return out;
  },
});
