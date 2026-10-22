/** Cell positions, commands, paste, copy, alignment and diagnostics. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, Text, type Extension, type StateCommand, type Transaction } from "@codemirror/state";

import {
  alignCenter, alignNone, analyzeTable, copyHtml, deleteColumnAt, editCellText, deleteRowAt, displayWidth, enterInTable, formatTable,
  insertCellLineBreak, insertColumnLeft, insertColumnRight, insertRowAbove, insertRowBelow, insertTable, lineChanges,
  ltemAutoAlign, ltemDiagnostics, ltemMarkdownLanguage, mergeDown, mergeRight, moveColumnLeft, moveColumnRight, moveRowDown, moveRowUp,
  makeBodyRow, makeHeaderRow, nextCell, pasteHtmlTables, previousCell, splitCellAt, tableAt, writeAligned,
} from "../dist/index.js";
import { loadExamples } from "../../../test-support/conformance.ts";

function state(doc: string, cursor = 0, extensions: Extension = []): EditorState {
  const s = EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [ltemMarkdownLanguage(), extensions] });
  ensureSyntaxTree(s, doc.length, 10_000);
  return s;
}

/** Run a command with the cursor after the first occurrence of `marker` (removed from the text). */
function run(command: StateCommand, docWithCursor: string, extensions: Extension = []): { doc: string; head: number; anchor: number; ok: boolean } {
  const cursor = docWithCursor.indexOf("‸");
  let s = state(docWithCursor.replace("‸", ""), cursor, extensions);
  let ok = false;
  command({ state: s, dispatch: (tr: Transaction) => { s = tr.state; ok = true; } });
  return { doc: s.doc.toString(), head: s.selection.main.head, anchor: s.selection.main.anchor, ok };
}

const noAlign = ltemAutoAlign.of(false);

function kinds(lines: string[]): string[][] {
  const a = analyzeTable(lines)!;
  return a.rows.map((r) => r.cells.map((c) => `${c.kind}${c.row >= 0 ? `@${c.row},${c.col}` : ""}`));
}

describe("cell positions in compact rows", () => {
  test("an attribute in a compact header row", () => {
    assert.deepEqual(kinds(["| Revenue {c:2} |", "|---|---|", "| Q1 | Q2 |"]), [
      ["origin@0,0"], ["delimiter", "delimiter"], ["origin@1,0", "origin@1,1"],
    ]);
  });

  test("a block attribute and a compact second row", () => {
    assert.deepEqual(kinds(["| Summary {c:2,r:2} | Note |", "| Q4 |", "|----|----|----|"]), [
      ["origin@0,0", "origin@0,2"], ["origin@1,2"], ["delimiter", "delimiter", "delimiter"],
    ]);
  });

  test("markers and a leftover empty cell", () => {
    assert.deepEqual(kinds(["| A | B | C |", "|---|---|---|", "| x | << | z | |"])[2],
      ["origin@1,0", "colspan@1,1", "origin@1,2", "ignored"]);
  });

  test("a ^^ under a cell that an attribute widened", () => {
    assert.deepEqual(kinds(["| a | b | c |", "|---|---|---|", "| wide {c:2} | z |", "| ^^ | y |"])[3],
      ["rowspan@2,0", "origin@2,2"]);
  });

  test("a ^^ next to a cell whose rows an attribute fixed", () => {
    assert.deepEqual(kinds(["| a | b |", "|---|---|", "| x {r:2} | y |", "| ^^ |"])[3], ["rowspan@2,1"]);
  });

  test("every origin cell of the specification examples is found where the core put it", () => {
    for (const ex of loadExamples()) {
      for (const table of ex.tables) {
        const s = state(ex.ltem);
        const info = tableAt(s, s.doc.toString().indexOf("|") >= 0 ? s.doc.toString().indexOf("|") : 0);
        if (!info) continue;
        const a = info.analysis;
        a.table.cells.forEach((cell, i) => {
          const src = a.result.sources[i];
          const row = a.rows.find((r) => r.line === src.line - a.result.start)!;
          const found = row.cells.find((c) => c.start === src.start && c.end === src.end && c.kind === "origin");
          // A cell added by padding (rule V14) has no source of its own.
          if (!found && src.start === src.end && src.start === a.lines[row.line].length) return;
          assert.ok(found && found.row === cell.row && found.col === cell.col, `example ${ex.example}, cell ${cell.row},${cell.col}`);
        });
        void table;
      }
    }
  });
});

describe("commands", () => {
  const T = "| a | b |\n|---|---|\n| 1 | 2 |\n";

  test("format lines up the columns, counting Korean as two", () => {
    const r = run(formatTable, "| 구분 | 금액 |\n|---|---:|\n| 인건비‸ | 100 |\n");
    assert.equal(r.doc, "| 구분   | 금액 |\n| ------ | ---: |\n| 인건비 | 100  |\n");
    assert.equal(r.doc.slice(0, r.head).split("\n").length, 3); // still in the body row
  });

  test("insert and delete rows and columns", () => {
    assert.equal(run(insertRowBelow, "| a | b |\n|---|---|\n| 1‸ | 2 |\n").doc, "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n");
    assert.equal(run(insertRowAbove, "| a | b |\n|---|---|\n| 1‸ | 2 |\n").doc, "| a   | b   |\n| --- | --- |\n|     |     |\n| 1   | 2   |\n");
    assert.equal(run(insertColumnRight, "| a‸ | b |\n|---|---|\n| 1 | 2 |\n").doc, "| a   |     | b   |\n| --- | --- | --- |\n| 1   |     | 2   |\n");
    assert.equal(run(insertColumnLeft, "| a | b‸ |\n|---|---|\n| 1 | 2 |\n").doc, "| a   |     | b   |\n| --- | --- | --- |\n| 1   |     | 2   |\n");
    assert.equal(run(deleteColumnAt, "| a | b‸ |\n|---|---|\n| 1 | 2 |\n").doc, "| a   |\n| --- |\n| 1   |\n");
    assert.equal(run(deleteRowAt, "| a | b |\n|---|---|\n| 1‸ | 2 |\n| 3 | 4 |\n").doc, "| a   | b   |\n| --- | --- |\n| 3   | 4   |\n");
    assert.equal(run(deleteRowAt, "| a‸ | b |\n|---|---|\n| 1 | 2 |\n").ok, false); // the only header row
    void T;
  });

  test("header rows and body rows; a merged cell across the new line is cut there", () => {
    assert.equal(run(makeHeaderRow, "| a | b |\n|---|---|\n| 1‸ | 2 |\n| 3 | 4 |\n").doc, "| a   | b   |\n| 1   | 2   |\n| --- | --- |\n| 3   | 4   |\n");
    // 구분 spans both header rows; making the second a body row cuts it (rule V7).
    assert.equal(run(makeBodyRow, "| 구분 | 금액 |\n| ^^ | 상‸ |\n|---|---|\n| 인건비 | 1 |\n").doc,
      "| 구분   | 금액 |\n| ------ | ---- |\n|        | 상   |\n| 인건비 | 1    |\n");
    assert.equal(run(makeHeaderRow, "| a | b |\n|---|---|\n| x | 1‸ |\n| ^^ | 2 |\n").doc, "| a   | b   |\n| x   | 1   |\n| --- | --- |\n|     | 2   |\n");
    // The first row made a body row: an empty header row above (a table with no header, Section 11).
    assert.equal(run(makeBodyRow, "| a‸ | b |\n|---|---|\n| 1 | 2 |\n").doc, "|     |     |\n| --- | --- |\n| a   | b   |\n| 1   | 2   |\n");
    // In a table with no header, a row made a header row takes the empty header row's place.
    assert.equal(run(makeHeaderRow, "|  |  |\n|---|---|\n| 1 | 2 |\n| 3‸ | 4 |\n| 5 | 6 |\n").doc, "| 1   | 2   |\n| 3   | 4   |\n| --- | --- |\n| 5   | 6   |\n");
    assert.equal(run(makeBodyRow, "|  | ‸ |\n|---|---|\n| 1 | 2 |\n").ok, false); // the empty header row
    assert.equal(run(makeHeaderRow, "| a‸ | b |\n|---|---|\n| 1 | 2 |\n").ok, false); // a header row already
  });

  test("a row inserted into a span widens it", () => {
    const r = run(insertRowBelow, "| a | b |\n|---|---|\n| x | 1‸ |\n| ^^ | 2 |\n");
    assert.equal(r.doc, "| a   | b   |\n| --- | --- |\n| x   | 1   |\n| ^^  |     |\n| ^^  | 2   |\n");
  });

  test("merge and split", () => {
    assert.equal(run(mergeRight, "| a‸ | b |\n|---|---|\n| 1 | 2 |\n").doc, "| a \\\\ b | <<  |\n| ------ | --- |\n| 1      | 2   |\n");
    assert.equal(run(mergeDown, "| a | b |\n|---|---|\n| 1‸ | 2 |\n| 3 | 4 |\n").doc, "| a      | b   |\n| ------ | --- |\n| 1 \\\\ 3 | 2   |\n| ^^     | 4   |\n");
    assert.equal(run(mergeDown, "| a‸ | b |\n|---|---|\n| 1 | 2 |\n").ok, false); // header into body (V7)
    assert.equal(run(splitCellAt, "| a | << |\n|---|---|\n| 1 | 2‸ |\n").ok, false);
    assert.equal(run(splitCellAt, "| a‸ | << |\n|---|---|\n| 1 | 2 |\n").doc, "| a   |     |\n| --- | --- |\n| 1   | 2   |\n");
  });

  test("Tab moves to the next cell and adds a row after the last one", () => {
    const r = run(nextCell, "| a‸ | b |\n|---|---|\n| 1 | 2 |\n", noAlign);
    assert.equal(r.doc, "| a | b |\n|---|---|\n| 1 | 2 |\n");
    assert.equal(r.doc.slice(r.head - 1, r.head), "b");
    const last = run(nextCell, "| a | b |\n|---|---|\n| 1 | 2‸ |\n");
    assert.equal(last.doc, "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n");
    // In an empty cell the cursor goes where its text starts, not after the padding.
    assert.equal(last.head, last.doc.lastIndexOf("|     |     |") + 2);
    const empty = run(nextCell, "| a | b |\n|---|---|\n| 1‸ |   |\n", noAlign);
    assert.equal(empty.head, empty.doc.lastIndexOf("|   |") + 2);
    const back = run(previousCell, "| a | b |\n|---|---|\n| 1‸ | 2 |\n", noAlign);
    assert.equal(back.doc.slice(back.head - 1, back.head), "b");
    assert.equal(run(nextCell, "plain text‸\n").ok, false);
    // A cell added by padding (V14) has no source: the table is written out to make one.
    const padded = run(nextCell, "| a | b |\n|---|---|\n| 1‸ |\n");
    assert.equal(padded.doc, "| a   | b   |\n| --- | --- |\n| 1   |     |\n");
  });

  test("the cursor outside the pipes counts as the nearest cell", () => {
    assert.equal(run(insertRowBelow, "| a | b |\n|---|---|\n| 1 | 2 |‸\n").doc, "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n");
    assert.equal(run(insertColumnLeft, "‸| a | b |\n|---|---|\n| 1 | 2 |\n").doc, "|     | a   | b   |\n| --- | --- | --- |\n|     | 1   | 2   |\n");
  });

  test("a table in a block quote keeps its prefix", () => {
    assert.equal(run(insertRowBelow, "> | a | b |\n> |---|---|\n> | 1‸ | 2 |\n").doc,
      "> | a   | b   |\n> | --- | --- |\n> | 1   | 2   |\n> |     |     |\n");
  });
});

describe("keyboard and more commands", () => {
  test("Enter goes to the cell below, adds a row below the last, leaves on an empty last row", () => {
    const down = run(enterInTable, "| a | b |\n|---|---|\n| 1‸ | 2 |\n| 3 | 4 |\n", noAlign);
    assert.equal(down.doc, "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n");
    assert.equal(down.doc.slice(down.head - 1, down.head), "3");
    const header = run(enterInTable, "| a‸ | b |\n|---|---|\n| 1 | 2 |\n", noAlign);
    assert.equal(header.doc.slice(header.head - 1, header.head), "1"); // across the delimiter row
    const add = run(enterInTable, "| a | b |\n|---|---|\n| 1 | 2‸ |\n");
    assert.equal(add.doc, "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n");
    // A plain line right after a table is a body row (spec 2.4), so this one ends the document.
    const leave = run(enterInTable, "| a | b |\n|---|---|\n| 1 | 2 |\n|  ‸ |  |");
    assert.equal(leave.doc, "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n");
    assert.equal(leave.head, leave.doc.length);
    const leaveBlank = run(enterInTable, "| a | b |\n|---|---|\n| 1 | 2 |\n|  ‸ |  |\n\nnext\n");
    assert.equal(leaveBlank.doc, "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\nnext\n");
    assert.equal(run(enterInTable, "plain‸\n").ok, false);
  });

  test("Tab and Enter line up the columns as they move, when only spacing changes", () => {
    const tab = run(nextCell, "| 구분 | b |\n|---|---|\n| 인건비‸ | 2 |\n| 3 | 4 |\n");
    assert.equal(tab.doc, "| 구분   | b   |\n| ------ | --- |\n| 인건비 | 2   |\n| 3      | 4   |\n");
    assert.equal(tab.doc.slice(tab.anchor, tab.head), "2"); // the next cell's text, selected
    const enter = run(enterInTable, "| 구분 | b |\n|---|---|\n| 인건비‸ | 2 |\n| 3 | 4 |\n");
    assert.equal(enter.doc, tab.doc);
    assert.equal(enter.doc.slice(enter.head - 1, enter.head), "3");
    // Already lined up: only the cursor moves.
    const aligned = run(nextCell, "| 구분   | b   |\n| ------ | --- |\n| 인건비‸ | 2   |\n");
    assert.equal(aligned.doc, "| 구분   | b   |\n| ------ | --- |\n| 인건비 | 2   |\n");
    // Only spaces change: span attributes, escapes and problems stay as written.
    assert.equal(run(nextCell, "| a {c:2} | lost |\n|---|---|\n| \\-1‸ | 2 |\n").doc,
      "| a {c:2} | lost |\n| ------- | ---- |\n| \\-1     | 2    |\n");
    // Rows of different lengths (a compact row, a row with a cell too many): left as written.
    for (const doc of [
      "| x {c:2} |\n|---|---|\n| 1‸ | 2 |\n",
      "| a | b |\n|---|---|\n| 1‸ | 2 | 3 |\n",
    ]) {
      assert.equal(run(nextCell, doc).doc, doc.replace("‸", ""), doc);
    }
  });

  test("a rewritten table changes only the parts of lines that differ", () => {
    const doc = Text.of(["before", "| a | b |", "|---|---|", "| 1 | 2 |", "after"]);
    const from = 7;
    const to = from + "| a | b |\n|---|---|\n| 1 | 2 |".length;
    assert.deepEqual(lineChanges(doc, from, to, "| a | b |\n|---|---|\n| 1 | 2 |"), []);
    assert.deepEqual(lineChanges(doc, from, to, "| a | b |\n|---|---|\n| 10 | 2 |"), [{ from: 30, to: 30, insert: "0" }]);
    const check = (insert: string): void => {
      const changed = EditorState.create({ doc }).update({ changes: lineChanges(doc, from, to, insert) }).state.doc.toString();
      assert.equal(changed, doc.sliceString(0, from) + insert + doc.sliceString(to));
    };
    check("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
    check("| a | b |\n|---|---|");
    check("| x | b |\n|---|---|\n| 1 | 2 |\n|   |   |");
    check("| a | b |");
    check("");
  });

  test("Shift-Enter puts a line break in the cell", () => {
    const r = run(insertCellLineBreak, "| a | b |\n|---|---|\n| 1‸ | 2 |\n");
    assert.equal(r.doc, "| a | b |\n|---|---|\n| 1 \\\\  | 2 |\n");
    assert.equal(analyzeTable(r.doc.trim().split("\n"))!.table.cells[2].text, "1\n");
  });

  test("move rows and columns, not across merged cells or the delimiter row", () => {
    assert.equal(run(moveRowDown, "| a | b |\n|---|---|\n| 1‸ | 2 |\n| 3 | 4 |\n").doc, "| a   | b   |\n| --- | --- |\n| 3   | 4   |\n| 1   | 2   |\n");
    assert.equal(run(moveRowUp, "| a | b |\n|---|---|\n| 1‸ | 2 |\n").ok, false); // into the header
    assert.equal(run(moveRowDown, "| a | b |\n|---|---|\n| x‸ | 1 |\n| ^^ | 2 |\n").ok, false); // a rowspan
    assert.equal(run(moveColumnRight, "| a‸ | b |\n|:--|--:|\n| 1 | 2 |\n").doc, "| b   | a   |\n| --: | :-- |\n| 2   | 1   |\n");
    assert.equal(run(moveColumnLeft, "| a | << |\n|---|---|\n| 1 | 2‸ |\n").ok, false); // a colspan
  });

  test("column alignment", () => {
    assert.equal(run(alignCenter, "| a | b‸ |\n|---|---|\n| 1 | 2 |\n").doc, "| a   | b   |\n| --- | :-: |\n| 1   | 2   |\n");
    assert.equal(run(alignNone, "| a | b‸ |\n|---|--:|\n| 1 | 2 |\n").doc, "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n");
  });

  test("insert a table on lines of its own", () => {
    const r = run(insertTable({ rows: 2, cols: 2 }), "Text‸\n");
    assert.equal(r.doc, "Text\n\n|     |     |\n| --- | --- |\n|     |     |\n|     |     |\n");
    assert.equal(tableAt(state(r.doc), r.head)?.analysis.table.rows, 3);
  });
});

describe("paste", () => {
  test("an HTML table with merged cells becomes an LTEM table", () => {
    const html = '<table><tr><th rowspan="2">구분</th><th colspan="2">2024</th></tr><tr><th>상</th><th>하</th></tr>'
      + "<tr><td>인건비</td><td>1</td><td>2</td></tr></table>";
    const s = state("Text\n", 4);
    const tr = s.update(pasteHtmlTables(s, html)!);
    assert.equal(tr.state.doc.toString(), "Text\n\n| 구분   | 2024 | <<  |\n| ^^     | 상   | 하  |\n| ------ | ---- | --- |\n| 인건비 | 1    | 2   |\n");
  });

  test("HTML with other content is left to the editor", () => {
    assert.equal(pasteHtmlTables(state(""), "<p>text</p><table><tr><td>a</td></tr></table>"), null);
    assert.equal(pasteHtmlTables(state(""), "<b>bold</b>"), null);
  });

  test("Excel-style HTML: no header row, style attributes", () => {
    const html = '<html><body><!--StartFragment--><table border=0 style="border-collapse:collapse"><col width=64>'
      + '<tr height=20><td colspan=2 style="text-align:center">합계</td></tr><tr><td>1</td><td>2</td></tr>'
      + "<!--EndFragment--></table></body></html>";
    const warnings: string[] = [];
    const s = state("");
    const tr = s.update(pasteHtmlTables(s, html, { onWarnings: (w) => warnings.push(...w) })!);
    // The column's origin cells disagree on alignment (centre and none), so it has none.
    assert.equal(tr.state.doc.toString(), "| 합계 | <<  |\n| ---- | --- |\n| 1    | 2   |");
    assert.equal(warnings.length, 1); // first row used as the header
  });
});

describe("alignment and diagnostics", () => {
  test("display width", () => {
    assert.equal(displayWidth("abc"), 3);
    assert.equal(displayWidth("인건비"), 6);
    assert.equal(displayWidth("ｱ"), 1);
    assert.equal(displayWidth("Ａ"), 2);
  });

  test("writeAligned keeps spaces other than space and tab as text", () => {
    const a = analyzeTable(["| a\u3000 | \u00a0b |", "|---|---|", "| 1 | 2 |"])!;
    assert.deepEqual(analyzeTable(writeAligned(a.table).split("\n"))!.table, a.table);
  });

  test("writeAligned keeps the table", () => {
    const a = analyzeTable(["| Region | Revenue | << |", "| ^^ | Q1 | Q2 |", "|:--|--:|:-:|", "| Asia | 100 | 120 |"])!;
    const text = writeAligned(a.table);
    assert.equal(text, "| Region | Revenue | <<  |\n| ^^     | Q1      | Q2  |\n| :----- | ------: | :-: |\n| Asia   | 100     | 120 |");
    assert.deepEqual(analyzeTable(text.split("\n"))!.table, a.table);
  });

  test("problems are shown on their cells, V14 on the row as a warning", () => {
    const doc = "| A | B |\n|---|---|\n| << | 1 |\n| 1 |\n";
    const d = ltemDiagnostics(state(doc));
    assert.deepEqual(d.map((x) => [x.severity, doc.slice(x.from, x.to), x.message.slice(0, 4)]), [
      ["error", "<<", "V13:"], ["warning", "| 1 |", "V14:"],
    ]);
  });

  test("Korean messages and fix names", () => {
    const doc = "| A | B |\n|---|---|\n| << | 1 |\n| 1 |\n";
    const d = ltemDiagnostics(state(doc), 0, doc.length, { messages: "ko" });
    assert.match(d[0].message, /^V13: 늘릴 칸이 없는 병합 표시입니다/);
    assert.deepEqual(d[0].actions!.map((a) => a.name), ["글자로 쓰기", "표 정리"]);
    assert.match(d[1].message, /^V14: 이 행의 칸 수가/);
    assert.deepEqual(d[1].actions!.map((a) => a.name), ["표 정리"]);
    const own = ltemDiagnostics(state(doc), 0, doc.length, { messages: (p) => `rule ${p.rule}` });
    assert.deepEqual(own.map((x) => x.message), ["rule V13", "rule V14"]);
  });

  /** Apply a diagnostic's action as the lint panel does, on a stand-in for the view. */
  function applyAction(doc: string, which: (d: ReturnType<typeof ltemDiagnostics>) => { d: number; a: number }): string {
    let s = state(doc);
    const diagnostics = ltemDiagnostics(s);
    const { d, a } = which(diagnostics);
    const view = {
      get state() { return s; },
      dispatch(spec: Parameters<EditorState["update"]>[0]) { s = s.update(spec).state; },
    };
    diagnostics[d].actions![a].apply(view as never, diagnostics[d].from, diagnostics[d].to);
    return s.doc.toString();
  }

  test("fix table writes out the recovery rules, leaving no problem", () => {
    const doc = "Before\n\n| A | B | C |\n|---|---|---|\n| x {c:2} | lost | 1 |\n| 1 |\n\nAfter\n";
    const before = ltemDiagnostics(state(doc)).map((x) => x.message.slice(0, 3));
    assert.deepEqual(before, ["V6:", "V14"]);
    const fixed = applyAction(doc, (d) => ({ d: 0, a: d[0].actions!.length - 1 }));
    assert.equal(fixed, "Before\n\n| A   | B   | C   |\n| --- | --- | --- |\n| x   | <<  | 1   |\n| 1   |     |     |\n\nAfter\n");
    assert.deepEqual(ltemDiagnostics(state(fixed)), []);
  });

  test("text where a merged cell lies can be kept by shrinking the merge", () => {
    const doc = "| A | B | C |\n|---|---|---|\n| x {c:3} | kept \\\\ two | 1 |\n| y {r:2} | 2 | 3 |\n| below | 4 | 5 |\n";
    const names = ltemDiagnostics(state(doc), 0, doc.length, { messages: "ko" }).map((x) => [x.message.slice(0, 3), x.actions!.map((a) => a.name)]);
    assert.deepEqual(names, [["V6:", ["글자 살리기", "표 정리"]], ["V6:", ["글자 살리기", "표 정리"]], ["V5:", ["글자 살리기", "표 정리"]]]);
    const right = applyAction(doc, () => ({ d: 0, a: 0 }));
    // The text right of it comes back too, as the merge no longer covers it.
    assert.equal(right, "| A   | B           | C   |\n| --- | ----------- | --- |\n| x   | kept \\\\ two | 1   |\n| y   | 2           | 3   |\n| ^^  | 4           | 5   |\n");
    const below = applyAction(doc, () => ({ d: 2, a: 0 }));
    assert.match(below, /\| y +\| 2 +\| 3 +\|\n\| below \| 4 +\| 5 +\|\n$/);
  });

  test("a marker with no cell to extend can be written as text", () => {
    const doc = "| A | B |\n|---|---|\n| << | 1 |\n";
    const fixed = applyAction(doc, (d) => ({ d: d.findIndex((x) => x.message.startsWith("V13")), a: 0 }));
    assert.equal(fixed, "| A | B |\n|---|---|\n| \\<< | 1 |\n");
    assert.deepEqual(ltemDiagnostics(state(fixed)), []);
  });
});

describe("editing a cell's text in place", () => {
  /** The document after setting the text of cell (row, col) of the table at the start. */
  function setText(doc: string, row: number, col: number, text: string, extensions: Extension = []): string | null {
    const s = state(doc, 0, extensions);
    const spec = editCellText(s, tableAt(s, 0)!, row, col, text);
    return spec && s.update(spec).state.doc.toString();
  }
  const cellText = (doc: string, row: number, col: number): string =>
    analyzeTable(doc.trim().split("\n"))!.table.cells.find((c) => c.row === row && c.col === col)!.text;

  test("the text is escaped as the writer escapes it, and the columns lined up", () => {
    const doc = "| a | b |\n|---|---|\n| 1 | 2 |\n";
    assert.equal(setText(doc, 1, 0, "x|y"), "| a    | b   |\n| ---- | --- |\n| x\\|y | 2   |\n");
    assert.equal(setText(doc, 1, 0, "x|y", noAlign), "| a | b |\n|---|---|\n| x\\|y | 2 |\n");
    for (const text of ["x|y", "<<", "^^", "a {c:2}", "first\nsecond", "**굵게** `code`", ""]) {
      assert.equal(cellText(setText(doc, 1, 0, text, noAlign)!, 1, 0), text, text);
    }
  });

  test("lines, and a typed \\\\, become line breaks", () => {
    const doc = "| a | b |\n|---|---|\n| 1 | 2 |\n";
    assert.equal(setText(doc, 1, 1, "one\ntwo", noAlign), "| a | b |\n|---|---|\n| 1 | one \\\\ two |\n");
    assert.equal(cellText(setText(doc, 1, 1, "one \\\\ two")!, 1, 1), "one\ntwo");
  });

  test("a span attribute after the text stays, and the table is not rewritten", () => {
    assert.equal(setText("| x {c:2} |\n|---|---|\n| 1 | 2 |\n", 0, 0, "새 이름"), "| 새 이름 {c:2} |\n|---|---|\n| 1 | 2 |\n");
    assert.equal(setText("| {c:2} |\n|---|---|\n| 1 | 2 |\n", 0, 0, "y"), "| y {c:2} |\n|---|---|\n| 1 | 2 |\n");
  });

  test("an empty cell, a merged cell, an unchanged text", () => {
    assert.equal(setText("| a | b |\n|---|---|\n| 1 ||\n", 1, 1, "z", noAlign), "| a | b |\n|---|---|\n| 1 | z |\n");
    assert.equal(setText("| a | << |\n|---|---|\n| 1 | 2 |\n", 0, 0, "합계"), "| 합계 | <<  |\n| ---- | --- |\n| 1    | 2   |\n");
    assert.equal(setText("| a | b |\n|---|---|\n| 1 | 2 |\n", 1, 0, " 1 "), null);
    assert.equal(setText("| a | b |\n|---|---|\n| 1 |\n", 1, 1, "padded"), null); // not written (V14)
  });
});

describe("copy as HTML", () => {
  const doc = "Intro <b>\n\n| 구분 | 2024 | << |\n| ^^ | 상 | 하 |\n|---|---|---|\n| 인건비 | 1 | 2 |\n\nEnd\n";
  const tableFrom = doc.indexOf("| 구분");
  const tableTo = doc.indexOf("\n\nEnd");

  test("a selection with a whole table: the table with its merged cells, text as paragraphs", () => {
    const html = copyHtml(state(doc), 0, doc.length)!;
    assert.equal(html, '<p>Intro &lt;b&gt;</p>\n<table border="1" cellpadding="4" style="border-collapse: collapse">\n<thead>\n'
      + '<tr>\n<th rowspan="2">구분</th>\n<th colspan="2">2024</th>\n</tr>\n<tr>\n<th>상</th>\n<th>하</th>\n</tr>\n</thead>\n'
      + "<tbody>\n<tr>\n<td>인건비</td>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody>\n</table>\n<p>End</p>");
  });

  test("only the table, without borders", () => {
    const html = copyHtml(state(doc), tableFrom, tableTo, { borders: false })!;
    assert.match(html, /^<table>\n<thead>/);
    assert.match(html, /<\/table>$/);
  });

  test("part of a table, or no table, is copied as text only", () => {
    assert.equal(copyHtml(state(doc), tableFrom + 2, tableTo), null);
    assert.equal(copyHtml(state(doc), tableFrom, tableTo - 3), null);
    assert.equal(copyHtml(state(doc), 0, 9), null);
    assert.equal(copyHtml(state(doc), 5, 5), null);
  });

  test("a Markdown renderer renders the whole selection", () => {
    const seen: string[] = [];
    const html = copyHtml(state(doc), 0, doc.length, { renderMarkdown: (md) => (seen.push(md), "<table><tr><td>x</td></tr></table>") })!;
    assert.deepEqual(seen, [doc]);
    assert.equal(html, '<table border="1" cellpadding="4" style="border-collapse: collapse"><tr><td>x</td></tr></table>');
  });
});
