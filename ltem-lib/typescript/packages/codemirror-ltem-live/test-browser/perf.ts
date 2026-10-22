/**
 * Main-thread work per keystroke with Live Preview on and off (the source), in headless
 * Chromium: a 1 MB Markdown document with tables, and a table of 1,000 rows. It is a
 * measurement, not a pass/fail test.
 *
 *     npm run build && npm run bundle:test && node test-browser/perf.ts
 */

import { open } from "./harness.ts";

function table(rows: number, cols: number): string {
  const header = `| ${Array.from({ length: cols }, (_, c) => `열 ${c + 1}`).join(" | ")} |`;
  const body = Array.from({ length: rows }, (_, r) => `| ${Array.from({ length: cols }, (_, c) => (c === 0 ? `행 ${r + 1}` : `값 ${r}-${c}`)).join(" | ")} |`);
  return [header, `|${"---|".repeat(cols)}`, ...body].join("\n");
}
const section = (i: number): string => [
  `## 절 ${i}`, "",
  `공공기관 문서의 **표**를 옮긴 예시 문단이다. *기울임*과 \`코드\`, [링크](http://example.com/${i}) 가 있다.`,
  `둘째 줄에는 ~~취소~~ 와 https://example.com/bare 가 있다.`, "",
  "- 항목 하나", "- [ ] 할 일", "  1. 번호", "", "> 인용 글", "",
  ...(i % 10 === 0 ? [table(30, 6), ""] : []),
].join("\n");
let big = "";
for (let i = 0; big.length < 1_000_000; i++) big += `${section(i)}\n`;
let notes = "";
for (let i = 0; notes.length < 1_000_000; i++) notes += `${section(i)}각주가 있는 문장[^n${i}] 과 인라인^[각주 ${i}].\n\n[^n${i}]: ${i}번 각주의 내용이다.\n\n`;
const docs: Record<string, { doc: string; at: (d: string) => number }> = {
  "1 MB with 2,000 footnotes": { doc: notes, at: (d) => d.indexOf("둘째 줄", Math.floor(d.length / 2)) + 3 },
  "1 MB document, in a paragraph": { doc: big, at: (d) => d.indexOf("둘째 줄", Math.floor(d.length / 2)) + 3 },
  "1,000-row table, in a cell": { doc: `글\n\n${table(1000, 10)}\n\n끝\n`, at: (d) => d.indexOf("값 500-3") + 3 },
};

const h = await open();
console.log("Main-thread work per keystroke, ms (median / p95), headless Chromium");
for (const [name, { doc, at }] of Object.entries(docs)) {
  const row: string[] = [];
  for (const live of [true, false]) {
    const r = await h.page.evaluate(async ([d, pos, on]) => {
      const t = (window as never as { ltemTest: Record<string, (...a: unknown[]) => unknown> }).ltemTest;
      t.setLive(on);
      t.setDoc(d, 0);
      await new Promise((res) => setTimeout(res, 300));
      await (t.work(pos, 10) as Promise<number[]>);
      const times = [...(await (t.work((pos as number) + 10, 60) as Promise<number[]>))].sort((a, b) => a - b);
      return [times[30], times[57]];
    }, [doc, at(doc), live] as const);
    row.push(`${live ? "live" : "source"} ${r[0].toFixed(1)} / ${r[1].toFixed(1)}`);
  }
  console.log(`${name.padEnd(32)} | ${row.join(" | ")}`);
}
await h.browser.close();
