/**
 * Ranges of cells in the source: a selection over two or more cells of a table is shown as
 * a range of cells, and keys act on the cells rather than on the text between them, so
 * that the table keeps its shape.
 *
 * - The cells of the range are marked.
 * - Backspace and Delete empty the cells; Enter and Shift-Enter go into the selection's
 *   cell rather than replacing the cells with a line break.
 * - Typing, or starting an IME composition, first collapses the selection into the
 *   selection's cell, so that the text goes into that cell instead of replacing the rows.
 *   An IME announces itself with a key-down (key code 229) on most systems; a composition
 *   that starts without one (some on-screen keyboards) is caught when it starts, before
 *   the browser replaces the selection, by moving the browser's selection itself.
 */

import { Prec, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";

import { clearSelectedCells, ltemCellRanges, selectedCells } from "./commands.js";
import { sourceCellAt } from "./analysis.js";
import { selectionOf } from "./dom.js";

const selectedMark = Decoration.mark({ class: "cm-ltem-selectedCell" });

function decorations(view: EditorView): DecorationSet {
  const sel = selectedCells(view.state);
  if (!sel) return Decoration.none;
  const { table, range } = sel;
  const marks: Range<Decoration>[] = [];
  const visible = view.visibleRanges;
  for (const row of table.analysis.rows) {
    if (row.row < range.top || row.row > range.bottom) continue;
    const start = table.lineStarts[row.line];
    // Only the rows on screen are marked, so that a range in a large table costs little.
    if (!visible.some((v) => start <= v.to && start + table.analysis.lines[row.line].length >= v.from)) continue;
    row.cells.forEach((cell, k) => {
      if (cell.row !== row.row || cell.col < range.left || cell.col > range.right) return;
      const b = row.bounds[k];
      if (b.to > b.from) marks.push(selectedMark.range(start + b.from, start + b.to));
    });
  }
  return Decoration.set(marks, true);
}

/**
 * Collapse a range of cells into the selection's cell, at the end of its text. With `dom`,
 * the browser's selection is moved at once too, for an input that has already started.
 */
function collapse(view: EditorView, dom = false): boolean {
  const sel = selectedCells(view.state);
  if (!sel) return false;
  const found = sourceCellAt(sel.table.analysis, sel.active.row, sel.active.col);
  const head = found ? sel.table.lineStarts[found.row.line] + found.cell.end : view.state.selection.main.head;
  if (dom) {
    const { node, offset } = view.domAtPos(head);
    selectionOf(view)?.collapse(node, offset);
  }
  view.dispatch({ selection: { anchor: head }, userEvent: "select.ltem" });
  return true;
}

/** Ranges of cells in the source. Included in `ltem()`. */
export function ltemCellSelection(): Extension {
  return [
    ltemCellRanges.of(true),
    ViewPlugin.fromClass(class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorations(view);
      }
      update(update: ViewUpdate): void {
        if (update.selectionSet || update.docChanged || update.viewportChanged) this.decorations = decorations(update.view);
      }
    }, { decorations: (v) => v.decorations }),
    Prec.highest(keymap.of([
      { key: "Backspace", run: clearSelectedCells },
      { key: "Delete", run: clearSelectedCells },
      { key: "Enter", run: (view) => collapse(view), shift: (view) => collapse(view) },
    ])),
    // An observer, so that it runs before CodeMirror's own, which deletes a selection over
    // several lines when a composition starts; the browser then puts the composition where
    // the selection is after this event.
    EditorView.domEventObservers({
      compositionstart(_event, view) {
        collapse(view, true);
      },
    }),
    EditorView.domEventHandlers({
      keydown(event, view) {
        const typing = event.keyCode === 229 || (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey);
        if (typing) collapse(view);
        return false;
      },
      beforeinput(event, view) {
        if (event.inputType.startsWith("insert") && event.inputType !== "insertFromPaste" && selectedCells(view.state)) {
          collapse(view);
          if (event.inputType === "insertText" && event.data) {
            event.preventDefault();
            view.dispatch(view.state.replaceSelection(event.data), { userEvent: "input.type" });
            return true;
          }
        }
        return false;
      },
    }),
  ];
}
