/**
 * A split view: the source and Live Preview of one document in two editors, as in
 * CodeMirror's split view example (each change goes to the other editor with an
 * annotation; the history is Live Preview's, and the source's undo runs there). Tables
 * shown as tables, ranges of cells, the table menu, undo, lint and Korean IME composition
 * work with changes that come from the other editor.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { call as callIn, composeSyllable, open, type Harness } from "./harness.ts";

let h: Harness;
before(async () => {
  h = await open();
});
after(async () => {
  await h?.browser.close();
});

const call = <T>(name: string, ...args: unknown[]): Promise<T> => callIn<T>(h, name, ...args);
const idle = (): Promise<void> => h.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const docs = async (): Promise<[string, string]> => [await call<string>("doc"), await call<string>("sourceDoc")];
const cell = (text: string) => h.page.locator(".cm-ltem-widget td, .cm-ltem-widget th", { hasText: new RegExp(`^${text}$`) });

const DOC = "# 제목\n\n글\n\n| 구분 | 금액 | << |\n| ^^ | 상반기 | 하반기 |\n|:--|:-:|--:|\n| 인건비 | 100 | 200 |\n| 운영비 | 80 | 90 |\n\n끝\n";

async function start(): Promise<void> {
  await call("split", false);
  await call("setDoc", DOC, DOC.length);
  await call("split", true);
  await idle();
}

test("typing in the source shows in Live Preview", async () => {
  await start();
  await call("sourceFocus", "# 제목".length);
  await h.page.keyboard.type(" 둘");
  await idle();
  const [live, source] = await docs();
  assert.equal(live, source);
  assert.match(live, /^# 제목 둘\n/);
  assert.equal((await call<{ cls: string; text: string }[]>("lines"))[0].text, "제목 둘");
});

test("an edit of a cell of a shown table goes to the source", async () => {
  await start();
  await cell("100").click();
  await h.page.keyboard.type("5");
  await h.page.keyboard.press("Enter");
  await idle();
  const [live, source] = await docs();
  assert.equal(live, source);
  assert.match(source, /\| 인건비 +\| 1005 +\| 200 +\|/);
});

test("an edit in progress in a cell is kept while the source changes the document elsewhere", async () => {
  await start();
  await cell("100").click();
  await h.page.keyboard.type("7");
  await call("sourceInsert", "# 제목".length, "!");
  await idle();
  await h.page.keyboard.type("8");
  await h.page.keyboard.press("Enter");
  await idle();
  const [live, source] = await docs();
  assert.equal(live, source);
  assert.match(source, /^# 제목!\n/);
  assert.match(source, /\| 인건비 +\| 10078 +\| 200 +\|/);
});

test("an edit in progress stays while the source changes another cell of that table; the table is updated in place", async () => {
  await start();
  await cell("100").click();
  await h.page.keyboard.type("7");
  const widget = h.page.locator(".cm-ltem-widget").first();
  await widget.evaluate((el) => { (el as HTMLElement).dataset.marked = "yes"; });
  const at = DOC.indexOf("90");
  await call("sourceInsert", at, "5"); // 90 -> 590 in the same table
  await idle();
  assert.equal(await widget.evaluate((el) => (el as HTMLElement).dataset.marked), "yes");
  assert.deepEqual(await call("texts", ".cm-ltem-widget td:last-child"), ["200", "590"]);
  await h.page.keyboard.type("8");
  await h.page.keyboard.press("Enter");
  await idle();
  const [live, source] = await docs();
  assert.equal(live, source);
  assert.match(source, /\| 인건비 +\| 10078 +\| 200 +\|/);
  assert.match(source, /\| 운영비 +\| 80 +\| 590 +\|/);
});

test("a range of cells stays selected while the source changes the document elsewhere", async () => {
  await start();
  await call("setLive", true);
  const from = await cell("100").boundingBox();
  const to = await cell("200").boundingBox();
  await h.page.mouse.move(from!.x + 5, from!.y + 5);
  await h.page.mouse.down();
  await h.page.mouse.move(to!.x + 5, to!.y + 5, { steps: 4 });
  await h.page.mouse.up();
  assert.equal(await call("count", ".cm-ltem-selected"), 2);
  await call("sourceInsert", "# 제목".length, "!");
  await idle();
  assert.equal(await call("count", ".cm-ltem-selected"), 2);
  const [live, source] = await docs();
  assert.equal(live, source);
});

test("the table menu's changes go to the source, and undo in the source undoes them in both", async () => {
  await start();
  await cell("80").click({ button: "right" });
  await h.page.locator(".cm-ltem-menu-item", { hasText: "Insert row below" }).click();
  await idle();
  let [live, source] = await docs();
  assert.equal(live, source);
  assert.equal(source.split("\n").filter((l) => l.startsWith("|")).length, 6);
  await call("sourceFocus", 0);
  await h.page.keyboard.press("Control+z");
  await idle();
  [live, source] = await docs();
  assert.equal(live, source);
  assert.equal(source.split("\n").filter((l) => l.startsWith("|")).length, 5);
});

test("lint shows in the source for a table changed in Live Preview", async () => {
  await start();
  assert.equal(await call("sourceCount", ".cm-lintRange"), 0);
  // A rowspan marker in the first body row would join it to the header (rule V7). (Typed
  // into a cell, `^^` is text: it is written escaped.)
  await call("setDoc", DOC.replace("| 인건비 |", "| ^^ |"), 0);
  assert.equal((await docs())[1], DOC.replace("| 인건비 |", "| ^^ |"));
  await h.page.waitForFunction(() => {
    const t = (window as never as { ltemTest: { sourceCount(s: string): number } }).ltemTest;
    return t.sourceCount(".cm-lintRange") > 0;
  }, undefined, { timeout: 3000 });
});

test("Korean composition in the source, Live Preview following", async () => {
  await start();
  await call("sourceFocus", DOC.indexOf("글") + 1);
  await composeSyllable(h, "한");
  await composeSyllable(h, "글");
  await idle();
  const [live, source] = await docs();
  assert.equal(live, source);
  assert.match(source, /\n글한글\n/);
  assert.equal(source.split("한").length - 1, 1);
});
