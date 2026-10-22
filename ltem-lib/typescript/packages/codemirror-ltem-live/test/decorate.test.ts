/** What Live Preview hides and styles, where the cursor shows marks again, and where links and images go. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { ltemMarkdownLanguage } from "codemirror-ltem";

import { imageSource, isRemote, linkAt, liveDecorations } from "../dist/index.js";

function state(doc: string, anchor = doc.length, head = anchor): EditorState {
  const s = EditorState.create({ doc, selection: EditorSelection.range(anchor, head), extensions: [ltemMarkdownLanguage()] });
  ensureSyntaxTree(s, doc.length, 10_000);
  return s;
}

/** The decorations as "text: what", for the visible range (all of the document unless given). */
function decorations(s: EditorState, from = 0, to = s.doc.length): string[] {
  const out: string[] = [];
  liveDecorations(s, [{ from, to }]).between(0, s.doc.length, (a, b, d) => {
    const spec = d.spec as { widget?: object; class?: string };
    const what = spec.widget ? spec.widget.constructor.name : spec.class ?? "hidden";
    out.push(`${JSON.stringify(s.doc.sliceString(a, b))}: ${what}`);
  });
  return out.sort();
}

const has = (list: string[], item: string): boolean => list.includes(item);

describe("marks hidden and text styled", () => {
  const DOC = "# Title *x*\n\nA **b** ~~s~~ `c` [l](http://u) ![i](p.png) \\*\n\n- [ ] task\n  1. one\n\n> quote\n\n```js\nlet x\n```\n\n---\n\nEnd";

  test("away from the cursor", () => {
    const d = decorations(state(DOC));
    for (const item of [
      '"# ": hidden', '"*": hidden', '"*x*": cm-live-em', '"**": hidden', '"**b**": cm-live-strong', '"~~s~~": cm-live-strike',
      '"`c`": cm-live-code', '"[": hidden', '"l": cm-live-link', '"](http://u)": hidden', '"![i](p.png)": ImageWidget',
      '"\\\\": hidden', '"-": BulletWidget', '"[ ]": CheckboxWidget', '"1.": cm-live-list-number', '"> ": hidden',
      '"```": hidden', '"---": HorizontalRuleWidget',
      '"": cm-live-heading cm-live-h1', '"": cm-live-quote cm-live-quote-1', '"": cm-live-codeblock cm-live-codeblock-begin cm-live-hidden-marks',
      '"```js": LanguageWidget',
    ]) assert.ok(has(d, item), `${item} in ${d.join(", ")}`);
  });

  test("the cursor shows the marks of its element (inline) or its line (blocks)", () => {
    const at = (text: string): number => DOC.indexOf(text);
    let d = decorations(state(DOC, at("**b**") + 3));
    assert.ok(!has(d, '"**": hidden'));
    assert.ok(has(d, '"~~": hidden'));
    d = decorations(state(DOC, at("Title")));
    assert.ok(!has(d, '"# ": hidden'));
    assert.ok(has(d, '"*": hidden')); // the emphasis is not touched
    d = decorations(state(DOC, at("task")));
    assert.ok(!has(d, '"-": BulletWidget') && !has(d, '"[ ]": CheckboxWidget'));
    d = decorations(state(DOC, at("let x")));
    assert.ok(!has(d, '"```js": LanguageWidget'));
    d = decorations(state(DOC, at("quote")));
    assert.ok(!has(d, '"> ": hidden'));
  });

  test("only the given range is decorated", () => {
    const from = DOC.indexOf("> quote");
    const d = decorations(state(DOC), from, DOC.length);
    assert.ok(!has(d, '"# ": hidden'));
    assert.ok(has(d, '"> ": hidden'));
  });

  test("setext headings, closing hashes, nested lists, ordered lists", () => {
    const d = decorations(state("Title\n===\n\n## Two ##\n\n- a\n  - b\n    - c\n\nEnd", 0, 0).update({ selection: { anchor: 41 } }).state);
    assert.ok(has(d, '"===": hidden') && has(d, '"": cm-live-hidden-marks'));
    assert.ok(has(d, '" ##": hidden'));
    assert.equal(d.filter((x) => x.endsWith("BulletWidget")).length, 3);
  });

  test("LTEM tables are left to the table widgets", () => {
    const d = decorations(state("| **a** | b |\n|---|---|\n| 1 | 2 |\n\nEnd"));
    assert.deepEqual(d, []);
  });
});

describe("links and images", () => {
  test("where links go: an address, a reference, an autolink, a bare URL; not an undefined label", () => {
    const doc = "[a](http://x.com/a) [B][Ref] [ref][] [Ref] <me@x.com> https://y.com/z www.z.com [none]\n\n[ref]: <http://r.com/x>";
    const s = state(doc);
    const url = (text: string): string | null => linkAt(s, doc.indexOf(text) + 1)?.url ?? null;
    assert.equal(url("[a]"), "http://x.com/a");
    assert.equal(url("[B]"), "http://r.com/x");
    assert.equal(url("[ref][]"), "http://r.com/x");
    assert.equal(url("[Ref] <"), "http://r.com/x");
    assert.equal(url("<me"), "mailto:me@x.com");
    assert.equal(url("https://y"), "https://y.com/z");
    assert.equal(url("www.z"), null);
    assert.equal(url("[none]"), null);
  });

  test("images: never from the network; embedded ones as they are; others through the application", () => {
    for (const remote of ["http://a/b.png", "https://a/b.png", "//a/b.png", "\\\\server\\b.png", "FTP://a/b"]) assert.ok(isRemote(remote), remote);
    for (const local of ["b.png", "./img/b.png", "/abs/b.png", "C:\\b.png", "file:///b.png", "data:image/png;base64,AA", "app://doc/b.png"]) {
      assert.ok(!isRemote(local), local);
    }
    const resolve = (src: string): string | null => (src === "gone.png" ? null : src === "evil.png" ? "https://x/evil.png" : `app://doc/${src}`);
    assert.deepEqual(imageSource("https://a/b.png", resolve), { blocked: "remote" });
    assert.deepEqual(imageSource("b.png", resolve), { url: "app://doc/b.png" });
    assert.deepEqual(imageSource("gone.png", resolve), { blocked: "unresolved" });
    assert.deepEqual(imageSource("evil.png", resolve), { blocked: "remote" });
    assert.deepEqual(imageSource("data:image/png;base64,AA"), { url: "data:image/png;base64,AA" });
    assert.deepEqual(imageSource("b.png"), { blocked: "unresolved" });
  });
});
