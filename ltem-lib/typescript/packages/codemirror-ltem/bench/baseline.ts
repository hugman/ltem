/**
 * Per-keystroke parse time: LTEM tables in this package against CodeMirror's own GFM tables
 * (`markdown({ base: markdownLanguage })`) on the same plain tables, so the cost of
 * CodeMirror's Markdown mode itself is visible.
 *
 *     node bench/baseline.ts
 */

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";

import { ltemMarkdownLanguage } from "../dist/index.js";

function table(rows: number, cols: number, markers: boolean): string {
  const header = `| ${Array.from({ length: cols }, (_, c) => `열 ${c + 1}`).join(" | ")} |`;
  const body = Array.from({ length: rows }, (_, r) =>
    `| ${Array.from({ length: cols }, (_, c) => (markers && c % 3 === 0 && c ? "<<" : `값 ${r}-${c}`)).join(" | ")} |`);
  return [header, `|${"---|".repeat(cols)}`, ...body].join("\n");
}

function perKey(doc: string, ext: Extension): number {
  let state = EditorState.create({ doc, extensions: [ext] });
  ensureSyntaxTree(state, doc.length, 60_000);
  let pos = state.doc.lineAt(Math.floor(doc.length / 2)).from + 4;
  const times: number[] = [];
  for (let i = 0; i < 120; i++) {
    const t = performance.now();
    state = state.update({ changes: { from: pos, insert: "가" }, selection: EditorSelection.cursor(pos + 1) }).state;
    pos++;
    ensureSyntaxTree(state, state.doc.length, 60_000);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

for (const [rows, cols] of [[50, 10], [200, 30], [1000, 10]]) {
  const plain = table(rows, cols, false);
  const gfm = perKey(plain, markdown({ base: markdownLanguage }));
  const ltemPlain = perKey(plain, ltemMarkdownLanguage());
  const ltemMarkers = perKey(table(rows, cols, true), ltemMarkdownLanguage());
  console.log(`${rows} x ${cols}: GFM (CodeMirror) ${gfm.toFixed(2)} ms | LTEM, same table ${ltemPlain.toFixed(2)} ms | LTEM with << ${ltemMarkers.toFixed(2)} ms  (median per key)`);
}
