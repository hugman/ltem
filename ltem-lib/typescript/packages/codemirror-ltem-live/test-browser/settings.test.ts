/**
 * Settings switched in a running editor, as an application's settings page does
 * (`applyLiveSettings`): syntax (highlights), Live Preview, tables shown as tables, ranges of
 * cells.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { call as callIn, open, type Harness } from "./harness.ts";

let h: Harness;
before(async () => {
  h = await open();
});
after(async () => {
  await h?.browser.close();
});

const call = <T>(name: string, ...args: unknown[]): Promise<T> => callIn<T>(h, name, ...args);
const idle = (): Promise<void> => h.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const lines = async (): Promise<string[]> => (await call<{ text: string }[]>("lines")).map((l) => l.text);

const TABLE = "| a | b |\n|---|---|\n| 100 | 200 |\n";
const DOC = `글 ==강조== 끝\n\n${TABLE}\n마지막\n`;

test("highlights are on by default, and a setting switches them off and on", async () => {
  await call("applySettings", { highlight: true, tables: true, livePreview: true, cellRanges: true });
  await call("setDoc", DOC, DOC.length);
  assert.equal((await call<{ highlight: boolean }>("settings")).highlight, true);
  assert.deepEqual(await call("texts", ".cm-live-highlight"), ["강조"]);
  assert.equal((await lines())[0], "글 강조 끝");
  assert.equal(await call("applySettings", { highlight: false }), true);
  await idle();
  assert.equal(await call("count", ".cm-live-highlight"), 0);
  assert.equal((await lines())[0], "글 ==강조== 끝");
  assert.equal(await call("applySettings", { highlight: false }), false, "nothing changed");
  await call("applySettings", { highlight: true });
  await idle();
  assert.deepEqual(await call("texts", ".cm-live-highlight"), ["강조"]);
});

test("Live Preview and tables shown as tables are settings too", async () => {
  await call("setDoc", DOC, DOC.length);
  assert.equal(await call("count", ".cm-ltem-widget"), 1);
  await call("applySettings", { tables: false });
  await idle();
  assert.equal(await call("count", ".cm-ltem-widget"), 0);
  assert.equal((await call<{ tables: boolean }>("settings")).tables, false);
  await call("applySettings", { tables: true, livePreview: false });
  await idle();
  assert.equal(await call("live"), false);
  assert.equal((await lines())[0], "글 ==강조== 끝");
  await call("applySettings", { livePreview: true });
  await idle();
  assert.equal(await call("live"), true);
  assert.equal(await call("count", ".cm-ltem-widget"), 1);
});

test("with ranges of cells off, a selection over cells is plain text", async () => {
  const from = DOC.indexOf("100");
  const to = DOC.indexOf("200") + 3;
  await call("setDoc", DOC, from);
  await call("select", from, to);
  await h.page.keyboard.press("Backspace");
  const row = async (): Promise<string> => (await call<string>("doc")).split("\n")[4]!;
  assert.match(await row(), /^\|\s+\|\s+\|$/, "the cells emptied, the table kept");
  await call("applySettings", { cellRanges: false });
  await call("setDoc", DOC, from);
  await call("select", from, to);
  await h.page.keyboard.press("Backspace");
  assert.equal(await row(), "|  |", "the text deleted, the pipe between the cells too");
  await call("applySettings", { cellRanges: true });
});

test("marks on cells stay while Live Preview is off, and when settings change", async () => {
  await call("applySettings", { livePreview: false });
  await call("setDoc", DOC, DOC.length);
  await call("setMarks", [{ table: DOC.indexOf("| a"), row: 1, col: 1, class: "check-me", title: "확인할 칸" }]);
  await call("applySettings", { livePreview: true });
  await idle();
  const marked = (): Promise<string[]> => call<string[]>("texts", ".cm-ltem-widget .check-me");
  assert.deepEqual(await marked(), ["200"]);
  await call("applySettings", { lint: false }); // the table features made again
  await idle();
  assert.deepEqual(await marked(), ["200"]);
  await call("applySettings", { highlight: false, lint: true }); // the language made again
  await idle();
  assert.deepEqual(await marked(), ["200"]);
  await call("setMarks", []);
  await call("applySettings", { highlight: true });
});

test("with ranges of cells off, the source is copied, cut and pasted as text, with the cells as HTML too", async () => {
  await call("applySettings", { livePreview: false, cellRanges: false });
  const row = "| 100 | 200 |";
  const from = DOC.indexOf(row);
  await call("setDoc", DOC, from);
  await call("select", from, from + row.length + 1); // the row's line
  await h.page.keyboard.press("Control+c");
  const copied = await call<{ plain: string; html: string }>("lastCopy");
  assert.equal(copied.plain, `${row}\n`, "the source as selected");
  assert.match(copied.html, /<table data-ltem-copy="source"[^>]*>/);
  assert.match(copied.html, /<td>100<\/td>\n<td>200<\/td>/);
  // Pasted back before the header row: the line itself, not cells written over.
  const header = DOC.indexOf("| a | b |");
  await call("select", header, header);
  await call("paste", copied.plain, copied.html);
  assert.equal(await call<string>("doc"), DOC.slice(0, header) + `${row}\n` + DOC.slice(header));
  // Cut: the text goes.
  await call("setDoc", DOC, from);
  await call("select", from, from + row.length + 1);
  await h.page.keyboard.press("Control+x");
  assert.equal(await call<string>("doc"), DOC.replace(`${row}\n`, ""));
  await call("applySettings", { livePreview: true, cellRanges: true });
});

test("with ranges of cells on, a selection over cells is copied as tab-separated text", async () => {
  const row = "| 100 | 200 |";
  const from = DOC.indexOf(row);
  await call("applySettings", { livePreview: false });
  await call("setDoc", DOC, from);
  await call("select", from, from + row.length + 1);
  await h.page.keyboard.press("Control+c");
  const copied = await call<{ plain: string; html: string }>("lastCopy");
  assert.equal(copied.plain, "100\t200");
  assert.doesNotMatch(copied.html, /data-ltem-copy/);
  await call("applySettings", { livePreview: true });
});

test("setLiveMessages changes the language of the table menu and the table handles", async () => {
  await call("setDoc", DOC, DOC.length);
  await idle();
  await call("setMessages", "ko");
  await idle();
  assert.match((await h.page.locator(".cm-ltem-source-button").getAttribute("aria-label"))!, /^원문: /);
  await h.page.locator(".cm-ltem-widget td", { hasText: /^100$/ }).click({ button: "right" });
  assert.ok((await h.page.locator(".cm-ltem-menu-item").allTextContents()).includes("아래 셀과 병합"));
  await h.page.keyboard.press("Escape");
  await call("setMessages", "en");
  await idle();
  assert.match((await h.page.locator(".cm-ltem-source-button").getAttribute("aria-label"))!, /^Source: /);
});

