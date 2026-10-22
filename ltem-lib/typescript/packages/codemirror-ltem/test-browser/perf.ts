/**
 * Main-thread work per action in headless Chromium, in documents with large LTEM tables:
 * typing in a cell, moving the cursor (with tables shown as tables, too) and Tab, which
 * lines up the columns. Prints a table of results; it is a measurement, not a pass/fail
 * test.
 *
 *     npm run build && npm run bundle:test && node test-browser/perf.ts
 */

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";

const PAGE = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "dist", "page.html")).href;
// A folder with system libraries that Chromium needs on machines that lack them; added to LD_LIBRARY_PATH when set.
const LIBS = process.env.LTEM_CHROMIUM_LIBS;

function table(rows: number, cols: number, label: string): string {
  const header = `| ${Array.from({ length: cols }, (_, c) => `열 ${c + 1}`).join(" | ")} |`;
  const body = Array.from({ length: rows }, (_, r) =>
    `| ${Array.from({ length: cols }, (_, c) => (c === 0 ? `${label} ${r + 1}` : c % 3 === 0 ? "<<" : `값 ${r}-${c}`)).join(" | ")} |`);
  return [header, `|${"---|".repeat(cols)}`, ...body].join("\n");
}
const paragraph = "공공기관 문서의 표를 옮긴 예시 문단이다. Markdown text with **emphasis** and `code`.\n";
const docs: Record<string, string> = {
  "50 x 10 table": table(50, 10, "행"),
  "200 x 30 table": table(200, 30, "행"),
  "1,000 x 10 table": table(1000, 10, "행"),
  "50 tables of 50 x 10": Array.from({ length: 50 }, (_, i) => `## 표 ${i + 1}\n\n${paragraph}\n${table(50, 10, `표${i + 1}`)}\n`).join("\n"),
  "1 MB document": (() => {
    let s = "";
    for (let i = 0; s.length < 1_000_000; i++) {
      s += `## 절 ${i}\n\n${paragraph.repeat(8)}\n${i % 10 === 0 ? table(40, 8, `t${i}`) + "\n\n" : ""}`;
    }
    return s;
  })(),
};

const browser = await chromium.launch({ env: { ...process.env, LD_LIBRARY_PATH: [LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") } });

type Kind = "type" | "move" | "tab";
interface Result { open: number; type: [number, number]; move: [number, number]; moveWidgets?: [number, number]; firstTab?: number; tab?: [number, number] }

async function measure(baseline: boolean): Promise<Record<string, Result>> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(PAGE + (baseline ? "#baseline" : ""));
  const out: Record<string, Result> = {};
  for (const [name, doc] of Object.entries(docs)) {
    out[name] = await page.evaluate(async ([d, base]) => {
      const t = (window as never as { ltemTest: {
        setDoc(d: string, c: number): void; setWidgets(on: boolean): void;
        work(kind: Kind, pos: number, n: number): Promise<number[]>;
      } }).ltemTest;
      const stats = (xs: number[]): [number, number] => {
        const s = [...xs].sort((a, b) => a - b);
        return [s[Math.floor(s.length / 2)], s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]];
      };
      const middle = d.indexOf("값", Math.floor(d.length / 2)) + 1;
      const third = d.indexOf("\n", Math.floor(d.length / 3)) + 1;
      const t0 = performance.now();
      t.setDoc(d, middle);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const open = performance.now() - t0;
      // Each group starts after the linter has run on the last change, so that it does not
      // fall into the timed actions.
      const settle = (): Promise<unknown> => new Promise((r) => setTimeout(r, 400));
      await t.work("type", middle, 10); // warm up
      const type = stats(await t.work("type", middle, 60));
      await settle();
      const result: Result = { open, type, move: stats(await t.work("move", third, 60)) };
      if (base) return result;
      t.setWidgets(true);
      await settle();
      result.moveWidgets = stats(await t.work("move", third, 60));
      t.setWidgets(false);
      await settle();
      // The first Tab lines up the whole table; later ones only what typing changed.
      result.firstTab = (await t.work("tab", middle, 1))[0];
      result.tab = stats(await t.work("tab", middle, 40));
      return result;
    }, [doc, baseline] as const);
  }
  await page.close();
  return out;
}

// A round of each first, so that the timed rounds run warm (compiled) code.
await measure(false);
const ltem = await measure(false);
const base = await measure(true);
const fmt = (x: number): string => x.toFixed(1).padStart(5);
const pair = (x: [number, number] | undefined): string => (x ? `${fmt(x[0])} / ${fmt(x[1])}` : "");
console.log("Main-thread work per action in ms (median / p95), headless Chromium, 1280 x 900");
console.log("Baseline: CodeMirror's Markdown with GFM tables, without LTEM, on the same documents.\n");
console.log(`${"document".padEnd(22)} | open | type          | type (base)   | move cursor   | move (base)   | move, widgets | first Tab | Tab           `);
for (const name of Object.keys(docs)) {
  const l = ltem[name];
  const b = base[name];
  console.log(`${name.padEnd(22)} | ${l.open.toFixed(0).padStart(4)} | ${pair(l.type)} | ${pair(b.type)} | ${pair(l.move)} | ${pair(b.move)} | ${pair(l.moveWidgets)} | ${fmt(l.firstTab!)}     | ${pair(l.tab)}`);
}

// Large tables shown as tables: opening the document (only the blocks near the screen are
// drawn) and typing in the text above the table.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(PAGE);
  console.log("\nTables shown as tables: open, and a key typed above the table (median), ms");
  for (const rows of [1000, 5000]) {
    const doc = `Text\n\n${table(rows, 10, "행")}\n\nEnd\n`;
    const r = await page.evaluate(async (d) => {
      const t = (window as never as { ltemTest: Record<string, (...a: unknown[]) => unknown> & { view: { state: { doc: { length: number } }; dispatch(s: object): void } } }).ltemTest;
      const frame = (): Promise<unknown> => new Promise((res) => requestAnimationFrame(() => res(null)));
      t.setWidgets(true);
      t.view.dispatch({ changes: { from: 0, to: t.view.state.doc.length, insert: "" } });
      await frame();
      const t0 = performance.now();
      t.view.dispatch({ changes: { from: 0, to: t.view.state.doc.length, insert: d }, selection: { anchor: 0 } });
      void document.body.offsetHeight;
      await frame();
      const open = performance.now() - t0;
      await new Promise((res) => setTimeout(res, 300));
      const times: number[] = [];
      for (let i = 0; i < 30; i++) {
        const s = performance.now();
        t.view.dispatch({ changes: { from: 2, insert: "가" }, selection: { anchor: 3 } });
        void document.body.offsetHeight;
        times.push(performance.now() - s);
        await frame();
      }
      times.sort((a, b) => a - b);
      const drawn = document.querySelectorAll(".cm-ltem-widget tr:not(.cm-ltem-gap)").length;
      t.setWidgets(false);
      return { open, type: times[15], drawn };
    }, doc);
    console.log(`${`${rows.toLocaleString("en")} x 10 table`.padEnd(22)} | open ${r.open.toFixed(0).padStart(4)} ms | type above ${r.type.toFixed(1)} ms | rows drawn ${r.drawn}`);
  }
  await page.close();
}

// Typing in a cell of a shown table, being edited: the browser's work per key (all
// main-thread tasks, as the DevTools protocol counts them), which is layout and paint.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(PAGE);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  console.log("\nTables shown as tables: a key typed in a cell being edited (all main-thread work), ms");
  for (const [rows, cols] of [[200, 30], [1000, 10]] as const) {
    const doc = `Text\n\n${table(rows, cols, "행")}\n\nEnd\n`;
    await page.evaluate((d) => {
      const t = (window as never as { ltemTest: { setWidgets(on: boolean): void; setDoc(d: string, c: number): void } }).ltemTest;
      t.setWidgets(true);
      t.setDoc(d, 0);
      window.scrollTo(0, 0);
    }, doc);
    await page.waitForTimeout(500);
    // A row near the top: a large table draws only the blocks near the screen.
    await page.locator(`.cm-ltem-widget td[data-row="${rows > 200 ? 10 : 100}"][data-col="1"]`).click();
    for (let i = 0; i < 5; i++) await cdp.send("Input.insertText", { text: "a" });
    const task = async (): Promise<number> => ((await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration")?.value ?? 0);
    const before = await task();
    for (let i = 0; i < 30; i++) {
      await cdp.send("Input.insertText", { text: "가" });
      await page.waitForTimeout(40);
    }
    const perKey = ((await task()) - before) * 1000 / 30;
    await page.keyboard.press("Escape");
    console.log(`${`${rows.toLocaleString("en")} x ${cols} table`.padEnd(22)} | ${perKey.toFixed(1)} ms per key`);
  }
  await page.close();
}
await browser.close();
