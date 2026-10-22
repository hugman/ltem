/** The Markdown language: inline content that extensions add is read in table cells. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

import { ltemMarkdownLanguage } from "../dist/index.js";

/** The names of the nodes of a document's tree, in order. */
function nodes(doc: string, config: Parameters<typeof ltemMarkdownLanguage>[0] = {}): string[] {
  const state = EditorState.create({ doc, extensions: [ltemMarkdownLanguage(config)] });
  const out: string[] = [];
  ensureSyntaxTree(state, doc.length, 5000)!.iterate({ enter: (n) => void out.push(n.name) });
  return out;
}

test("inline content that an extension adds is read in table cells", () => {
  const dollars: MarkdownConfig = {
    defineNodes: ["Money"],
    parseInline: [{
      name: "Money",
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== 36) return -1;
        const end = cx.slice(pos + 1, cx.end).indexOf("$");
        return end < 1 ? -1 : cx.addElement(cx.elt("Money", pos, pos + end + 2));
      },
    }],
  };
  assert.ok(nodes("| a | b |\n|---|---|\n| $x$ | 1 |\n", { extensions: [dollars] }).includes("Money"));
});
