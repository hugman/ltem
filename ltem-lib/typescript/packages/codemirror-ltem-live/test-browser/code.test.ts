/**
 * Code blocks and HTML in Markdown, highlighted by their language without the nested parse
 * of `markdown()`: the highlighting must be the same as with it.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { open, type Harness } from "./harness.ts";

let h: Harness;
before(async () => {
  h = await open();
});
after(async () => {
  await h?.browser.close();
});

const highlighting = (doc: string, nested: boolean): Promise<string[]> =>
  h.page.evaluate(([d, n]) => (window as never as { ltemTest: { highlighting(d: string, n: boolean): Promise<string[]> } }).ltemTest.highlighting(d, n), [doc, nested] as const);

const DOC = [
  "# Code", "",
  "```js", "const a = \"x\"; // note", "function f(b) { return b + 1 }", "```", "",
  "> ```js", "> let q = 'quoted';", "> q.at(-1)", "> ```", "",
  "- item", "", "  ```javascript", "  if (x) { y(); }", "  ```", "",
  "```unknown", "plain = text", "```", "",
  "<div class=\"box\">", "<b>bold</b> text", "</div>", "",
  "Inline <span title=\"t\">html</span> and <!-- c --> here.", "",
  "| 구분 | 값 |", "|---|---|", "| <i>x</i> | `y` |", "",
  "    indented code", "",
].join("\n");

test("code blocks and HTML are highlighted as with the nested parse", async () => {
  const flat = await highlighting(DOC, false);
  const nested = await highlighting(DOC, true);
  assert.deepEqual(flat, nested);
  // The code is highlighted by its language: a keyword has a class of its own.
  const line = flat[DOC.split("\n").indexOf("function f(b) { return b + 1 }")]!;
  assert.match(line, /function\|\S+/);
  assert.notEqual(line.split("  ").length, 1);
  // So is code in a block quote, after the marks.
  const quoted = flat[DOC.split("\n").indexOf("> let q = 'quoted';")]!;
  assert.match(quoted, /'quoted'\|\S+/);
});

test("highlighting follows edits of a code block", async () => {
  const doc = "```js\nlet a = 1;\n```\n";
  const before = await highlighting(doc, false);
  const after = await highlighting(doc.replace("1", "\"s\""), false);
  assert.notDeepEqual(before, after);
  assert.deepEqual(after, await highlighting(doc.replace("1", "\"s\""), true));
});
