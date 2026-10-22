/**
 * Ranges of cells, the table menu and pasting cells, in the source and where tables are
 * shown as tables, with Korean IME input among them.
 *
 *     npm run build && npm run test:browser
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { call as callIn, compose as composeIn, open, type Harness } from "./harness.ts";

let h: Harness;
before(async () => {
  h = await open();
});
after(async () => {
  await h?.browser.close();
});

const call = <T>(name: string, ...args: unknown[]): Promise<T> => callIn<T>(h, name, ...args);
const compose = (word: string, keys = false): Promise<void> => composeIn(h, word, keys);
const doc = (): Promise<string> => call<string>("doc");
const setDoc = (text: string, cursor = 0): Promise<void> => call("setDoc", text, cursor);
const idle = (): Promise<void> => h.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

const DOC = "Text\n\n| 구분 | 상반기 | 하반기 |\n|---|---|---|\n| 인건비 | 100 | 200 |\n| 운영비 | 80 | 90 |\n\nEnd\n";

describe("ranges of cells in the source", () => {
  test("a selection over cells is marked as cells; Backspace empties them, the table stays", async () => {
    await setDoc(DOC);
    await call("selectText", DOC.indexOf("100"), DOC.indexOf("90") + 1);
    assert.equal(await call("selectedCells"), 4);
    await h.page.keyboard.press("Backspace");
    assert.match(await doc(), /\| 인건비 +\| +\| +\|\n\| 운영비 +\| +\| +\|/);
  });

  test("typing over a range of cells types into the selection's cell", async () => {
    await setDoc(DOC);
    await call("selectText", DOC.indexOf("100"), DOC.indexOf("90") + 2);
    await h.page.keyboard.type("X");
    assert.equal(await doc(), DOC.replace("| 90 |", "| 90X |"));
  });

  test("Korean composition over a range of cells: the table stays, the syllable once", async () => {
    await setDoc(DOC);
    await call("selectText", DOC.indexOf("100"), DOC.indexOf("90") + 2);
    // As the Windows IME does: a key-down (key code 229) before the composition starts.
    await compose("한글", true);
    const text = await doc();
    assert.equal(text.split("\n").length, DOC.split("\n").length, text);
    assert.equal(text, DOC.replace("| 90 |", "| 90한글 |"));
  });

  test("HTML with text around a table goes in as text, not as cells", async () => {
    await setDoc("Before\n\n", 8);
    await call("paste", "앞 글 굵게\n구분\t2026년\n뒤 글", "<p>앞 글 <b>굵게</b></p><table><tr><th>구분</th><th>2026년</th></tr></table><p>뒤 글</p>");
    assert.equal(await doc(), "Before\n\n앞 글 굵게\n구분\t2026년\n뒤 글");
  });

  test("Enter and Shift-Enter over a range go into the cell; text pasted over it goes into its first cell", async () => {
    await setDoc(DOC);
    await call("selectText", DOC.indexOf("100"), DOC.indexOf("90") + 2);
    await h.page.keyboard.press("Enter");
    assert.equal(await doc(), DOC);
    await call("selectText", DOC.indexOf("100"), DOC.indexOf("90") + 2);
    await h.page.keyboard.press("Shift+Enter");
    assert.equal((await doc()).split("\n").length, DOC.split("\n").length);
    await setDoc(DOC);
    await call("selectText", DOC.indexOf("100"), DOC.indexOf("90") + 2);
    await call("paste", "새 값");
    assert.match(await doc(), /\| 인건비 +\| 새 값 +\| 200 +\|/);
  });

  test("a composition over a range that starts without a key-down: the table stays", async () => {
    await setDoc(DOC);
    await call("selectText", DOC.indexOf("100"), DOC.indexOf("90") + 2);
    await compose("한글"); // composition events only, as some on-screen keyboards send them
    assert.equal(await doc(), DOC.replace("| 90 |", "| 90한글 |"));
    await call("selectText", DOC.indexOf("90") + 2, DOC.indexOf("100"));
    await compose("표");
    assert.equal(await doc(), DOC.replace("| 100 |", "| 100표 |").replace("| 90 |", "| 90한글 |"));
  });

  test("the table menu: a right click in a table, an action, Escape", async () => {
    await setDoc(DOC);
    await h.page.locator(".cm-line", { hasText: "운영비" }).click({ button: "right" });
    const items = await call<string[]>("menuItems");
    // The click is right of the last cell, which counts as that cell: it has no cell to its right.
    assert.ok(items.includes("Insert row below") && items.includes("-Merge with right cell"), items.join(", "));
    await h.page.locator(".cm-ltem-menu-item", { hasText: "Insert row below" }).click();
    assert.equal((await doc()).split("\n").length, DOC.split("\n").length + 1);
    await h.page.locator(".cm-line", { hasText: "인건비" }).click({ button: "right" });
    await h.page.keyboard.press("Escape");
    assert.deepEqual(await call("menuItems"), []);
  });

  test("merging a range of cells from the menu, in Korean", async () => {
    await call("setMenu", { messages: "ko" });
    await setDoc(DOC);
    await call("selectText", DOC.indexOf("100"), DOC.indexOf("90") + 2);
    await h.page.locator(".cm-line", { hasText: "운영비" }).click({ button: "right", position: { x: 160, y: 5 } });
    const items = await call<string[]>("menuItems");
    assert.ok(items.includes("셀 병합"), items.join(", "));
    await h.page.locator(".cm-ltem-menu-item", { hasText: "셀 병합" }).click();
    assert.match(await doc(), /\| 인건비 +\| 100 \\\\ 200 \\\\ 80 \\\\ 90 \| << +\|\n\| 운영비 +\| \^\^ +\| << +\|/);
    await call("setMenu", null);
  });

  test("pasting tab-separated text: a new table outside, cells filled inside", async () => {
    await setDoc("Before\n\n\n\nAfter\n", 8);
    await call("paste", "이름\t값\n가\t1\n");
    assert.equal(await doc(), "Before\n\n| 이름 | 값  |\n| ---- | --- |\n| 가   | 1   |\n\nAfter\n");
    await setDoc(DOC, DOC.indexOf("100") + 1);
    await call("paste", "a\tb\nc\td");
    assert.equal(await doc(), "Text\n\n| 구분   | 상반기 | 하반기 |\n| ------ | ------ | ------ |\n| 인건비 | a      | b      |\n| 운영비 | c      | d      |\n\nEnd\n");
  });
});

describe("tables shown as tables: ranges, menu, clipboard", () => {
  before(async () => {
    await call("setWidgets", true);
  });
  after(async () => {
    await call("setWidgets", false);
  });

  const cell = (text: string) => h.page.locator(".cm-ltem-widget td, .cm-ltem-widget th", { hasText: new RegExp(`^${text}$`) });

  async function drag(from: string, to: string): Promise<void> {
    const a = (await cell(from).boundingBox())!;
    const b = (await cell(to).boundingBox())!;
    await h.page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await h.page.mouse.down();
    await h.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await h.page.mouse.up();
  }

  test("a drag over cells selects a range; Delete empties it and the table stays shown", async () => {
    await setDoc(DOC);
    await drag("100", "90");
    assert.deepEqual(await call("widgetSelected"), ["100", "200", "80", "90"]);
    assert.match(await call<string>("focusClass"), /cm-ltem-keys/);
    await h.page.keyboard.press("Delete");
    assert.match(await doc(), /\| 인건비 +\| +\| +\|\n\| 운영비 +\| +\| +\|/);
    assert.equal(await call("widgetCount"), 1);
    await idle();
    assert.equal((await call<string[]>("widgetSelected")).length, 4); // the range is still selected
  });

  test("Shift-click and Shift-arrows extend a range; arrows move it", async () => {
    await setDoc(DOC);
    await drag("구분", "상반기");
    await cell("200").click({ modifiers: ["Shift"] });
    assert.deepEqual(await call("widgetSelected"), ["구분", "상반기", "하반기", "인건비", "100", "200"]);
    await h.page.keyboard.press("ArrowDown");
    assert.deepEqual(await call("widgetSelected"), ["90"]);
    await h.page.keyboard.press("Shift+ArrowLeft");
    assert.deepEqual(await call("widgetSelected"), ["80", "90"]);
  });

  test("copy and cut put tab-separated text and HTML on the clipboard; paste fills cells", async () => {
    await setDoc(DOC);
    await drag("100", "200");
    await h.page.keyboard.press("Control+c");
    const copied = await call<{ plain: string; html: string }>("lastCopy");
    assert.equal(copied.plain, "100\t200");
    assert.match(copied.html, /<td>100<\/td>\n<td>200<\/td>/);
    // Down from the range's active cell (200) to 90; the pasted cells start there and add a column.
    await h.page.keyboard.press("ArrowDown");
    await call("paste", "P\tQ");
    assert.match(await doc(), /\| 운영비 +\| 80 +\| P +\| Q +\|/);
    assert.equal(await call("widgetCount"), 1);
    await idle();
    await h.page.keyboard.press("Control+x");
    assert.equal((await call<{ plain: string }>("lastCopy")).plain, "P");
    assert.match(await doc(), /\| 운영비 +\| 80 +\| +\| Q +\|/);
  });

  test("the table menu on a cell: insert a row; the table stays shown, the cell stays selected", async () => {
    await setDoc(DOC);
    await cell("80").click({ button: "right" });
    assert.ok((await call<string[]>("menuItems")).includes("Insert row below"));
    await h.page.locator(".cm-ltem-menu-item", { hasText: "Insert row below" }).click();
    assert.equal((await doc()).split("\n").length, DOC.split("\n").length + 1);
    assert.equal(await call("widgetCount"), 1);
    await idle();
    assert.deepEqual(await call("widgetSelected"), [""]); // the new row's cell
    // Korean typed right away goes into that cell.
    await compose("셀", true);
    await h.page.keyboard.press("Enter");
    assert.match(await doc(), /\| 운영비 +\| 80 +\| 90 +\|\n\| +\| 셀 +\| +\|/);
    await h.page.keyboard.press("Escape");
    await call("undo");
    await call("undo");
    assert.equal(await doc(), DOC);
  });

  test("merging a dragged range from the menu, with the keyboard", async () => {
    await setDoc(DOC);
    await drag("100", "90");
    await cell("100").click({ button: "right" });
    for (let i = 0; i < 20; i++) {
      const focused = await call<string>("focusText");
      if (focused.startsWith("Merge cells")) break;
      await h.page.keyboard.press("ArrowDown");
    }
    await h.page.keyboard.press("Enter");
    const html = await call<string>("widgetHtml");
    // The merged cell (selected again after the change, once the table is drawn again).
    assert.match(html, /<td [^>]*>100<br( \/)?>200<br( \/)?>80<br( \/)?>90<\/td>/, html);
    assert.match(html, /colspan="2"/);
    assert.match(html, /rowspan="2"/);
    assert.equal(await call("widgetCount"), 1);
  });

  test("typing and Korean composition on a selected cell edit it", async () => {
    await setDoc(DOC);
    await drag("80", "90");
    await h.page.keyboard.press("ArrowLeft");
    assert.deepEqual(await call("widgetSelected"), ["80"]);
    await compose("한", true);
    assert.equal((await call<{ text: string } | null>("editing"))?.text, "80한");
    await h.page.keyboard.press("Enter");
    assert.match(await doc(), /\| 운영비 +\| 80한 +\| 90 +\|/);
    assert.equal((await doc()).split("한").length - 1, 1);
    await idle();
    await h.page.keyboard.press("Escape");
    await drag("100", "200");
    await h.page.keyboard.type("x");
    assert.equal((await call<{ text: string } | null>("editing"))?.text, "200x");
    await h.page.keyboard.press("Escape");
  });

  test("a table in a block quote: the menu acts on it and keeps it shown", async () => {
    const quoted = "Text\n\n> | a | b |\n> |---|---|\n> | 1 | 2 |\n\nEnd\n";
    await setDoc(quoted);
    await cell("1").click({ button: "right" });
    await h.page.locator(".cm-ltem-menu-item", { hasText: "Insert column right" }).click();
    assert.equal(await doc(), "Text\n\n> | a   |     | b   |\n> | --- | --- | --- |\n> | 1   |     | 2   |\n\nEnd\n");
    assert.equal(await call("widgetCount"), 1);
    await idle();
    assert.deepEqual(await call("widgetSelected"), [""]);
  });

  test("Paste from the menu: cells from the system clipboard fill the table from the clicked cell", async () => {
    await setDoc(DOC);
    await call("writeClipboard", "P\tQ\nR\tS");
    await cell("80").click({ button: "right" });
    await h.page.locator(".cm-ltem-menu-item", { hasText: /^Paste/ }).click();
    await h.page.waitForFunction(() => (window as never as { ltemTest: { doc(): string } }).ltemTest.doc().includes("| P"));
    assert.match(await doc(), /\| 운영비 +\| P +\| Q +\|\n\| +\| R +\| S +\|/);
    assert.equal(await call("widgetCount"), 1);
  });

  test("Paste from the menu in the source: an HTML table keeps its merged cells", async () => {
    await call("setWidgets", false);
    await call("setMenuClipboard", "", '<table><tr><td colspan="2">합계</td></tr></table>');
    await setDoc(DOC);
    await h.page.locator(".cm-line", { hasText: "운영비" }).click({ button: "right", position: { x: 30, y: 5 } });
    await h.page.locator(".cm-ltem-menu-item", { hasText: /^Paste/ }).click();
    await h.page.waitForFunction(() => (window as never as { ltemTest: { doc(): string } }).ltemTest.doc().includes("합계"));
    assert.match(await doc(), /\| 합계 +\| << +\| 90 +\|/);
    await call("setMenu", null);
    await call("setWidgets", true);
  });

  test("cells pasted on a shown table: images through the application's function", async () => {
    await setDoc(DOC);
    await cell("80").click({ button: "right" });
    await h.page.keyboard.press("Escape");
    await call("paste", "", '<table><tr><td><img src="data:image/png;base64,AAAA" alt="도표"></td><td>x</td></tr></table>');
    assert.match(await doc(), /\| 운영비 +\| !\[도표\]\(img\/도표\.png\) +\| x +\|/);
    assert.equal(await call("widgetCount"), 1);
  });

  test("a menu action after editing a cell keeps the edit", async () => {
    await setDoc(DOC);
    await cell("인건비").click();
    await compose("표");
    await cell("200").click({ button: "right" });
    await h.page.locator(".cm-ltem-menu-item", { hasText: "Delete column" }).click();
    const text = await doc();
    assert.match(text, /인건비표/);
    assert.ok(!text.includes("하반기"), text);
  });
});
