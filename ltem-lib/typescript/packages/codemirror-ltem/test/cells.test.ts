/** Ranges of cells, tab-separated text, and pasting into tables. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type StateCommand, type Transaction } from "@codemirror/state";

import {
  analyzeTable, cellRange, clearRange, clearSelectedCells, fillCells, ltemAutoAlign, ltemMarkdownLanguage, mergeRange,
  mergeSelectedCells, parseTsv, pasteTables, rangeHtml, rangeTsv, selectedCells, tsvTable, writeAligned,
} from "../dist/index.js";

const model = (text: string) => analyzeTable(text.trim().split("\n"))!.table;

function state(doc: string, anchor = 0, head = anchor, align = true): EditorState {
  const s = EditorState.create({
    doc, selection: EditorSelection.range(anchor, head), extensions: [ltemMarkdownLanguage(), ltemAutoAlign.of(align)],
  });
  ensureSyntaxTree(s, doc.length, 10_000);
  return s;
}

/** A state with the selection from the first "«" to the first "»" (both removed). */
function selecting(docWithMarks: string, align = true): EditorState {
  const anchor = docWithMarks.indexOf("«");
  const head = docWithMarks.replace("«", "").indexOf("»");
  return state(docWithMarks.replace("«", "").replace("»", ""), anchor, head, align);
}

function run(command: StateCommand, s: EditorState): string {
  let out = s;
  command({ state: s, dispatch: (tr: Transaction) => { out = tr.state; } });
  return out.doc.toString();
}

const MERGED = "| A | B | << |\n| ^^ | x | y |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |";

describe("ranges of cells in a table model", () => {
  test("a range widens over the merged cells it touches", () => {
    const t = model(MERGED);
    assert.deepEqual(cellRange(t, { row: 1, col: 1 }, { row: 1, col: 1 }), { top: 1, left: 1, bottom: 1, right: 1 });
    assert.deepEqual(cellRange(t, { row: 0, col: 1 }, { row: 1, col: 1 }), { top: 0, left: 1, bottom: 1, right: 2 });
    assert.deepEqual(cellRange(t, { row: 1, col: 0 }, { row: 2, col: 0 }), { top: 0, left: 0, bottom: 2, right: 0 });
  });

  test("merge a range: texts kept one per line; not across header and body", () => {
    const t = model(MERGED);
    // In canonical form a block is written with `<<` in its first column and `^^` below.
    assert.equal(writeAligned(mergeRange(t, { top: 2, left: 0, bottom: 3, right: 1 })!),
      "| A                | B   | <<  |\n| ^^               | x   | y   |\n| ---------------- | --- | --- |\n"
      + "| 1 \\\\ 2 \\\\ 4 \\\\ 5 | <<  | 3   |\n| ^^               | <<  | 6   |");
    assert.equal(mergeRange(t, { top: 1, left: 1, bottom: 2, right: 1 }), null);
    assert.equal(mergeRange(t, { top: 2, left: 0, bottom: 2, right: 0 }), null);
  });

  test("clear a range", () => {
    const t = clearRange(model(MERGED), { top: 2, left: 1, bottom: 3, right: 2 })!;
    assert.deepEqual(t.cells.filter((c) => c.row >= 2).map((c) => c.text), ["1", "", "", "4", "", ""]);
    assert.equal(clearRange(t, { top: 2, left: 1, bottom: 3, right: 2 }), null);
  });

  test("fill cells: the table grows and merged cells in the way are split", () => {
    const grown = fillCells(model(MERGED), { row: 1, col: 1 }, [["p", "q"], ["r", "s"], ["t", "u"], ["v", "w"]]);
    assert.equal(writeAligned(grown),
      "| A   | B   | <<  |\n| ^^  | p   | q   |\n| --- | --- | --- |\n| 1   | r   | s   |\n| 4   | t   | u   |\n|     | v   | w   |");
    const split = fillCells(model(MERGED), { row: 0, col: 2 }, [["n"]]);
    assert.equal(writeAligned(split).split("\n")[0], "| A   | B   | n   |");
  });
});

describe("tab-separated text", () => {
  test("Excel's quoting: tabs, line breaks and quotes in cells; a final line break", () => {
    assert.deepEqual(parseTsv('구분\t금액\r\n"인건비\r\n(계)"\t"1,000"\r\n"a ""b"""\t\r\n'), [
      ["구분", "금액"], ["인건비\r\n(계)", "1,000"], ['a "b"', ""],
    ]);
    assert.deepEqual(parseTsv("a\tb\nc"), [["a", "b"], ["c", ""]]);
    assert.equal(parseTsv("no tabs\nhere"), null);
  });

  test("a table from tab-separated text: first row as header, text escaped", () => {
    const t = tsvTable([["이름", "값"], ["a*b", "x|y"], ["two\nlines", "\\\\"]])!;
    assert.equal(t.header_rows, 1);
    assert.equal(writeAligned(t), "| 이름         | 값     |\n| ------------ | ------ |\n| a\\*b         | x\\|y   |\n| two \\\\ lines | &#92;\\ |");
    assert.deepEqual(analyzeTable(writeAligned(t).split("\n"))!.table.cells.map((c) => c.text), t.cells.map((c) => c.text));
  });

  test("a range as tab-separated text and as HTML", () => {
    const t = model("| a | b |\n|---|---|\n| x\\*y | two \\\\ lines |\n| q\"r | << |");
    assert.equal(rangeTsv(t, { top: 1, left: 0, bottom: 2, right: 1 }), 'x*y\t"two\nlines"\n"q""r"\t');
    assert.equal(rangeHtml(t, { top: 2, left: 0, bottom: 2, right: 1 }),
      '<table>\n<tbody>\n<tr>\n<td colspan="2">q&quot;r</td>\n</tr>\n</tbody>\n</table>');
  });
});

describe("ranges of cells in the source", () => {
  const DOC = "Text\n\n| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\nEnd\n";

  test("a selection over two or more cells is a range; one inside a cell is not", () => {
    assert.deepEqual(selectedCells(selecting(DOC.replace("| 1 |", "| «1 |").replace("| 5 |", "| 5» |")))!.range,
      { top: 1, left: 0, bottom: 2, right: 1 });
    // Whole lines: from the start of a row to the start of the line after the last.
    const lines = DOC.replace("| 1 | 2", "«| 1 | 2").replace("\n\nEnd", "\n»\nEnd");
    assert.deepEqual(selectedCells(selecting(lines))!.range, { top: 1, left: 0, bottom: 2, right: 2 });
    assert.equal(selectedCells(selecting(DOC.replace("| 2 |", "| «2» |"))), null);
    assert.equal(selectedCells(selecting(DOC.replace("Text", "«Text").replace("| 2 |", "| 2» |"))), null);
  });

  test("merge and empty the selected cells", () => {
    const s = selecting(DOC.replace("| 2 |", "| «2 |").replace("| 6 |", "| 6» |"));
    assert.equal(run(mergeSelectedCells, s),
      "Text\n\n| A   | B                | C   |\n| --- | ---------------- | --- |\n| 1   | 2 \\\\ 3 \\\\ 5 \\\\ 6 | <<  |\n| 4   | ^^               | <<  |\n\nEnd\n");
    assert.equal(run(clearSelectedCells, selecting(DOC.replace("| 2 |", "| «2 |").replace("| 6 |", "| 6» |"), false)),
      "Text\n\n| A | B | C |\n|---|---|---|\n| 1 |  |  |\n| 4 |  |  |\n\nEnd\n");
  });
});

describe("pasting into and as tables", () => {
  const DOC = "Text\n\n| A {c:2} |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nEnd\n";
  const paste = (s: EditorState, data: { html?: string; text?: string }): string | null => {
    const spec = pasteTables(s, data);
    return spec && s.update(spec).state.doc.toString();
  };

  test("tab-separated text outside a table becomes a table; one row does not", () => {
    assert.equal(paste(state("Before\n\nAfter\n", 7), { text: "구분\t금액\n인건비\t100\n" }),
      "Before\n\n| 구분   | 금액 |\n| ------ | ---- |\n| 인건비 | 100  |\n\nAfter\n");
    assert.equal(paste(state("Before\n", 7), { text: "a\tb" }), null);
  });

  test("cells pasted into a table fill it from the cursor's cell, the table written as it was", () => {
    const at = DOC.indexOf("| 1 |") + 2;
    assert.equal(paste(state(DOC, at, at, false), { text: "x\ty\nz\tw" }), "Text\n\n| A {c:2} |\n|---|---|\n| x | y |\n| z | w |\n\nEnd\n");
  });

  test("cells beyond the table make it grow; an HTML table fills cells too", () => {
    const at = DOC.indexOf("| 4 |") + 2;
    const grown = analyzeTable(paste(state(DOC, at), { text: "x\ty\tz\nu\tv\tw" })!.split("\n").slice(2, 7))!.table;
    assert.equal(grown.rows, 4);
    assert.equal(grown.cols, 4);
    assert.deepEqual(grown.cells.filter((c) => c.row >= 2).map((c) => c.text), ["3", "x", "y", "z", "", "u", "v", "w"]);
    const html = paste(state(DOC, DOC.indexOf("| 1 |") + 2, undefined, false), { html: "<table><tr><td>h1</td><td>h2</td></tr></table>" });
    assert.equal(html, "Text\n\n| A {c:2} |\n|---|---|\n| h1 | h2 |\n| 3 | 4 |\n\nEnd\n");
  });

  test("an HTML table pasted into a table keeps its merged cells, not across header and body", () => {
    const at = DOC.indexOf("| 1 |") + 2;
    const html = '<table><tr><td colspan="2">합계</td></tr><tr><td>a</td><td>b</td></tr></table>';
    assert.equal(paste(state(DOC, at), { html }),
      "Text\n\n| A    | <<  |\n| ---- | --- |\n| 합계 | <<  |\n| a    | b   |\n\nEnd\n");
    const tall = '<table><tr><td rowspan="2">세로</td><td>x</td></tr><tr><td>y</td></tr></table>';
    const top = DOC.indexOf("| A") + 2;
    // From the header row down into the body: the merged cell would cross the delimiter row.
    assert.equal(paste(state(DOC, top), { html: tall }),
      "Text\n\n| 세로 | x   |\n| ---- | --- |\n|      | y   |\n| 3    | 4   |\n\nEnd\n");
  });

  test("HTML with text around a table is left to the editor, also its plain text with tabs", () => {
    const html = "<p>앞 글 <b>굵게</b></p><table><tr><th>구분</th><th>2026년</th></tr></table><p>뒤 글</p>";
    const text = "앞 글 굵게\n구분\t2026년\n뒤 글";
    assert.equal(paste(state("Before\n\n", 8), { html, text }), null);
    assert.equal(paste(state("Before\n\n", 8), { html: "<p>no table</p>", text: "a\tb\nc\td" }), null);
    // An empty HTML wrapper is no HTML: the tab-separated text is cells.
    assert.match(paste(state("Before\n\n", 8), { html: "<html><body><!--StartFragment--><!--EndFragment--></body></html>", text: "a\tb\nc\td" })!, /\| a +\| b +\|/);
    // Inside a table, such a paste does not fill cells either.
    const at = DOC.indexOf("| 1 |") + 2;
    assert.equal(paste(state(DOC, at, at, false), { html, text: "x\ty" }), null);
  });

  test("images in pasted cells: through the application's function; embedded ones left out without it", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const html = `<table><tr><th>그림</th><th>설명</th></tr><tr><td><img src="${png}" alt="도표 1"></td><td><img alt='로고 &amp; 글' src="logo.png"></td></tr></table>`;
    const calls: string[] = [];
    const saved = pasteTables(state("", 0), { html }, { images: (src, alt) => { calls.push(`${src.slice(0, 15)}|${alt}`); return src.startsWith("data:") ? "img/도표 1.png" : null; } });
    const text = state("", 0).update(saved!).state.doc.toString();
    assert.deepEqual(calls, ["data:image/png;|도표 1", "logo.png|로고 & 글"]);
    assert.match(text, /\| !\[도표 1\]\(img\/도표%201\.png\) \|/); // a space in a link destination is written %20
    assert.match(text, /\| 로고 & 글 +\|/);
    const plain = state("", 0).update(pasteTables(state("", 0), { html })!).state.doc.toString();
    assert.ok(!plain.includes("data:"), plain);
    assert.match(plain, /도표 1/);
    assert.match(plain, /!\[로고 & 글\]\(logo\.png\)/);
    // Spaces and parentheses in link and image addresses are percent-encoded, so that they stay links.
    const spaced = state("", 0).update(pasteTables(state("", 0), { html: '<table><tr><th><a href="a b.html">링크</a></th><th><img src="c (1).png" alt="그림"></th></tr></table>' })!).state.doc.toString();
    assert.match(spaced, /\[링크\]\(a%20b\.html\)/);
    assert.match(spaced, /!\[그림\]\(c%20%281%29\.png\)/);
  });

  test("lines of text pasted into a cell become line breaks", () => {
    const at = DOC.indexOf("| 1 |") + 3;
    assert.equal(paste(state(DOC, at), { text: "first\nsecond" }), DOC.replace("| 1 |", "| 1first \\\\ second |"));
    assert.equal(paste(state(DOC, at), { text: "one line" }), null); // left to the editor
  });
});
