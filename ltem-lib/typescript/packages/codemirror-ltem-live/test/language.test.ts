/**
 * The Markdown language of Live Preview: HTML as markdown-it reads it with `html: false`,
 * extensions applied in order (a later one can remove what an earlier one adds), highlights;
 * and the settings: their list, defaults, and how options and settings set them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ensureSyntaxTree } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { ltemContextMenuConfig } from "codemirror-ltem";

import {
  currentLiveSettings, defaultLiveSettings, highlightSyntax, liveMarkdown, liveMarkdownLanguage, liveSettingsInfo,
  type LiveMarkdownLanguageConfig,
} from "../dist/index.js";

/** The names of the nodes of a document's tree, in order. */
function nodes(doc: string, config: LiveMarkdownLanguageConfig = {}): string[] {
  const state = EditorState.create({ doc, extensions: [liveMarkdownLanguage(config)] });
  const out: string[] = [];
  ensureSyntaxTree(state, doc.length, 5000)!.iterate({ enter: (n) => void out.push(n.name) });
  return out;
}

test("HTML is text by default, as markdown-it reads it with html: false; autolinks stay", () => {
  // A line that would start an HTML block goes on with the paragraph.
  assert.equal(nodes("a\n<div>\nb\n").filter((n) => n === "Paragraph").length, 1);
  assert.ok(nodes("a\n<div>\nb\n", { html: true }).includes("HTMLBlock"));
  // A fence after a line with a tag is a fence, not part of an HTML block.
  assert.ok(nodes("<b>\n```\ncode\n```\n").includes("FencedCode"));
  assert.ok(!nodes("<b>\n```\ncode\n```\n", { html: true }).includes("FencedCode"));
  const inline = nodes("x <b>y</b> <!-- c --> <http://e.com> <me@e.com> <javascript:x>\n");
  assert.ok(!inline.includes("HTMLTag") && !inline.includes("Comment"));
  assert.equal(inline.filter((n) => n === "Autolink").length, 2);
});

test("syntax that markdown-it does not read is removed, and an extension can add it back", () => {
  const removed = nodes("x^a^ H~2~O :smile:\n");
  assert.ok(!removed.includes("Superscript") && !removed.includes("Subscript") && !removed.includes("Emoji"));
  assert.ok(nodes("==a==\n", { extensions: [highlightSyntax] }).includes("Highlight"));
  assert.ok(!nodes("==a==\n").includes("Highlight"));
});

test("highlights in runs of marks, as markdown-it-mark reads them", () => {
  const highlights = (doc: string): number => nodes(doc, { extensions: [highlightSyntax] }).filter((n) => n === "Highlight").length;
  assert.equal(highlights("==a==\n"), 1);
  assert.equal(highlights("a====b\n"), 0); // pairs of one run do not close each other
  assert.equal(highlights("==a====b==\n"), 2);
  assert.equal(highlights("=== not ===\n"), 0);
  assert.equal(highlights("| ==a== | b |\n|---|---|\n| 1 | 2 |\n"), 1); // in a table cell
});

test("the settings: one entry for each, defaults on but HTML, names and descriptions in English and Korean", () => {
  assert.deepEqual(liveSettingsInfo.map((s) => s.key).sort(), Object.keys(defaultLiveSettings).sort());
  for (const info of liveSettingsInfo) {
    assert.equal(info.default, defaultLiveSettings[info.key], info.key);
    assert.ok(info.label.en && info.label.ko && info.description.en && info.description.ko, info.key);
  }
  assert.deepEqual(Object.entries(defaultLiveSettings).filter(([, on]) => !on).map(([key]) => key), ["html"]);
});

test("settings come from the defaults, then options, then `settings`", () => {
  const settings = (options: Parameters<typeof liveMarkdown>[0]) =>
    currentLiveSettings(EditorState.create({ extensions: [liveMarkdown(options)] }));
  assert.deepEqual(settings({}), { ...defaultLiveSettings });
  const off = settings({ syntax: { math: false }, live: { bareUrls: false, tables: false }, ltem: { lint: false, autoAlign: false } });
  assert.equal(off!.math, false);
  assert.equal(off!.bareLinks, false);
  assert.equal(off!.tables, false);
  assert.equal(off!.lint, false);
  assert.equal(off!.autoAlign, false);
  assert.equal(off!.footnotes, true);
  assert.equal(settings({ syntax: { math: false }, settings: { math: true, highlight: false } })!.highlight, false);
  assert.equal(settings({ syntax: { math: false }, settings: { math: true } })!.math, true);
  assert.equal(settings({ live: { enabled: false } })!.livePreview, false);
});

test("an editor set up again with liveMarkdown gets its new options (messages, for one)", () => {
  const outer = new Compartment();
  const setUp = (messages: "en" | "ko") => liveMarkdown({ ltem: { contextMenu: { messages } }, settings: { highlight: false } });
  let state = EditorState.create({ extensions: [outer.of(setUp("en"))] });
  assert.equal(state.facet(ltemContextMenuConfig)?.messages, "en");
  state = state.update({ effects: outer.reconfigure(setUp("ko")) }).state;
  assert.equal(state.facet(ltemContextMenuConfig)?.messages, "ko");
  assert.equal(currentLiveSettings(state)!.highlight, false);
});

