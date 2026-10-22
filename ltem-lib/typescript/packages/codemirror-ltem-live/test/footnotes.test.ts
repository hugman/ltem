/** Footnotes (as markdown-it-footnote), line breaks at the ends of lines, and nested block quotes in Live Preview. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { ltemMarkdownLanguage } from "codemirror-ltem";

import { footnoteDefinition, footnoteFirstReference, footnoteIndex, footnoteNumber, footnoteSyntax, liveDecorations } from "../dist/index.js";

function state(doc: string, anchor = doc.length): EditorState {
  const s = EditorState.create({ doc, selection: { anchor }, extensions: [ltemMarkdownLanguage({ extensions: [footnoteSyntax] }), footnoteIndex] });
  ensureSyntaxTree(s, doc.length, 10_000);
  // The index was built from the tree of the first transaction; build it from the whole tree.
  return s.update({}).state;
}

function decorations(s: EditorState): string[] {
  const out: string[] = [];
  liveDecorations(s, [{ from: 0, to: s.doc.length }]).between(0, s.doc.length, (a, b, d) => {
    const spec = d.spec as { widget?: { constructor: { name: string }; text?: string }; class?: string };
    const what = spec.widget ? `${spec.widget.constructor.name}${spec.widget.text ? `(${spec.widget.text})` : ""}` : spec.class ?? "hidden";
    out.push(`${JSON.stringify(s.doc.sliceString(a, b))}: ${what}`);
  });
  return out;
}

const DOC = "A[^b] and^[inline] again[^b] then[^a] none[^zz].\n\n[^a]: first\n    more\n\n[^b]: second\n[^unused]: x\n\nEnd";
const at = (text: string, doc = DOC): number => doc.indexOf(text);

test("numbers in the order of first reference; repeated references counted; undefined labels are text", () => {
  const s = state(DOC);
  assert.equal(footnoteNumber(s, at("[^b]")), "1");
  assert.equal(footnoteNumber(s, at("^[inline]")), "2");
  assert.equal(footnoteNumber(s, at("[^b] then")), "1:1");
  assert.equal(footnoteNumber(s, at("[^a]")), "3");
  assert.equal(footnoteNumber(s, at("[^zz]")), null);
  assert.equal(footnoteDefinition(s, "a"), at("[^a]:"));
  assert.equal(footnoteFirstReference(s, "b"), at("[^b]"));
});

test("shown as numbers away from the cursor; definitions numbered; unreferenced ones muted", () => {
  const d = decorations(state(DOC));
  for (const item of [
    '"[^b]": FootnoteWidget(1)', '"^[inline]": FootnoteWidget(2)', '"[^b]": FootnoteWidget(1:1)', '"[^a]": FootnoteWidget(3)',
    '"[^a]:": FootnoteWidget(3)', '"[^b]:": FootnoteWidget(1)', '"[^unused]:": cm-live-muted', '"": cm-live-footnote',
  ]) assert.ok(d.includes(item), `${item} in ${d.join(", ")}`);
  assert.ok(!d.some((x) => x.startsWith('"[^zz]"')));
  const near = decorations(state(DOC, at("[^a]") + 2));
  assert.ok(near.includes('"[^": cm-live-muted') && !near.includes('"[^a]": FootnoteWidget(3)'));
});

test("the numbers follow changes: a new first reference renumbers the others", () => {
  let s = state(DOC);
  const update = (spec: TransactionSpec): void => { s = s.update(spec).state; };
  update({ changes: { from: 0, insert: "Z[^a] " } });
  assert.equal(footnoteNumber(s, 1), "1");
  assert.equal(footnoteNumber(s, s.doc.toString().indexOf("[^b]")), "2");
  update({ changes: { from: s.doc.length, insert: "\n\nmore text" } });
  assert.equal(footnoteNumber(s, 1), "1");
});

test("a line break at the end of a line is shown, and its spaces marked on the edited line", () => {
  const doc = "one  \ntwo\\\nthree\n\nEnd";
  const away = decorations(state(doc));
  assert.ok(away.includes('"  ": HardBreakWidget') && away.includes('"\\\\": HardBreakWidget'), away.join(", "));
  const near = decorations(state(doc, 1));
  assert.ok(near.includes('"  ": cm-live-hardbreak-source'), near.join(", "));
});

test("nested block quotes: one bar per level", () => {
  const doc = "> a\n> > b\n> > > c\nlazy\n\nEnd";
  const d = decorations(state(doc));
  for (const item of ['"": cm-live-quote cm-live-quote-1', '"": cm-live-quote cm-live-quote-2', '"": cm-live-quote cm-live-quote-3']) {
    assert.ok(d.includes(item), `${item} in ${d.join(", ")}`);
  }
  assert.equal(d.filter((x) => x === '"": cm-live-quote cm-live-quote-3').length, 2); // "lazy" continues the innermost quote
});
