/** Table actions for menus: what they offer for a cell or a range, and what they do. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { cellRange, ltemCellTargetAt, ltemMarkdownLanguage, ltemTableActions, tableAt, type LtemCellTarget } from "../dist/index.js";

const DOC = "Text\n\n| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\nEnd\n";

/** A stand-in for the editor view: a state that dispatches update. */
function fakeView(doc: string, anchor = 0, head = anchor): EditorView & { state: EditorState } {
  let state = EditorState.create({ doc, selection: EditorSelection.range(anchor, head), extensions: [ltemMarkdownLanguage()] });
  ensureSyntaxTree(state, doc.length, 10_000);
  const view = {
    get state() { return state; },
    dispatch(spec: TransactionSpec) { state = state.update(spec).state; ensureSyntaxTree(state, state.doc.length, 10_000); },
    focus() {},
  };
  return view as never;
}

function target(view: EditorView, top: number, left: number, bottom = top, right = left, widget = false): LtemCellTarget {
  const table = tableAt(view.state, DOC.indexOf("| A"))!;
  return { table, range: cellRange(table.analysis.table, { row: top, col: left }, { row: bottom, col: right }), cell: { row: bottom, col: right }, widget };
}

const run = (view: EditorView, t: LtemCellTarget, id: string): boolean => ltemTableActions(t).find((a) => a.id === id)!.run(view);

describe("table actions", () => {
  test("for one cell: merging with neighbours; moves only where they can go", () => {
    const view = fakeView(DOC);
    const actions = ltemTableActions(target(view, 1, 0));
    const state = Object.fromEntries(actions.map((a) => [a.id, a.enabled]));
    assert.equal(state.mergeRight, true);
    assert.equal(state.mergeCells, undefined);
    assert.equal(state.moveRowUp, false); // not into the header
    assert.equal(state.moveRowDown, true);
    assert.equal(state.moveColumnLeft, false);
    assert.equal(state.splitCells, false);
    assert.equal(state.editSource, undefined); // only where the table is shown as a table
    assert.ok(actions.find((a) => a.id === "alignNone")!.checked);
  });

  test("for a range: merge, delete its rows and columns, align its columns", () => {
    let view = fakeView(DOC);
    assert.ok(ltemTableActions(target(view, 1, 0, 2, 1)).some((a) => a.id === "mergeCells" && a.enabled));
    assert.ok(run(view, target(view, 1, 0, 2, 1), "mergeCells"));
    assert.match(view.state.doc.toString(), /\| 1 \\\\ 2 \\\\ 4 \\\\ 5 \| << +\| 3 +\|\n\| \^\^ +\| << +\| 6 +\|/);
    view = fakeView(DOC);
    run(view, target(view, 1, 0, 2, 0), "deleteRows");
    assert.equal(ltemTableActions(target(fakeView(DOC), 0, 0, 2, 2)).find((a) => a.id === "deleteRows")!.enabled, false);
    assert.match(view.state.doc.toString(), /\| A +\| B +\| C +\|\n\| -+ \| -+ \| -+ \|\n\n/);
    view = fakeView(DOC);
    run(view, target(view, 1, 1, 2, 2), "alignCenter");
    assert.match(view.state.doc.toString(), /\| --- \| :-: \| :-: \|/);
  });

  test("in the source the cursor goes to the cell; on a shown table the selection stays", () => {
    let view = fakeView(DOC, DOC.indexOf("| 5") + 3);
    run(view, target(view, 2, 1), "insertRowBelow");
    const head = view.state.selection.main.head;
    assert.equal(view.state.doc.lineAt(head).text, "|     |     |     |");
    // At the start of the new cell, where typed text goes (not after its padding).
    assert.equal(head - view.state.doc.lineAt(head).from, "|     | ".length);
    view = fakeView(DOC, 0);
    const chosen: unknown[] = [];
    const t = { ...target(view, 2, 1, 2, 1, true), focusAfter: (cell: unknown) => chosen.push(cell) };
    run(view, t, "insertRowBelow");
    assert.equal(view.state.selection.main.head, 0);
    assert.deepEqual(chosen, [{ row: 3, col: 1 }]);
  });

  test("labels in Korean", () => {
    const view = fakeView(DOC);
    const labels = ltemTableActions(target(view, 1, 0, 2, 1), { messages: "ko" }).map((a) => a.label);
    assert.ok(labels.includes("셀 병합") && labels.includes("위에 행 넣기") && labels.includes("열 지우기"), labels.join(", "));
  });

  test("the target at a position: the selected cells when it is among them", () => {
    const view = fakeView(DOC, DOC.indexOf("| 2") + 2, DOC.indexOf("| 6") + 3);
    assert.deepEqual(ltemCellTargetAt(view, DOC.indexOf("| 5") + 2)!.range, { top: 1, left: 1, bottom: 2, right: 2 });
    assert.deepEqual(ltemCellTargetAt(view, DOC.indexOf("| 4") + 2)!.range, { top: 2, left: 0, bottom: 2, right: 0 });
    assert.equal(ltemCellTargetAt(view, 1), null);
  });
});
