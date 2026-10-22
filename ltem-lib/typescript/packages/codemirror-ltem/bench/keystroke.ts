/**
 * Editor work per keystroke in documents with large LTEM tables (Node, no DOM).
 *
 * For each document the cursor is put in a cell in the middle of the largest table, and
 * characters are typed one by one. Each keystroke is timed from the transaction to a
 * syntax tree that covers the edited table again (which re-reads the table with the LTEM
 * core), plus the table's line decorations for a screenful of rows.
 *
 *     node bench/keystroke.ts
 */

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";

import { ltemMarkdownLanguage, NODE, tableAt } from "../dist/index.js";

function table(rows: number, cols: number, label: string): string {
  const header = `| ${Array.from({ length: cols }, (_, c) => `열 ${c + 1}`).join(" | ")} |`;
  const delimiter = `|${"---|".repeat(cols)}`;
  const body = Array.from({ length: rows }, (_, r) =>
    `| ${Array.from({ length: cols }, (_, c) => (c === 0 ? `${label} ${r + 1}` : c % 3 === 0 ? "<<" : `값 ${r}-${c}`)).join(" | ")} |`);
  return [header, delimiter, ...body].join("\n");
}

const paragraph = "공공기관 문서의 표를 옮긴 예시 문단이다. Markdown text with **emphasis** and `code`.\n";

const docs: Record<string, string> = {
  "200 rows x 30 cols": table(200, 30, "행"),
  "1,000 rows x 10 cols": table(1000, 10, "행"),
  "50 tables of 50 x 10": Array.from({ length: 50 }, (_, i) => `## 표 ${i + 1}\n\n${paragraph}\n${table(50, 10, `표${i + 1}`)}\n`).join("\n"),
  "1 MB document": (() => {
    let s = "";
    let i = 0;
    while (s.length < 1_000_000) {
      s += `## 절 ${i}\n\n${paragraph.repeat(8)}\n${i % 10 === 0 ? table(40, 8, `t${i}`) + "\n\n" : ""}`;
      i++;
    }
    return s;
  })(),
};

function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

for (const [name, doc] of Object.entries(docs)) {
  let state = EditorState.create({ doc, extensions: [ltemMarkdownLanguage()] });
  const t0 = performance.now();
  ensureSyntaxTree(state, doc.length, 60_000);
  const initial = performance.now() - t0;
  // The largest table, and a cell in its middle.
  let best: { from: number; to: number } | null = null;
  syntaxTree(state).iterate({ enter(n) {
    if (n.name === NODE.table) { if (!best || n.to - n.from > best.to - best.from) best = { from: n.from, to: n.to }; return false; }
    return true;
  } });
  const target = best as { from: number; to: number } | null;
  if (!target) throw new Error("no table");
  const middle = state.doc.lineAt(Math.floor((target.from + target.to) / 2));
  let pos = middle.from + middle.text.indexOf("값") + 1;
  state = state.update({ selection: EditorSelection.cursor(pos) }).state;
  const times: number[] = [];
  const text = "가나다라마바사아자차카타파하abcdefghij";
  for (let i = 0; i < 60; i++) {
    const ch = text[i % text.length];
    const t1 = performance.now();
    state = state.update({ changes: { from: pos, insert: ch }, selection: EditorSelection.cursor(pos + 1) }).state;
    pos++;
    const end = state.doc.lineAt(Math.min(state.doc.length, target.to + i + 1)).to;
    ensureSyntaxTree(state, end, 60_000);
    // Line decorations for about one screen of rows around the cursor.
    const line = state.doc.lineAt(pos);
    const from = state.doc.line(Math.max(1, line.number - 30)).from;
    const to = state.doc.line(Math.min(state.doc.lines, line.number + 30)).to;
    let rows = 0;
    syntaxTree(state).iterate({ from, to, enter(n) { if (n.name === NODE.row || n.name === NODE.headerRow) rows++; return true; } });
    times.push(performance.now() - t1);
  }
  const tableTime = (() => { const t = performance.now(); tableAt(state, pos); return performance.now() - t; })();
  const warm = times.slice(10);
  console.log(`${name.padEnd(22)} ${(doc.length / 1024).toFixed(0).padStart(5)} KB | first parse ${initial.toFixed(0).padStart(5)} ms | per key: median ${percentile(warm, 0.5).toFixed(2)} ms, p95 ${percentile(warm, 0.95).toFixed(2)} ms, max ${Math.max(...warm).toFixed(2)} ms | tableAt ${tableTime.toFixed(1)} ms`);
}
