/** Math (Pandoc's dollars) and front matter, read as the preview's plugins read them; and how Live Preview shows them. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { ltemMarkdownLanguage } from "codemirror-ltem";

import { frontMatterSyntax, liveDecorations, mathSyntax } from "../dist/index.js";

function state(doc: string, anchor = doc.length): EditorState {
  const s = EditorState.create({ doc, selection: { anchor }, extensions: [ltemMarkdownLanguage({ extensions: [mathSyntax, frontMatterSyntax] })] });
  ensureSyntaxTree(s, doc.length, 10_000);
  return s;
}

function nodes(doc: string, name: string): string[] {
  const s = state(doc);
  const out: string[] = [];
  ensureSyntaxTree(s, doc.length)!.iterate({ enter: (n) => { if (n.name === name) out.push(doc.slice(n.from, n.to)); } });
  return out;
}

test("math: Pandoc's rules for the dollars", () => {
  assert.deepEqual(nodes("a $x^2$ b", "InlineMath"), ["$x^2$"]);
  assert.deepEqual(nodes("a $ x$ b", "InlineMath"), []); // a space after the opening $
  assert.deepEqual(nodes("a $x $ b", "InlineMath"), []); // a space before the closing $
  assert.deepEqual(nodes("costs $5 and $10", "InlineMath"), []); // the closing $ before a digit
  assert.deepEqual(nodes("a \\$x$ b", "InlineMath"), []);
  assert.deepEqual(nodes("`$x$` code", "InlineMath"), []);
  assert.deepEqual(nodes("a $\\$5$ b", "InlineMath"), ["$\\$5$"]);
  assert.deepEqual(nodes("a $$x + y$$ b", "DisplayMath"), ["$$x + y$$"]);
  assert.deepEqual(nodes("$$\n\\frac{a}{b}\n\\cdot c\n$$", "DisplayMath"), ["$$\n\\frac{a}{b}\n\\cdot c\n$$"]);
  // A line that starts a block (here a list item) ends the paragraph, and the math with it, as in Pandoc.
  assert.deepEqual(nodes("$$\nx\n+ y\n$$", "DisplayMath"), []);
});

test("front matter: only at the very start, only with a closing line", () => {
  assert.deepEqual(nodes("---\ntitle: 표\ntags: [a]\n---\n\n# Head", "FrontMatter"), ["---\ntitle: 표\ntags: [a]\n---"]);
  assert.deepEqual(nodes("---\ntitle: x\n...\nText", "FrontMatter"), ["---\ntitle: x\n..."]);
  assert.deepEqual(nodes("---\nnot closed\n\nText", "FrontMatter"), []);
  assert.deepEqual(nodes("Text\n\n---\na: b\n---", "FrontMatter"), []);
  // Without front matter syntax the same text is a rule and a heading, as markdown-it reads it without its plugin.
  const s = EditorState.create({ doc: "---\na: b\n---\n", extensions: [ltemMarkdownLanguage()] });
  const names: string[] = [];
  ensureSyntaxTree(s, s.doc.length)!.iterate({ enter: (n) => { names.push(n.name); } });
  assert.ok(names.includes("HorizontalRule") && names.includes("SetextHeading2"), names.join(" "));
});

test("Live Preview: math drawn by the application where the cursor is not; front matter muted without a renderer", () => {
  const doc = "---\na: b\n---\n\nText $x$ and $$y$$.\n\nEnd";
  const draw = (): void => undefined;
  const list = (anchor: number, math = true): string[] => {
    const out: string[] = [];
    liveDecorations(state(doc, anchor), [{ from: 0, to: doc.length }], { renderers: math ? { math: draw } : {} }).between(0, doc.length, (a, b, d) => {
      const spec = d.spec as { widget?: { constructor: { name: string } }; class?: string };
      out.push(`${JSON.stringify(doc.slice(a, b))}: ${spec.widget ? spec.widget.constructor.name : spec.class}`);
    });
    return out;
  };
  const away = list(doc.length);
  assert.ok(away.includes('"$x$": RenderedWidget') && away.includes('"$$y$$": RenderedWidget'), away.join(", "));
  assert.ok(away.includes('"": cm-live-frontmatter'));
  const near = list(doc.indexOf("$x$") + 1);
  assert.ok(near.includes('"$x$": cm-live-math') && near.includes('"$$y$$": RenderedWidget'), near.join(", "));
  assert.ok(list(doc.length, false).includes('"$x$": cm-live-math'));
});
