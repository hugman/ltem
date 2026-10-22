/**
 * Tables shown as tables, as the application uses them: an edit goes on to the next cell
 * at once (no key goes elsewhere in between); a change of cell texts updates the table in
 * place; a drag selects a range also while a cell is edited; the menu on the cell being
 * edited, with the application's actions; header rows and body rows; marks on cells and
 * cell events; the source shown only on an Alt-click.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { call as callIn, compose as composeIn, open, type Harness } from "./harness.ts";

let h: Harness;
before(async () => {
  h = await open();
  await call("setMenu", { messages: "en" });
});
after(async () => {
  await h?.browser.close();
});

const call = <T>(name: string, ...args: unknown[]): Promise<T> => callIn<T>(h, name, ...args);
const doc = (): Promise<string> => call<string>("doc");
const idle = (): Promise<void> => h.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const cell = (text: string) => h.page.locator(".cm-ltem-widget td, .cm-ltem-widget th", { hasText: new RegExp(`^${text}$`) });
const editing = (): Promise<{ text: string; row: number; col: number } | null> => call("editing");

const DOC = "Text\n\n| 구분 | 상반기 | 하반기 |\n|---|---|---|\n| 인건비 | 100 | 200 |\n| 운영비 | 80 | 90 |\n\nEnd\n";

async function shown(text = DOC, options: object = {}): Promise<void> {
  await call("setWidgets", true, options);
  await call("setDoc", text, 0);
  await idle();
}

async function drag(from: { x: number; y: number }, to: string): Promise<void> {
  const b = (await cell(to).boundingBox())!;
  await h.page.mouse.move(from.x, from.y);
  await h.page.mouse.down();
  await h.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await h.page.mouse.up();
}
const centre = async (text: string): Promise<{ x: number; y: number }> => {
  const a = (await cell(text).boundingBox())!;
  return { x: a.x + a.width / 2, y: a.y + a.height / 2 };
};

test("Enter goes on to the next cell at once, and the table is updated in place", async () => {
  await shown();
  await call("markWidget");
  await cell("100").click();
  await h.page.keyboard.type("1");
  await h.page.keyboard.press("Enter");
  // No frame waited for: the next cell is edited already.
  assert.deepEqual(await editing(), { text: "80", row: 2, col: 1 });
  assert.equal(await call("widgetMarked"), true, "the same table, not drawn again");
  await h.page.keyboard.type("x");
  await h.page.keyboard.press("Escape");
  assert.match(await doc(), /\| 인건비 +\| 1001 +\| 200 +\|/);
  assert.doesNotMatch(await doc(), /80x/); // Escape dropped it
});

test("a Korean composition ended by Enter goes on to the next cell, and the next keys go there", async () => {
  await shown();
  await cell("100").click();
  await composeIn(h, "한글", true);
  await h.page.keyboard.press("Enter");
  await composeIn(h, "표셀", true);
  await h.page.keyboard.press("Enter");
  await idle();
  const text = await doc();
  assert.match(text, /\| 인건비 +\| 100한글 +\|/);
  assert.match(text, /\| 운영비 +\| 80표셀 +\|/);
  assert.match(text, /\n\| -+ \| -+ \| -+ \|\n/, "the delimiter row untouched");
  assert.equal(text.split("표셀").length - 1, 1);
});

test("a drag selects a range while a cell is edited, and from the cell being edited", async () => {
  await shown();
  await cell("100").click();
  assert.equal((await editing())?.text, "100");
  await drag(await centre("200"), "90"); // from another cell
  assert.deepEqual(await call("widgetSelected"), ["200", "90"]);
  assert.equal(await editing(), null);
  await h.page.keyboard.press("Escape");
  await cell("인건비").click();
  await h.page.keyboard.type("!");
  const box = (await h.page.locator(".cm-ltem-editing").boundingBox())!;
  await drag({ x: box.x + 5, y: box.y + box.height / 2 }, "80"); // from the edit box
  assert.deepEqual(await call("widgetSelected"), ["인건비!", "100", "운영비", "80"]);
  assert.match(await doc(), /\| 인건비! +\|/, "the edit was kept");
  await h.page.keyboard.press("Escape");
  // A click without a drag edits the cell, as before.
  await cell("200").click();
  assert.equal((await editing())?.text, "200");
  await h.page.keyboard.press("Escape");
});

test("a right click on the cell being edited opens the table menu, with the application's actions", async () => {
  await shown();
  await call("setMenuExtra");
  await cell("100").click();
  await h.page.locator(".cm-ltem-editing").click({ button: "right" });
  const items = await h.page.locator(".cm-ltem-menu-item").allTextContents();
  assert.ok(items.includes("Merge with cell below") && items.includes("Merge with right cell"), items.join(", "));
  assert.equal(items[items.length - 1], "Check 1,1");
  await h.page.locator(".cm-ltem-menu-item", { hasText: "Merge with cell below" }).click();
  await idle();
  assert.match(await doc(), /\| 인건비 +\| 100 \\\\ 80 +\| 200 +\|\n\| 운영비 +\| \^\^ +\| 90 +\|/);
  await call("setMenu", { messages: "en" });
});

test("header rows and body rows from the menu; merged cells across the line are cut", async () => {
  await shown();
  await cell("인건비").click({ button: "right" });
  await h.page.locator(".cm-ltem-menu-item", { hasText: "Make header row" }).click();
  await idle();
  assert.match(await doc(), /\| 구분 +\| 상반기 +\| 하반기 +\|\n\| 인건비 +\| 100 +\| 200 +\|\n\| -+ \| -+ \| -+ \|\n\| 운영비/);
  await h.page.keyboard.press("Escape");
  await cell("구분").click({ button: "right" });
  await h.page.locator(".cm-ltem-menu-item", { hasText: "Make body row" }).click();
  await idle();
  // The first row made a body row: an empty header row above (a table with no header).
  assert.match(await doc(), /\| +\| +\| +\|\n\| -+ \| -+ \| -+ \|\n\| 구분 +\| 상반기 +\| 하반기 +\|\n\| 인건비/);
});

test("marks on cells stay when the table is drawn again; hovers and clicks on cells are reported", async () => {
  await call("withCellEvents");
  await call("setDoc", DOC, 0);
  await idle();
  const at = DOC.indexOf("| 구분");
  await call("setMarks", [{ table: at, row: 1, col: 1, class: "check-me", title: "확인할 칸" }]);
  await idle();
  const marked = async (): Promise<string[]> =>
    h.page.locator(".cm-ltem-widget .check-me").evaluateAll((els) => els.map((e) => `${e.textContent}:${e.getAttribute("title")}`));
  assert.deepEqual(await marked(), ["100:확인할 칸"]);
  await cell("90").hover();
  await cell("90").click();
  await h.page.keyboard.press("Escape");
  const events = await call<string[]>("cellEvents");
  assert.ok(events.includes(`hover 2,2@${at}`) && events.includes(`click 2,2@${at}`), events.join(" | "));
  // Drawn again (a row added): the mark stays on its cell.
  await cell("80").click({ button: "right" });
  await h.page.locator(".cm-ltem-menu-item", { hasText: "Insert row below" }).click();
  await idle();
  assert.deepEqual(await marked(), ["100:확인할 칸"]);
  await call("setMarks", []);
  await idle();
  assert.deepEqual(await marked(), []);
});

test("with revealSource: altClick, the table stays shown with the cursor in it; Alt-click shows the source", async () => {
  await shown(DOC, { revealSource: "altClick" });
  await call("setDoc", DOC, DOC.indexOf("인건비") + 1); // the cursor in the table
  await idle();
  assert.equal(await call("widgetCount"), 1);
  await cell("200").click({ modifiers: ["Alt"] });
  await idle();
  assert.equal(await call("widgetCount"), 0);
  await call("setDoc", DOC, DOC.length); // the cursor leaves
  await idle();
  assert.equal(await call("widgetCount"), 1);
  await call("setWidgets", false);
});

test("a handle to the source left of a shown table, and back to the table on its source; labels in Korean", async () => {
  await shown(DOC, { messages: "ko" });
  const source = h.page.locator(".cm-ltem-source-button");
  assert.match((await source.getAttribute("aria-label"))!, /^원문: /);
  assert.match((await source.getAttribute("title"))!, /Alt\+클릭/);
  // Outside the table, at its left, at the height of its first row.
  const handle = (await source.boundingBox())!;
  const table = (await h.page.locator(".cm-ltem-widget table").boundingBox())!;
  assert.ok(handle.x + handle.width <= table.x + 1, `${handle.x + handle.width} <= ${table.x}`);
  assert.ok(handle.y >= table.y && handle.y < table.y + 26);
  await h.page.mouse.move(1, 1);
  await h.page.waitForTimeout(200);
  assert.equal(await source.evaluate((el) => getComputedStyle(el).opacity), "0", "hidden until the mouse is over the table");
  await cell("200").hover();
  await h.page.waitForTimeout(200); // the fade-in
  assert.equal(await source.evaluate((el) => getComputedStyle(el).opacity), "1");
  await source.click();
  await idle();
  assert.equal(await call("widgetCount"), 0, "the source is shown");
  const back = h.page.locator(".cm-ltem-table-button");
  assert.equal(await back.count(), 1);
  assert.match((await back.getAttribute("aria-label"))!, /^표로: /);
  const at = (await back.boundingBox())!;
  assert.ok(Math.abs(at.x - handle.x) < 8, `the same place: ${at.x} and ${handle.x}`);
  await back.click();
  await idle();
  assert.equal(await call("widgetCount"), 1, "shown as a table again");
  assert.equal(await h.page.locator(".cm-ltem-table-button").count(), 0);
  assert.equal(await doc(), DOC);
});

test("a table with no header: its empty header row is not drawn, and keys do not go into it", async () => {
  const headless = "Text\n\n|  |  |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nEnd\n";
  await shown(headless);
  assert.equal(await h.page.locator(".cm-ltem-widget thead").count(), 0);
  assert.deepEqual(await h.page.locator(".cm-ltem-widget td").evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.row},${(e as HTMLElement).dataset.col}`)), ["1,0", "1,1", "2,0", "2,1"]);
  await cell("1").click();
  await h.page.keyboard.press("Shift+Tab"); // no cell before it that is shown: the edit ends
  assert.equal(await editing(), null);
  assert.equal(await doc(), headless);
  await cell("3").click();
  await h.page.keyboard.press("Escape");
  await drag(await centre("1"), "2");
  await h.page.keyboard.press("ArrowUp");
  assert.deepEqual(await call("widgetSelected"), ["1", "2"], "the range stays on the first row drawn");
  await h.page.keyboard.press("Control+a");
  assert.deepEqual(await call("widgetSelected"), ["1", "2", "3", "4"]);
  await h.page.keyboard.press("Escape");
  // The first body row made a header row: the empty header row goes.
  await cell("1").click({ button: "right" });
  await h.page.locator(".cm-ltem-menu-item", { hasText: "Make header row" }).click();
  await idle();
  assert.match(await doc(), /^Text\n\n\| 1 +\| 2 +\|\n\| -+ \| -+ \|\n\| 3 +\| 4 +\|\n/);
  assert.equal(await h.page.locator(".cm-ltem-widget thead").count(), 1);
  await call("setWidgets", false);
});

test("the table button with revealSource: altClick; no buttons with sourceButton: false", async () => {
  await shown(DOC, { revealSource: "altClick" });
  await cell("100").click({ modifiers: ["Alt"] });
  await idle();
  assert.equal(await call("widgetCount"), 0);
  await h.page.locator(".cm-ltem-table-button").click();
  await idle();
  assert.equal(await call("widgetCount"), 1);
  await shown(DOC, { sourceButton: false });
  assert.equal(await h.page.locator(".cm-ltem-source-button").count(), 0);
  await call("setWidgets", false);
});

test("Korean composition on the first line of a table's source, next to the table button", async () => {
  await shown();
  const first = DOC.indexOf("| 구분");
  const end = DOC.indexOf("\n", first);
  for (const at of [first + 4, end]) {
    await call("setDoc", DOC, at);
    await idle();
    assert.equal(await h.page.locator(".cm-ltem-table-button").count(), 1);
    await composeIn(h, "한글");
    assert.equal(await doc(), DOC.slice(0, at) + "한글" + DOC.slice(at));
  }
  await call("setWidgets", false);
});

