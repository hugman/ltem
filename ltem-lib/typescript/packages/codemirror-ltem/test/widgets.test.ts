/** The table widgets follow the document: only the blocks a change touches are looked at again. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";

import { ltemMarkdownLanguage, ltemTableWidgets } from "../dist/index.js";

function widgets(state: EditorState): { from: number; widget: object }[] {
  const out: { from: number; widget: object }[] = [];
  for (const source of state.facet(EditorView.decorations)) {
    if (typeof source === "function") continue;
    // The tables shown as tables (block widgets).
    (source as DecorationSet).between(0, state.doc.length, (from, _to, deco) => {
      if (deco.spec.block) out.push({ from, widget: deco.spec.widget });
    });
  }
  return out;
}

const T = "| a | b |\n|---|---|\n| 1 | 2 |";

test("typing away from tables keeps their widgets; a closed fence shows the table after it", () => {
  let state = EditorState.create({ doc: `Intro\n\n${T}\n\n\`\`\`\ncode\n\n${T}\n\nEnd`, selection: { anchor: 0 }, extensions: [ltemMarkdownLanguage(), ltemTableWidgets()] });
  const update = (spec: TransactionSpec): void => {
    state = state.update(spec).state;
  };
  // The second table is inside an unclosed fence: only the first is a table.
  assert.equal(widgets(state).length, 1);
  const first = widgets(state)[0].widget;
  update({ changes: { from: 5, insert: " text" }, selection: { anchor: 10 } });
  assert.equal(widgets(state)[0].widget, first);
  // Close the fence: the table after it is a table again.
  const at = state.doc.toString().indexOf("code") + 4;
  update({ changes: { from: at, insert: "\n```" } });
  assert.equal(widgets(state).length, 2);
  // Into the second table and out again.
  const second = state.doc.toString().lastIndexOf("| 1");
  update({ selection: EditorSelection.cursor(second + 2) });
  assert.equal(widgets(state).length, 1);
  update({ selection: EditorSelection.cursor(state.doc.length) });
  assert.equal(widgets(state).length, 2);
  // Open the fence again: the second table is code.
  update({ changes: { from: state.doc.toString().indexOf("\n```", at - 2), to: state.doc.toString().indexOf("\n```", at - 2) + 4 } });
  assert.equal(widgets(state).length, 1);
});
