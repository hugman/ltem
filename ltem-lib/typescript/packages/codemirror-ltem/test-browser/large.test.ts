/**
 * A large table shown as a table is drawn in blocks of rows, only near the screen. Editing
 * in place, ranges, the menu and Korean input work in it as in a small table.
 *
 *     npm run build && npm run test:browser
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { call as callIn, compose as composeIn, open, type Harness } from "./harness.ts";

let h: Harness;
before(async () => {
  h = await open();
  await call("setWidgets", true);
});
after(async () => {
  await h?.browser.close();
});

const call = <T>(name: string, ...args: unknown[]): Promise<T> => callIn<T>(h, name, ...args);
const doc = (): Promise<string> => call<string>("doc");
const idle = (): Promise<void> => h.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

const ROWS = 600;
function table(): string {
  const body = Array.from({ length: ROWS }, (_, r) => `| 행${r + 1} | ${r === 100 ? "병합" : r === 101 || r === 102 ? "^^" : `값${r + 1}`} | ${r + 1} |`);
  return ["| 구분 | 값 | 번호 |", "|---|---|---|", ...body].join("\n");
}
const DOC = `Text\n\n${table()}\n\nEnd\n`;

const drawnRows = (): Promise<number> => call<number>("count", ".cm-ltem-widget tr:not(.cm-ltem-gap)");
const cell = (text: string) => h.page.locator(".cm-ltem-widget td, .cm-ltem-widget th", { hasText: new RegExp(`^${text}$`) });
const drawn = async (text: string): Promise<boolean> => (await call<string[]>("texts", ".cm-ltem-widget td")).includes(text);

/** How the editor scrolls: with the page, or itself (a fixed height, as in an application). */
let scroller: "page" | "editor" = "page";

/** Scroll so that row `row` of the table is about at the top of the screen. */
async function scrollTo(row: number): Promise<void> {
  await h.page.evaluate(([r, mode]) => {
    const view = (window as never as { ltemTest: { view: { scrollDOM: HTMLElement } } }).ltemTest.view;
    const root = (window as never as { ltemTest: { root: ParentNode } }).ltemTest.root;
    const wrap = root.querySelector<HTMLElement>(".cm-ltem-widget")!;
    const offset = (Number(r) * wrap.offsetHeight) / 602;
    if (mode === "page") window.scrollTo(0, wrap.getBoundingClientRect().top + window.scrollY + offset);
    else view.scrollDOM.scrollTop += wrap.getBoundingClientRect().top - view.scrollDOM.getBoundingClientRect().top + offset;
  }, [row, scroller] as const);
  await idle();
  await idle();
}

for (const mode of ["page", "editor"] as const) {
describe(`a large table shown as a table (${mode} scrolls)`, () => {
  before(async () => {
    scroller = mode;
    await call("setHeight", mode === "editor" ? 600 : null);
  });
  test("only the blocks near the screen are drawn; scrolling draws others and lets go of far ones", async () => {
    await call("setDoc", DOC, 0);
    await idle();
    assert.ok(await drawnRows() < 200, `${await drawnRows()} rows drawn`);
    assert.ok(await drawn("값1"));
    assert.equal(await drawn("값400"), false);
    await scrollTo(400);
    assert.ok(await drawn("값400"));
    assert.equal(await drawn("값1"), false);
    assert.ok(await drawnRows() < 260, `${await drawnRows()} rows drawn`);
    // A merged cell is never cut by a block: its rows are drawn together.
    await scrollTo(100);
    const span = await call<number>("rowSpanOf", "병합");
    assert.equal(span, 3);
  });

  test("editing in place in the middle; Enter goes on to the next row, in the next block too", async () => {
    await call("setDoc", DOC, 0);
    await scrollTo(398);
    await cell("값399").click();
    await h.page.keyboard.type("x");
    await h.page.keyboard.press("Enter");
    await idle();
    assert.deepEqual((await call<{ text: string } | null>("editing"))?.text, "값400");
    await h.page.keyboard.press("Escape");
    assert.match(await doc(), /\| 행399 +\| 값399x +\| 399 +\|/);
  });

  test("a change made in the middle keeps the rows on the screen in their place", async () => {
    await call("setDoc", DOC, 0);
    await scrollTo(350);
    const y = async (text: string): Promise<number> => (await cell(text).boundingBox())!.y;
    const before = await y("값360");
    await cell("값355").click();
    await h.page.keyboard.type("z");
    await h.page.keyboard.press("Enter"); // the table changes and is drawn again
    await idle();
    await h.page.keyboard.press("Escape");
    await idle();
    assert.match(await doc(), /\| 값355z +\|/);
    const after = await y("값360");
    assert.ok(Math.abs(after - before) < 3, `moved from ${before} to ${after}`);
  });

  test("Korean composition in a cell of the middle", async () => {
    await call("setDoc", DOC, 0);
    await scrollTo(300);
    await cell("값301").click();
    await composeIn(h, "한글");
    await h.page.keyboard.press("Enter");
    assert.match(await doc(), /\| 행301 +\| 값301한글 +\| 301 +\|/);
    assert.equal((await doc()).split("한글").length - 1, 1);
    await h.page.keyboard.press("Escape");
  });

  test("ranges: a drag, Delete, and arrows that leave the drawn blocks", async () => {
    await call("setDoc", DOC, 0);
    await scrollTo(250);
    const a = (await cell("값251").boundingBox())!;
    const b = (await cell("252").boundingBox())!;
    await h.page.mouse.move(a.x + 5, a.y + 5);
    await h.page.mouse.down();
    await h.page.mouse.move(b.x + 5, b.y + 5, { steps: 3 });
    await h.page.mouse.up();
    assert.deepEqual(await call("widgetSelected"), ["값251", "251", "값252", "252"]);
    await h.page.keyboard.press("Delete");
    assert.match(await doc(), /\| 행251 +\| +\| +\|\n\| 행252 +\| +\| +\|/);
    await idle();
    // Down by 60 rows, past the end of the drawn blocks: the block is drawn, the cell selected.
    for (let i = 0; i < 60; i++) await h.page.keyboard.press("ArrowDown");
    await idle();
    assert.deepEqual(await call("widgetSelected"), ["312"]);
  });

  test("the menu in the middle: the table stays shown and the new row's cell is selected", async () => {
    await call("setDoc", DOC, 0);
    await scrollTo(450);
    await cell("값451").click({ button: "right" });
    await h.page.locator(".cm-ltem-menu-item", { hasText: "Insert row below" }).click();
    await idle();
    assert.equal(await call("widgetCount"), 1);
    assert.deepEqual(await call("widgetSelected"), [""]);
    assert.match(await doc(), /\| 행451 +\| 값451 +\| 451 +\|\n\| +\| +\| +\|\n\| 행452/);
  });

  test("a cell being edited stays drawn while the page scrolls away and back", async () => {
    await call("setDoc", DOC, 0);
    await scrollTo(500);
    await cell("값501").click();
    await h.page.keyboard.type("y");
    await scrollTo(0);
    await scrollTo(500);
    assert.equal((await call<{ text: string } | null>("editing"))?.text, "값501y");
    await h.page.keyboard.press("Enter");
    assert.match(await doc(), /\| 행501 +\| 값501y +\| 501 +\|/);
    await h.page.keyboard.press("Escape");
  });
});
}
