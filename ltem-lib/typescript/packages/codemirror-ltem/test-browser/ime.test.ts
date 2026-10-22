/**
 * Korean input (IME composition) in a real browser engine.
 *
 * Headless Chromium receives composition events through the DevTools protocol
 * (`Input.imeSetComposition`, `Input.insertText`), as a Korean input method sends them:
 * each keystroke updates the syllable being composed, and the syllable is committed when the
 * next one starts. This is close to, but not the same as, the Windows Korean IME; the same
 * cases are also tested by hand on Windows.
 *
 * Cases include problems reported in other editors: repeated characters and broken tables
 * when composing in a table cell (Obsidian, 2026-04), Enter during composition (Joplin
 * #16745), and characters lost at a line-wrap point.
 *
 *     npm run build && npm run test:browser
 *
 * Chromium needs some system libraries; if they are not installed, point
 * LTEM_CHROMIUM_LIBS at a folder that holds them.
 */

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Browser, type CDPSession, type Page } from "playwright";

const PAGE = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "dist",
  process.env.LTEM_SHADOW ? "page-shadow.html" : "page.html")).href;
// A folder with system libraries that Chromium needs on machines that lack them; added to LD_LIBRARY_PATH when set.
const LIBS = process.env.LTEM_CHROMIUM_LIBS;

let browser: Browser;
let page: Page;
let cdp: CDPSession;

before(async () => {
  browser = await chromium.launch({
    env: { ...process.env, LD_LIBRARY_PATH: [LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") },
  });
  page = await browser.newPage();
  await page.goto(PAGE);
  cdp = await page.context().newCDPSession(page);
});

after(async () => {
  await browser?.close();
});

/** Syllables of `word` as a Korean IME composes them: jamo by jamo, then committed. */
const SYLLABLES: Record<string, string[]> = {
  한: ["ㅎ", "하", "한"],
  글: ["ㄱ", "그", "글"],
  표: ["ㅍ", "표"],
  입: ["ㅇ", "이", "입"],
  력: ["ㄹ", "려", "력"],
};

async function composeSyllable(syllable: string, commit = true): Promise<void> {
  for (const text of SYLLABLES[syllable]) {
    await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
  }
  if (commit) await cdp.send("Input.insertText", { text: syllable });
}

async function compose(word: string): Promise<void> {
  for (const syllable of word) await composeSyllable(syllable);
}

async function setDoc(doc: string, cursor: number): Promise<void> {
  await page.evaluate(([d, c]) => (window as never as { ltemTest: { setDoc(d: string, c: number): void } }).ltemTest.setDoc(d, c), [doc, cursor] as const);
}

function call<T>(name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => {
    const t = (window as never as { ltemTest: Record<string, (...x: unknown[]) => unknown> }).ltemTest;
    return t[n as string](...(a as unknown[]));
  }, [name, args] as const) as Promise<T>;
}

const ltemClasses = (classes: string[]): string[] => classes.map((c) => c.split(" ").filter((x) => x.startsWith("cm-ltem")).join(" "));

describe("Korean composition", () => {
  const TABLE = "| 구분 | 금액 |\n|---|---|\n| 인건비 | 100 |\n";

  test("in a table cell: no repeated characters, the table stays", async () => {
    await setDoc(TABLE, TABLE.indexOf("인건비") + 3);
    await compose("한글");
    assert.equal(await call("doc"), "| 구분 | 금액 |\n|---|---|\n| 인건비한글 | 100 |\n");
    assert.deepEqual(await call("tables", 30), { count: 1, rows: 2, cols: 2, headerRows: 1 });
  });

  test("in an empty cell", async () => {
    const doc = "| 구분 | 금액 |\n|---|---|\n|  | 100 |\n";
    await setDoc(doc, doc.indexOf("|  |") + 2);
    await compose("입력");
    assert.equal(await call("doc"), "| 구분 | 금액 |\n|---|---|\n| 입력 | 100 |\n");
  });

  test("right before a pipe", async () => {
    await setDoc(TABLE, TABLE.indexOf(" | 100"));
    await compose("표");
    assert.equal(await call("doc"), "| 구분 | 금액 |\n|---|---|\n| 인건비표 | 100 |\n");
  });

  test("the table's line decorations do not change during composition", async () => {
    await setDoc(TABLE, TABLE.indexOf("인건비") + 3);
    const beforeClasses = ltemClasses(await call<string[]>("lineClasses"));
    await composeSyllable("한", false);
    assert.equal(await call("composing"), true);
    assert.deepEqual(ltemClasses(await call<string[]>("lineClasses")), beforeClasses);
    await cdp.send("Input.insertText", { text: "한" });
    assert.equal(await call("doc"), "| 구분 | 금액 |\n|---|---|\n| 인건비한 | 100 |\n");
  });

  test("Enter during composition commits the syllable once (Joplin #16745)", async () => {
    const doc = "문단\n";
    await setDoc(doc, 2);
    await composeSyllable("한", false);
    await page.keyboard.press("Enter");
    const text = await call<string>("doc");
    assert.equal([...text].filter((c) => c === "한").length, 1, JSON.stringify(text));
    assert.ok(text.startsWith("문단한"), JSON.stringify(text));
  });

  test("Enter during composition in a table cell: committed once, the table intact", async () => {
    await setDoc(TABLE, TABLE.indexOf("인건비") + 3);
    await composeSyllable("한", false);
    await page.keyboard.press("Enter");
    const text = await call<string>("doc");
    assert.equal([...text].filter((c) => c === "한").length, 1, JSON.stringify(text));
    assert.ok(text.includes("| 인건비한"), JSON.stringify(text));
    const shape = await call<{ count: number; cols: number }>("tables", 0);
    assert.deepEqual([shape.count, shape.cols], [1, 2], JSON.stringify(text));
  });

  test("Enter after composition moves to the next row, lining up the columns", async () => {
    const doc = "| 구분 | 금액 |\n|---|---|\n| 인건비 | 100 |\n| 운영비 | 80 |\n";
    await setDoc(doc, doc.indexOf("인건비") + 3);
    await compose("한");
    await page.keyboard.press("Enter");
    const head = await call<number>("head");
    const text = await call<string>("doc");
    assert.equal(text, "| 구분     | 금액 |\n| -------- | ---- |\n| 인건비한 | 100  |\n| 운영비   | 80   |\n");
    assert.equal(text.slice(head - 3, head), "운영비");
  });

  test("at a line-wrap point no character is lost", async () => {
    const long = "가나다라마바사아자차카타파하 ".repeat(12).trim();
    await setDoc(long + "\n", 0);
    // The end of the first visual line of the wrapped paragraph.
    const wrap = await page.evaluate(() => {
      const t = (window as never as { ltemTest: { view: { moveToLineBoundary(r: unknown, f: boolean, w: boolean): { head: number }; state: { selection: { main: unknown } } } } }).ltemTest;
      return t.view.moveToLineBoundary(t.view.state.selection.main, true, true).head;
    });
    assert.ok(wrap > 0 && wrap < long.length, `wraps at ${wrap}`);
    await setDoc(long + "\n", wrap);
    await compose("한글");
    assert.equal(await call("doc"), long.slice(0, wrap) + "한글" + long.slice(wrap) + "\n");
  });

  test("a table row in a block quote", async () => {
    const doc = "> | 구분 | 금액 |\n> |---|---|\n> | 인건비 | 100 |\n";
    await setDoc(doc, doc.indexOf("인건비") + 3);
    await compose("한글");
    assert.equal(await call("doc"), "> | 구분 | 금액 |\n> |---|---|\n> | 인건비한글 | 100 |\n");
  });
});

describe("tolerance while typing", () => {
  test("a table broken by an edit keeps a table look while the cursor is in it", async () => {
    const doc = "| a | b |\n|---|---|\n| 1 | 2 |\n";
    await setDoc(doc, doc.indexOf(" |\n"));
    // A third header cell: the header row no longer fits the delimiter row, so no table.
    await page.keyboard.type(" | c");
    assert.equal((await call<{ count: number }>("tables", 0)).count, 0);
    const pending = (await call<string[]>("lineClasses")).filter((c) => c.includes("cm-ltem-pending"));
    assert.equal(pending.length, 3);
    // Completing the delimiter row makes it a table again.
    await page.evaluate(() => {
      const t = (window as never as { ltemTest: { view: { state: { doc: { line(n: number): { to: number } } }; dispatch(s: unknown): void } } }).ltemTest;
      const end = t.view.state.doc.line(2).to;
      t.view.dispatch({ changes: { from: end, insert: "---|" }, selection: { anchor: end + 4 } });
    });
    assert.equal((await call<{ count: number }>("tables", 0)).count, 1);
  });
});

describe("tables shown as tables", () => {
  const DOC = "Text before\n\n| 구분 | 금액 |\n|---|---|\n| 인건비 | 100 |\n\nText after\n";

  test("a table is shown rendered when the cursor is outside it, as source when inside", async () => {
    await call("setWidgets", true);
    await setDoc(DOC, 0);
    assert.equal(await call("widgetCount"), 1);
    await setDoc(DOC, DOC.indexOf("인건비"));
    assert.equal(await call("widgetCount"), 0);
    await setDoc(DOC, DOC.length - 1);
    assert.equal(await call("widgetCount"), 1);
    // An Alt-click on the rendered table shows its source with the cursor in it.
    await page.click(".cm-ltem-widget", { modifiers: ["Alt"] });
    assert.equal(await call("widgetCount"), 0);
    const head = await call<number>("head");
    assert.ok(head >= DOC.indexOf("| 구분") && head <= DOC.indexOf("\n\nText after"), `cursor at ${head}`);
  });

  test("without editing in place, a click on a cell puts the cursor in that cell's source", async () => {
    const doc = "Text\n\n| 구분 | 2024 | <<  |\n| ^^   | 상   | 하  |\n|---|---|---|\n| 인건비 | 100 | 200 |\n\nEnd\n";
    await call("setWidgets", true, { editInPlace: false });
    for (const [cell, text] of [["td", "200"], ["th", "2024"], ["th", "구분"], ["td", "인건비"]]) {
      await setDoc(doc, 0);
      await page.locator(`.cm-ltem-widget ${cell}`, { hasText: new RegExp(`^${text}$`) }).click();
      assert.equal(await call("widgetCount"), 0);
      assert.equal(await call("head"), doc.indexOf(`| ${text}`) + 2 + text.length, `clicked ${text}`);
    }
    await call("setWidgets", false);
  });

  test("composing in a table with widgets on", async () => {
    await call("setWidgets", true);
    await setDoc(DOC, DOC.indexOf("인건비") + 3);
    await compose("한글");
    assert.equal(await call("doc"), DOC.replace("인건비", "인건비한글"));
    assert.equal(await call("widgetCount"), 0);
    await call("setWidgets", false);
  });
});

describe("copy, cut and fixes", () => {
  const DOC = "Intro\n\n| 구분 | 2024 | <<  |\n| ^^   | 상   | 하  |\n|---|---|---|\n| 인건비 | 1 | 2 |\n\nEnd\n";

  test("copying a whole table puts the source and an HTML table on the clipboard", async () => {
    await setDoc(DOC, 0);
    const out = await call<{ plain: string; html: string; handled: boolean }>("clipboard", 0, DOC.length, "copy");
    assert.ok(out.handled);
    assert.equal(out.plain, DOC);
    assert.match(out.html, /^<p>Intro<\/p>\n<table data-ltem-copy="source" border="1"/);
    assert.match(out.html, /<th rowspan="2">구분<\/th>\n<th colspan="2">2024<\/th>/);
    assert.equal(await call("doc"), DOC);
  });

  test("copying a range of cells puts tab-separated text and an HTML table on the clipboard", async () => {
    await setDoc(DOC, 0);
    const out = await call<{ plain: string; html: string; handled: boolean }>("clipboard", DOC.indexOf("상"), DOC.indexOf("| 2 |") + 3, "copy");
    assert.equal(out.plain, "상\t하\n1\t2");
    assert.match(out.html, /^<table border="1"[^>]*>\n<thead>\n<tr>\n<th>상<\/th>\n<th>하<\/th>/);
    assert.equal(await call("doc"), DOC);
    // Inside one cell it is text, as usual.
    const text = await call<{ plain: string; html: string }>("clipboard", DOC.indexOf("인건비"), DOC.indexOf("인건비") + 2, "copy");
    assert.equal(text.plain, "인건");
    assert.equal(text.html, "");
  });

  test("cutting a whole table removes it", async () => {
    await setDoc(DOC, 0);
    const from = DOC.indexOf("| 구분");
    const to = DOC.indexOf("\n\nEnd");
    const out = await call<{ plain: string; html: string; handled: boolean }>("clipboard", from, to, "cut");
    assert.ok(out.handled);
    assert.match(out.html, /^<table/);
    assert.equal(await call("doc"), "Intro\n\n\n\nEnd\n");
  });

  test("a fix from the lint panel", async () => {
    const doc = "| A | B |\n|---|---|\n| << | 1 |\n";
    await setDoc(doc, doc.length);
    await page.waitForFunction(() => (window as never as { ltemTest: { diagnostics(): number } }).ltemTest.diagnostics() === 1);
    await call("openLint");
    await page.locator(".cm-panel.cm-panel-lint button", { hasText: "Write as text" }).click();
    assert.equal(await call("doc"), "| A | B |\n|---|---|\n| \\<< | 1 |\n");
    await page.waitForFunction(() => (window as never as { ltemTest: { diagnostics(): number } }).ltemTest.diagnostics() === 0);
  });
});

describe("editing cells in place", () => {
  const DOC = "Text\n\n| 구분 | 금액 |\n|---|---|\n| 인건비 | 100 |\n| 운영비 | 80 |\n\nEnd\n";
  type Editing = { text: string; row: number; col: number } | null;
  const editing = (): Promise<Editing> => call<Editing>("editing");
  const cell = (text: string) => page.locator(".cm-ltem-widget td, .cm-ltem-widget th", { hasText: new RegExp(`^${text}$`) });

  before(async () => {
    await call("setWidgets", true);
  });
  after(async () => {
    await call("setWidgets", false);
  });

  test("a click edits the cell; Enter keeps the text and goes to the cell below", async () => {
    await setDoc(DOC, 0);
    await cell("100").click();
    assert.deepEqual(await editing(), { text: "100", row: 1, col: 1 });
    await page.keyboard.type("0");
    await page.keyboard.press("Enter");
    assert.equal(await call("doc"), "Text\n\n| 구분   | 금액 |\n| ------ | ---- |\n| 인건비 | 1000 |\n| 운영비 | 80   |\n\nEnd\n");
    await page.waitForFunction(() => (window as never as { ltemTest: { editingNow(): boolean } }).ltemTest.editingNow());
    assert.deepEqual(await editing(), { text: "80", row: 2, col: 1 });
    await page.keyboard.press("Escape");
    assert.equal(await editing(), null);
    assert.equal(await call("widgetCount"), 1);
  });

  test("Tab and Shift-Tab go on to the next and previous cells; Escape drops the edit", async () => {
    await setDoc(DOC, 0);
    await cell("구분").click();
    await page.keyboard.press("Tab");
    assert.deepEqual(await editing(), { text: "금액", row: 0, col: 1 });
    await page.keyboard.press("Tab");
    assert.deepEqual(await editing(), { text: "인건비", row: 1, col: 0 });
    await page.keyboard.press("Shift+Tab");
    assert.deepEqual(await editing(), { text: "금액", row: 0, col: 1 });
    await page.keyboard.type("XYZ");
    await page.keyboard.press("Escape");
    assert.equal(await call("doc"), DOC);
  });

  test("Korean composition in a cell: committed once", async () => {
    await setDoc(DOC, 0);
    await cell("운영비").click();
    await compose("한글");
    await page.keyboard.press("Enter");
    assert.equal(await call("doc"), "Text\n\n| 구분       | 금액 |\n| ---------- | ---- |\n| 인건비     | 100  |\n| 운영비한글 | 80   |\n\nEnd\n");
  });

  test("Enter during composition commits the syllable once and keeps the text (Joplin #16745)", async () => {
    await setDoc(DOC, 0);
    await cell("운영비").click();
    await composeSyllable("한", false);
    await page.keyboard.press("Enter");
    await cdp.send("Input.insertText", { text: "한" });
    await page.waitForFunction(() => !(window as never as { ltemTest: { doc(): string } }).ltemTest.doc().includes("| 운영비 "));
    const doc = await call<string>("doc");
    assert.match(doc, /\| 운영비한 +\| 80 +\|/);
    assert.equal(doc.split("한").length - 1, 1);
    assert.ok(!doc.includes("\\\\"), "no line break in the cell");
  });

  test("a click on another cell keeps the edit and edits that cell; a click outside keeps it", async () => {
    await setDoc(DOC, 0);
    await cell("인건비").click();
    await page.keyboard.type("A");
    await cell("80").click();
    await page.waitForFunction(() => (window as never as { ltemTest: { editingNow(): boolean } }).ltemTest.editingNow());
    assert.deepEqual(await editing(), { text: "80", row: 2, col: 1 });
    assert.match(await call<string>("doc"), /\| 인건비A \|/);
    await page.keyboard.type("5");
    await page.locator(".cm-line", { hasText: "End" }).click();
    assert.equal(await editing(), null);
    assert.match(await call<string>("doc"), /\| 805 +\|/);
  });

  test("a kept edit is one undo step; Shift-Enter starts a new line", async () => {
    await setDoc(DOC, 0);
    await cell("100").click();
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("원");
    await page.keyboard.press("Enter");
    assert.match(await call<string>("doc"), /\| 100 \\\\ 원 \|/);
    await page.keyboard.press("Escape");
    await call("undo");
    assert.equal(await call("doc"), DOC);
  });
});
