/** Helpers shared by the tests: the tables the editor finds, and the tables the preview finds. */

import assert from "node:assert/strict";

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import markdownit from "markdown-it";
import ltemPlugin from "markdown-it-ltem";

import { analyzeTable, ltemMarkdownLanguage, NODE } from "../dist/index.js";

const md = markdownit("commonmark").use(ltemPlugin);

export interface FoundTable {
  lines: [number, number];
  model: unknown;
}

/** Tables in the editor's syntax tree: line range (0-based, end exclusive) and model. */
export function editorTables(doc: string): FoundTable[] {
  const state = EditorState.create({ doc, extensions: [ltemMarkdownLanguage()] });
  const tree = ensureSyntaxTree(state, doc.length, 10_000);
  assert.ok(tree, "the syntax tree is complete");
  const out: FoundTable[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== NODE.table) return true;
      const rows: string[] = [];
      for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (child.name === NODE.headerRow || child.name === NODE.delimiterRow || child.name === NODE.row) {
          rows.push(state.doc.sliceString(child.from, child.to));
        }
      }
      const analysis = analyzeTable(rows);
      out.push({
        lines: [state.doc.lineAt(node.from).number - 1, state.doc.lineAt(node.to).number],
        model: analysis?.table ?? null,
      });
      return false;
    },
  });
  return out;
}

/** Tables in markdown-it-ltem's token stream: line range (0-based, end exclusive). */
export function previewTables(doc: string): [number, number][] {
  return md.parse(doc, {})
    .filter((t) => t.type === "table_open")
    .map((t) => t.map as [number, number]);
}
