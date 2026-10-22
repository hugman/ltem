/** HTML to LTEM conversion (a port of the Python tests, plus tokenizer and character tests). */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkTable, defaultInline, fromHtml, htmlToLtem, parseTable, renderHtml, write, type FromHtmlOptions, type HtmlTable, type Table,
} from "../dist/index.js";
import { unescape } from "../dist/fromhtml/charref.js";
import { escapeText } from "../dist/fromhtml/inline.js";
import { tokenize } from "../dist/fromhtml/tokenizer.js";
import { isAlnum, isAlpha, isSpace, repr } from "../dist/pychar.js";
import { Random } from "../../../test-support/conformance.ts";
import { randomTable } from "../../../test-support/tables.ts";

const INLINE = defaultInline();
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

function one(html: string, options: FromHtmlOptions = {}): HtmlTable {
  const tables = fromHtml(html, options);
  assert.equal(tables.length, 1);
  return tables[0];
}

/** The model; alignment of a column without origin cells cannot survive HTML, so drop it. */
function comparable(table: Table): Table {
  const originCols = new Set(table.cells.map((c) => c.col));
  return { ...table, align: table.align.map((a, i) => (originCols.has(i) ? a : null)) };
}

const texts = (t: HtmlTable): string[] => t.table.cells.map((c) => c.text);
const CUT_AT_HEADER = "a rowspan in row 0 was cut at the end of the header rows; header cells do not reach into the body";
const ROW_HEADER_NOTE = "header cells (<th>) outside the header rows became ordinary cells; LTEM 1.0 has no row headers";

test("random tables survive an HTML round trip", () => {
  const rng = new Random(7);
  for (let i = 0; i < 2000; i++) {
    const rows = rng.randint(1, 7);
    const table = randomTable(rng, rows, rng.randint(1, 6), rng.randint(1, rows));
    const html = renderHtml(table, INLINE);
    assert.deepEqual(comparable(one(html).table), comparable(table), html);
  }
});

test("spans and thead", () => {
  const t = one(`<table><thead>
      <tr><th rowspan="2">Region</th><th colspan="2">Revenue</th></tr>
      <tr><th>Q1</th><th>Q2</th></tr></thead>
      <tbody><tr><td>Asia</td><td>100</td><td>120</td></tr></tbody></table>`);
  assert.deepEqual(t.warnings, []);
  assert.equal(write(t.table), "| Region | Revenue | << |\n| ^^ | Q1 | Q2 |\n| --- | --- | --- |\n| Asia | 100 | 120 |");
});

test("header from leading th rows, and a rowspan clipped at the header", () => {
  const t = one("<table><tr><th rowspan=3>A</th><th>B</th></tr><tr><td>1</td></tr><tr><td>2</td></tr></table>");
  assert.equal(t.table.header_rows, 1);
  assert.equal(t.table.cells[0].rowspan, 1); // a header cell may not reach into the body
  // The body cells stay where the HTML puts them, beside the cut header cell.
  assert.equal(write(t.table), "| A | B |\n| --- | --- |\n|  | 1 |\n|  | 2 |");
  assert.deepEqual(t.warnings, [CUT_AT_HEADER]);
});

test("without a header row the first row is used, with a warning", () => {
  const t = one("<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>");
  assert.equal(t.table.header_rows, 1);
  assert.deepEqual(t.warnings, ["the HTML table has no header row; its first row is used as the header"]);
});

test("forced header rows", () => {
  assert.equal(one("<table><tr><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></table>",
    { headerRows: 2 }).table.header_rows, 2);
});

test("rowspan 0 and ragged rows", () => {
  const t = one("<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>"
    + "<tbody><tr><td rowspan=0>x</td><td>1</td></tr><tr><td>2</td><td>3</td></tr></tbody></table>");
  assert.equal(write(t.table), "| A | B | C |\n| --- | --- | --- |\n| x | 1 |  |\n| ^^ | 2 | 3 |");
});

test("an overlap is cut, with a warning", () => {
  const t = one("<table><tr><th>A</th><th>B</th></tr>"
    + "<tr><td>x</td><td rowspan=2>y</td></tr><tr><td colspan=2>z</td></tr></table>");
  assert.deepEqual(checkTable(t.table), []);
  assert.deepEqual(t.warnings, ["a colspan in row 2 was cut to avoid overlapping a rowspan"]);
});

test("inline content", () => {
  const t = one(`<table><tr><th>H</th></tr><tr><td>
      <p>First <strong>bold</strong> and <em>it</em></p>
      <p>Use <code>x|y</code>, see <a href="https://e.org">site</a> <img src="a.png" alt="pic"></p>
      <ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>H<sub>2</sub>O
    </td></tr></table>`);
  assert.equal(t.table.cells[1].text, "First **bold** and *it*\n"
    + "Use `x|y`, see [site](https://e.org) ![pic](a.png)\n- one\n- two\n1. first\nH<sub>2</sub>O");
  assert.ok(write(t.table).includes("`x\\|y`")); // pipes are escaped for the table, even in code
});

test("text is escaped for Markdown", () => {
  const t = one(String.raw`<table><tr><th>a*b* _c_ snake_case [x] &lt;b&gt; &amp;amp; C:\dir \* $5</th></tr></table>`);
  assert.equal(t.table.cells[0].text, String.raw`a\*b\* \_c\_ snake_case \[x\] \<b> \&amp; C:\dir &#92;\* $5`);
  assert.ok(renderHtml(t.table, INLINE).includes("a*b* _c_ snake_case [x] &lt;b&gt; &amp;amp; C:\\dir \\* $5"));
});

test("a nested table is flattened, with a warning", () => {
  const t = one("<table><tr><th>outer</th></tr><tr><td><table><tr><td>a</td><td>b</td></tr>"
    + "<tr><td>c</td><td>d</td></tr></table></td></tr></table>");
  assert.equal(t.table.cells[1].text, "a; b\nc; d");
  assert.deepEqual(t.warnings, ["a table inside a cell was flattened to text (not supported in LTEM 1.0)"]);
});

test("several tables, and tfoot comes last", () => {
  const tables = fromHtml("<table><tfoot><tr><td>total</td></tr></tfoot><thead><tr><th>h</th></tr></thead>"
    + "<tbody><tr><td>row</td></tr></tbody></table><p>x</p><table><tr><th>2</th></tr></table>");
  assert.equal(tables.length, 2);
  assert.deepEqual(texts(tables[0]), ["h", "row", "total"]);
});

test("htmlToLtem", () => {
  const html = "<table><tr><th>A</th><th>B</th></tr><tr><td colspan=2>both</td></tr></table>";
  assert.equal(htmlToLtem(html), "| A | B |\n| --- | --- |\n| both | << |");
  assert.equal(htmlToLtem(html + html), "| A | B |\n| --- | --- |\n| both | << |\n\n| A | B |\n| --- | --- |\n| both | << |");
});

for (const html of ["", "<p>no table</p>", "<table></table>"]) {
  test(`no tables in ${JSON.stringify(html)}`, () => {
    assert.deepEqual(fromHtml(html), []);
  });
}

describe("fixed bugs of the Python implementation (2026-10-07)", () => {
  test("list items are numbered by position", () => {
    let t = one("<table><tr><th>h</th></tr><tr><td><ol><li>a</li><li>a</li><li>b</li></ol></td></tr></table>");
    assert.equal(t.table.cells[1].text, "1. a\n2. a\n3. b");
    t = one("<table><tr><th>h</th></tr><tr><td><ol><li><b>x</b></li><li><b>x</b></li></ol></td></tr></table>");
    assert.equal(t.table.cells[1].text, "1. **x**\n2. **x**");
  });

  test("only the first thead is a header group", () => {
    const t = one("<table><thead></thead><tbody><tr><td rowspan=2>x</td><td>1</td></tr><tr><td>2</td></tr></tbody>"
      + "<thead><tr><th>h</th><th>i</th></tr></thead></table>");
    assert.deepEqual(checkTable(t.table), []);
    assert.equal(t.table.header_rows, 1);
    assert.ok(t.warnings.some((w) => w.includes("no header row")));
    assert.deepEqual(texts(t).slice(-2), ["h", "i"]);
  });

  test("row groups keep document order", () => {
    const t = one("<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody>"
      + "<tr><td>b</td></tr><tbody><tr><td>c</td></tr></tbody></table>");
    assert.deepEqual(texts(t), ["h", "a", "b", "c"]);
  });

  test("text split at a lone angle bracket keeps its backslash", () => {
    const t = one(String.raw`<table><tr><th>C:\< x</th></tr></table>`);
    assert.ok(renderHtml(t.table, INLINE).includes("C:\\&lt; x"));
  });

  for (const [value, colspan, rowspan] of [["-1", 1, 1], ["1_0", 1, 1], ["\uff12", 1, 1], [" 2 ", 2, 2],
    ["2abc", 2, 2], ["+2", 2, 2], ["0", 1, 3], ["", 1, 1]] as [string, number, number][]) {
    test(`span value ${JSON.stringify(value)} follows HTML integer rules`, () => {
      const t = one(`<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead>`
        + `<tbody><tr><td colspan="${value}" rowspan="${value}">x</td></tr><tr><td>y</td></tr>`
        + `<tr><td>z</td></tr></tbody></table>`);
      const x = t.table.cells.find((c) => c.text === "x")!;
      assert.deepEqual([x.colspan, x.rowspan], [colspan, rowspan]);
    });
  }

  test("text-align matches ASCII only", () => {
    const t = one('<table><tr><th style="text-align: r\u0130ght">h</th><th style="TEXT-ALIGN: CENTER">i</th></tr></table>');
    assert.deepEqual(t.table.align, [null, "center"]);
  });
});

describe("headerRows 0, row headers and plain text (2026-10-07)", () => {
  test("headerRows 0 gives a header row of empty cells (spec Section 11)", () => {
    const t = one("<table><tr><td>a</td><td rowspan=2>b</td></tr><tr><td>c</td></tr></table>", { headerRows: 0 });
    assert.deepEqual(t.warnings, []);
    assert.equal(write(t.table), "|  |  |\n| --- | --- |\n| a | b |\n| c | ^^ |");
  });

  test("header cells in body rows are reported once", () => {
    const t = one("<table><tr><th>h</th><th>i</th></tr><tr><th>r1</th><td>1</td></tr><tr><th>r2</th><td>2</td></tr></table>");
    assert.equal(t.table.header_rows, 1);
    assert.deepEqual(t.warnings, ["2 header cells (<th>) outside the header rows became ordinary cells; "
      + "LTEM 1.0 has no row headers"]);
  });

  test("plain inline keeps text only", () => {
    const html = '<table><tr><th>a</th></tr><tr><td><b>*x*</b> <a href="u">l</a> <code>c`d</code> '
      + '<img src="p.png" alt="[p]"> H<sub>2</sub>O</td></tr></table>';
    assert.equal(one(html, { inline: "plain" }).table.cells[1].text, "\\*x\\* l c\\`d \\[p\\] H2O");
    assert.ok(one(html).table.cells[1].text.startsWith("**\\*x\\***"));
  });

  test("an ideographic space is content, not HTML whitespace", () => {
    const t = one("<table><tr><th>\u3000\uad6c\ubd84</th></tr><tr><td>\u3000\u3000\uc18c\uacc4  \ud569</td></tr></table>");
    assert.deepEqual(texts(t), ["\u3000\uad6c\ubd84", "\u3000\u3000\uc18c\uacc4 \ud569"]);
    assert.equal(one("<table><tr><th>h</th></tr><tr><td><b>\u3000x</b></td></tr></table>").table.cells[1].text,
      "\u3000**x**");
  });

  test("only ASCII whitespace collapses; other space separators are kept", () => {
    const t = one("<table><tr><th>\u00a0a\u2003\u2003b \t\n c\u00a0</th></tr><tr><td><ol><li>\u3000x </li></ol>"
      + "<a href='u'> \u3000l </a><sup>\u20022</sup></td></tr></table>");
    assert.deepEqual(texts(t), ["\u00a0a\u2003\u2003b c\u00a0", "1. \u3000x\n[\u3000l](u)<sup>\u20022</sup>"]);
  });

  test("options are checked", () => {
    assert.throws(() => fromHtml("<table></table>", { inline: "rich" as "plain" }), RangeError);
    assert.throws(() => fromHtml("<table></table>", { headerRows: 1.5 }), TypeError);
  });
});

describe("tokenizer", () => {
  function log(html: string): string[] {
    const out: string[] = [];
    tokenize(html, {
      startTag: (tag, attrs) => out.push(`<${tag} ${JSON.stringify(attrs)}>`),
      startEndTag: (tag, attrs) => out.push(`<${tag} ${JSON.stringify(attrs)}/>`),
      endTag: (tag) => out.push(`</${tag}>`),
      data: (text) => out.push(JSON.stringify(text)),
    });
    return out;
  }

  test("tokens as Python's html.parser reports them", () => {
    assert.deepEqual(log("<TD Colspan=2 x>a &amp; b</td >"), ['<td [["colspan","2"],["x",null]]>', '"a & b"', "</td>"]);
    assert.deepEqual(log("a < b<br/>"), ['"a "', '"<"', '" b"', "<br []/>"]);
    assert.deepEqual(log("<script>a<b>&amp;</script>x"), ["<script []>", '"a<b>&amp;"', "</script>", '"x"']);
    assert.deepEqual(log("x<!-- c -->y<!DOCTYPE html><?pi?>z"), ['"x"', '"y"', '"z"']);
    assert.deepEqual(log("a<td x='1"), ['"a"']);
    assert.deepEqual(log("a</"), ['"a"', '"</"']);
    assert.deepEqual(log("<a b= 'x>"), ['<a [["b",""],["\'x",null]]>']);
    assert.deepEqual(log("<title>&lt;t&gt;</title><textarea><td>&amp;</textarea>"),
      ["<title []>", '"<t>"', "</title>", "<textarea []>", '"<td>&"', "</textarea>"]);
  });

  test("character references as html.unescape decodes them", () => {
    assert.equal(unescape("&amp; &lt;&gt &quot;"), '& <> "');
    assert.equal(unescape("&ampxyz &notit; &foo; &#65;&#x42 &#X43;"), "&xyz \u00acit; &foo; AB C");
    assert.equal(unescape("&#0; &#128; &#1; &#xD800; &#99999999999; &#12a"), "\ufffd \u20ac  \ufffd \ufffd \u000ca");
    assert.equal(unescape("&# &#x &; & x"), "&# &#x &; & x");
    assert.equal(unescape("&NotNestedGreaterGreater; &nbsp"), "\u2aa2\u0338 \u00a0");
    assert.equal(unescape("&#x1F600; &#128512;"), "\u{1f600} \u{1f600}");
  });
});

describe("Python string semantics", () => {
  test("character classes", () => {
    const cp = (s: string): number => s.codePointAt(0)!;
    assert.ok(isAlpha(cp("\uac00")) && isAlnum(cp("\uac00")) && !isAlpha(cp("1")) && isAlnum(cp("\u0661")));
    assert.ok(!isAlnum(cp("\u0e34")) && !isAlpha(cp("\u24b6")));
    assert.ok(isAlpha(cp("\u{1d400}")) && isAlnum(cp("\u{1d7d8}")) && !isAlpha(cp("\u{1d7d8}")));
    assert.ok(isSpace(cp("\u3000")) && isSpace(cp("\x1f")) && !isSpace(cp("\u200b")));
  });

  test("repr", () => {
    assert.equal(repr("ab"), "'ab'");
    assert.equal(repr("it's"), "\"it's\"");
    assert.equal(repr("'\""), "'\\'\"'");
    assert.equal(repr("a\tb\\"), "'a\\tb\\\\'");
    assert.equal(repr("\u3000x\x7f\uac00"), "'\\u3000x\\x7f\uac00'");
    assert.equal(repr("\u{1f600}\u{e0001}"), "'\u{1f600}\\U000e0001'");
  });

  test("escaping text for Markdown", () => {
    assert.equal(escapeText(String.raw`a*b* _c_ snake_case [x] <b> &amp; C:\dir \* $5`),
      String.raw`a\*b\* \_c\_ snake_case \[x\] \<b> \&amp; C:\dir &#92;\* $5`);
    assert.equal(escapeText("&#12; &#x1F; &#xg; &a1;"), "\\&#12; \\&#x1F; &#xg; \\&a1;");
    assert.equal(escapeText("\u{1d400}_\u{1d401} x_\u{1f600} \\\u{1d7d8}"), "\u{1d400}_\u{1d401} x\\_\u{1f600} \\\u{1d7d8}");
  });
});

describe("command line: from-html", () => {
  function run(args: string[], input: string): { code: number | null; stdout: string; stderr: string } {
    const proc = spawnSync(process.execPath, [CLI, "from-html", ...args], { input, encoding: "utf8" });
    return { code: proc.status, stdout: proc.stdout, stderr: proc.stderr };
  }

  test("converts tables and reports warnings on standard error", () => {
    const out = run([], "<table><tr><td>a</td></tr></table><table><tr><th>b</th><th>c</th></tr><tr><th>r</th><td>1</td></tr></table>");
    assert.equal(out.code, 0);
    assert.equal(out.stdout, "| a |\n| --- |\n\n| b | c |\n| --- | --- |\n| r | 1 |\n");
    assert.equal(out.stderr, "table 1: the HTML table has no header row; its first row is used as the header\n"
      + "table 2: 1 header cells (<th>) outside the header rows became ordinary cells; LTEM 1.0 has no row headers\n");
  });

  test("--header-rows and --plain", () => {
    const html = "<table><tr><td><b>a</b></td></tr><tr><td>b</td></tr></table>";
    assert.equal(run(["--header-rows", "0"], html).stdout, "|  |\n| --- |\n| **a** |\n| b |\n");
    assert.equal(run(["--header-rows=2", "--plain"], html).stdout, "| a |\n| b |\n| --- |\n");
    assert.equal(run(["--header-rows", "x"], html).code, 2);
    assert.equal(run(["--plain", "-"], "<p>none</p>").stdout, "\n");
  });
});

describe("html-profile-v0 (2026-10-12)", () => {
  test("a title row counts as a header row", () => {
    const t = one('<table><tr><th colspan="3">(단위: 백만원)</th></tr><tr><th>구분</th><th>2024</th><th>2025</th></tr>'
      + "<tr><th>인건비</th><td>100</td><td>120</td></tr></table>", { headerRows: 2, inline: "plain" });
    assert.equal(write(t.table), "| (단위: 백만원) | << | << |\n| 구분 | 2024 | 2025 |\n| --- | --- | --- |\n"
      + "| 인건비 | 100 | 120 |");
    assert.deepEqual(t.warnings, ["1 " + ROW_HEADER_NOTE]);
  });

  test("a form table without a header", () => {
    const t = one("<table><tr><th>성명</th><td>홍길동</td><th>생년월일</th><td>1990.1.1</td></tr>"
      + "<tr><th>소속</th><td>기획과</td><th>직급</th><td>주무관</td></tr></table>", { headerRows: 0, inline: "plain" });
    assert.equal(write(t.table), "|  |  |  |  |\n| --- | --- | --- | --- |\n| 성명 | 홍길동 | 생년월일 | 1990.1.1 |\n"
      + "| 소속 | 기획과 | 직급 | 주무관 |");
    assert.deepEqual(t.warnings, ["4 " + ROW_HEADER_NOTE]);
  });

  test("rows covered by rowspans are empty tr elements", () => {
    const t = one('<table><tr><th rowspan="2">구분</th><th rowspan="2">값</th></tr><tr></tr>'
      + '<tr><td rowspan="2" colspan="2">합계</td></tr><tr></tr></table>', { headerRows: 2 });
    assert.deepEqual(t.warnings, []);
    assert.equal(write(t.table), "| 구분 | 값 |\n| ^^ | ^^ |\n| --- | --- |\n| 합계 | << |\n| ^^ | << |");
  });

  test("header rows inside thead keep cell positions", () => {
    // headerRows smaller than <thead>: a <thead> cell spanning past it is cut, and nothing moves.
    const t = one("<table><thead><tr><th rowspan=2>a</th><th>b</th></tr><tr><th>c</th></tr></thead></table>",
      { headerRows: 1 });
    assert.equal(write(t.table), "| a | b |\n| --- | --- |\n|  | c |");
    assert.deepEqual(t.warnings, [CUT_AT_HEADER, "1 " + ROW_HEADER_NOTE]);
  });
});

describe("two backslashes in a row (2026-10-14)", () => {
  // LTEM reads \\ as a line break (spec 4.2), so a converter must write it another way.
  const CASES: [string, string][] = [
    [String.raw`<table><tr><th><code>a\\b</code></th></tr></table>`, String.raw`a&#92;\b`], // code span becomes text
    [String.raw`<table><tr><th><code>x\</code>\y</th></tr></table>`, "`x\\`\\y"],
    [String.raw`<table><tr><th><span>x\</span>\y</th></tr></table>`, String.raw`x&#92;\y`], // across a text boundary
    [String.raw`<table><tr><th><a href="u\\v">l</a></th></tr></table>`, "[l](u&#92;&#92;v)"],
    [String.raw`<table><tr><th><img src="p\\q" alt="i"></th></tr></table>`, "![i](p&#92;&#92;q)"],
    [String.raw`<table><tr><th>a\</th></tr></table>`, "a\\"], // a backslash that ends a line stays as it is
    [String.raw`<table><tr><th><b>a\</b></th></tr></table>`, "**a&#92;**"],
  ];

  test("cell text never holds two backslashes in a row", () => {
    for (const [html, text] of CASES) {
      const t = one(html);
      assert.equal(t.table.cells[0].text, text, html);
      assert.equal(parseTable(write(t.table)).table!.cells[0].text, text, html);
    }
    assert.deepEqual(one(String.raw`<table><tr><th><code>a\\b</code></th></tr></table>`).warnings, [
      String.raw`a code span with two backslashes in a row became plain text; LTEM 1.0 cell text cannot hold \\`]);
    const plain = one(String.raw`<table><tr><th><code>x\</code>\y</th></tr></table>`, { inline: "plain" });
    assert.equal(plain.table.cells[0].text, String.raw`x&#92;\y`);
  });

  test("a model with two backslashes in a row is invalid", () => {
    const table: Table = {
      version: "1.0", rows: 1, cols: 1, header_rows: 1, align: [null],
      cells: [{ row: 0, col: 0, rowspan: 1, colspan: 1, text: String.raw`a\\b` }],
    };
    assert.deepEqual(checkTable(table), ["cell (0,0) text has two backslashes in a row, which LTEM 1.0 reads as a line break"]);
    assert.throws(() => write(table));
  });
});

