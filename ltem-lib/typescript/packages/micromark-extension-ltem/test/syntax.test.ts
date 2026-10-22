/** The micromark extension: syntax and HTML. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { findTables, renderHtml } from "ltem-core";
import { micromark, parse, postprocess, preprocess } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import type { Event, Token } from "micromark-util-types";

import { ltem, ltemHtml } from "../dist/index.js";
import { Random, loadExamples, normalize, normalizeTables } from "../../../test-support/conformance.ts";
import { randomDocument, randomFragment } from "../../../test-support/documents.ts";
import { BLOCK_CONSTRUCTS, paragraphContent } from "../../../test-support/unified.ts";

const EXAMPLES = loadExamples();

function html(src: string): string {
  return micromark(src, { extensions: [ltem()], htmlExtensions: [ltemHtml()] });
}

function withGfm(src: string): string {
  return micromark(src, { extensions: [gfm(), ltem()], htmlExtensions: [gfmHtml(), ltemHtml()] });
}

function gfmOnly(src: string): string {
  return micromark(src, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
}

/** micromark's HTML for one line of cell text, parsed as inlines only. */
function inline(line: string): string {
  return paragraphContent(micromark(line, { extensions: [{ disable: { null: BLOCK_CONSTRUCTS } }] }));
}

/** HTML of the tables, rendered by the core with micromark for cell text. */
function coreTables(src: string): ReturnType<typeof normalizeTables> {
  return findTables(src).map((r) => normalize(renderHtml(r.table, inline)));
}

/** micromark's events for a document, after inline parsing. */
function events(src: string): Event[] {
  return postprocess(parse({ extensions: [ltem()] }).document().write(preprocess()(src, undefined, true)));
}

/** Enter events of the given token types, as [type, source] pairs. */
function tokens(src: string, types: string[]): [string, string][] {
  return events(src).filter(([kind, token]) => kind === "enter" && types.includes(token.type))
    .map(([, token, context]) => [token.type, context.sliceSerialize(token)]);
}

/** The enter events of a token type. */
function entered(src: string, type: string): Token[] {
  return events(src).filter(([kind, token]) => kind === "enter" && token.type === type).map(([, token]) => token);
}

describe("spec examples as whole documents", () => {
  for (const ex of EXAMPLES) {
    test(`example ${ex.example} (${ex.section})`, () => {
      assert.deepEqual(normalize(html(ex.ltem)), normalize(ex.html));
    });
  }
});

describe("spec examples as whole documents, with micromark-extension-gfm", () => {
  for (const ex of EXAMPLES) {
    test(`example ${ex.example} (${ex.section})`, () => {
      assert.deepEqual(normalize(withGfm(ex.ltem)), normalize(ex.html));
    });
  }
});

describe("tables without LTEM notation render as with micromark's GFM table", () => {
  const samples: Record<string, string> = {
    "simple": "| a | b |\n|---|---|\n| 1 | 2 |\n",
    "alignment": "| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |\n",
    "no outer pipes": "a | b\n--|--\n1 | 2\n",
    "missing and extra cells": "| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n",
    "escaped pipes and inlines": "| `a\\|b` | **x** |\n|---|---|\n| [l](u) | \\| |\n",
    "header only": "| a |\n|---|\n",
    "empty cells": "|  |  |\n|--|--|\n| 1 |  |\n",
    "after a paragraph": "text\n| a |\n|---|\n| 1 |\n",
    "ends at a blank line": "| a |\n|---|\n| 1 |\n\npara | x\n",
    "ends at a heading": "| a |\n|---|\n| 1 |\n# h\n",
    "ends at a blockquote": "| a |\n|---|\n| 1 |\n> q\n",
    "ends at a fence": "| a |\n|---|\n| 1 |\n```\ncode\n```\n",
    "ends at a list": "| a |\n|---|\n| 1 |\n- item\n",
    "ends at a thematic break": "| a |\n|---|\n| 1 |\n***\n",
    "ends at an HTML block": "| a |\n|---|\n| 1 |\n<div>\nx\n</div>\n",
    "ends at indented code": "| a |\n|---|\n| 1 |\n    code\n",
    "continues with a paragraph line": "| a | b |\n|---|---|\n| 1 | 2 |\nmore\n",
    "in a blockquote": "> | a | b |\n> |---|---|\n> | 1 | 2 |\n",
    "in a list item": "- | a | b |\n  |---|---|\n  | 1 | 2 |\n- next\n",
    "lazy line after a table in a blockquote": "> | a |\n> |---|\n| b |\n",
    "not a table: wrong cell count": "| a | b |\n|---|\n| 1 |\n",
    "not a table: indented delimiter": "| a |\n    |---|\n",
    "not a table: a list item below": "Size | Price\n- | -\n",
    "indented as code": "    | a |\n    |---|\n",
    "two tables": "| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |\n",
    "with other GFM": "| ~~a~~ | www.example.com |\n|---|---|\n| [^1] | x |\n\n[^1]: note\n",
  };
  for (const [label, src] of Object.entries(samples)) {
    test(label, () => {
      assert.equal(withGfm(src), gfmOnly(src));
    });
  }
});

describe("tokens", () => {
  test("a table, its head and body, rows and cells, with the table model's fields", () => {
    const src = "| A {c:2} | B |\n| ^^ | << | C |\n|:-|--|-:|\n| x \\\\ *y* | z |\n";
    const tables = events(src).filter(([kind, t]) => kind === "enter" && t.type === "ltemTable");
    assert.equal(tables.length, 1);
    assert.deepEqual(tables[0][1]._ltemTable, { align: ["left", null, "right"], headerRows: 2 });
    assert.deepEqual(tokens(src, ["ltemTable", "ltemTableHead", "ltemTableBody", "ltemTableRow", "ltemTableCell",
      "ltemTableDelimiterRow", "ltemTableLineBreak"]), [
      ["ltemTable", src.slice(0, -1)],
      ["ltemTableHead", "| A {c:2} | B |\n| ^^ | << | C |\n|:-|--|-:|"],
      ["ltemTableRow", "| A {c:2} | B |"], ["ltemTableCell", "A {c:2}"], ["ltemTableCell", "B"],
      ["ltemTableRow", "| ^^ | << | C |"], ["ltemTableCell", "C"],
      ["ltemTableDelimiterRow", "|:-|--|-:|"],
      ["ltemTableBody", "| x \\\\ *y* | z |"],
      ["ltemTableRow", "| x \\\\ *y* | z |"], ["ltemTableCell", "x \\\\ *y*"], ["ltemTableLineBreak", "\\\\"],
      ["ltemTableCell", "z"],
    ]);
    const cells = entered(src, "ltemTableCell").map((t) => t._ltemCell);
    assert.deepEqual(cells, [
      { row: 0, col: 0, rowspan: 2, colspan: 2, header: true, align: "left" },
      { row: 0, col: 2, rowspan: 1, colspan: 1, header: true, align: "right" },
      { row: 1, col: 2, rowspan: 1, colspan: 1, header: true, align: "right" },
      { row: 2, col: 0, rowspan: 1, colspan: 1, header: false, align: "left" },
      { row: 2, col: 1, rowspan: 1, colspan: 1, header: false, align: null },
    ]);
    // The row is short: its last cell has no source and is listed on the row (rule V14).
    assert.deepEqual(entered(src, "ltemTableRow").map((t) => t._ltemPadding), [[], [],
      [{ row: 2, col: 2, rowspan: 1, colspan: 1, header: false, align: "right" }]]);
  });

  test("cell positions are the cell's source without the spaces around it", () => {
    const src = "intro\n\n> | R {c:2} |\n> | a   | \\| b |\n> |---|---|\n> | x |  |\n";
    const cells = entered(src, "ltemTableCell").map((t) => [t.start.line, t.start.column, t.end.line, t.end.column]);
    // An empty cell is empty: it sits at the end of its space between the pipes.
    assert.deepEqual(cells, [[3, 5, 3, 12], [4, 5, 4, 6], [4, 11, 4, 15], [6, 5, 6, 6], [6, 10, 6, 10]]);
    assert.deepEqual(entered(src, "ltemTableRow").map((t) => [t.start.column, t.end.column]), [[3, 14], [3, 17], [3, 11]]);
  });

  test("inline text of each line of a cell is parsed on its own", () => {
    const src = "| **a \\\\ b** | `c \\\\ d` | e \\\\ |\n|---|---|---|\n";
    assert.deepEqual(tokens(src, ["strong", "codeText", "data"]).map(([type]) => type).filter((t) => t !== "data"), []);
    assert.equal(html(src).split("<br />").length - 1, 3);
  });

  test("the GFM table construct is turned off", () => {
    const types = events("| a | b |\n|---|---|\n").map(([, t]) => t.type);
    assert.ok(!types.includes("table" as Token["type"]) && types.includes("ltemTable"));
    const gfmTypes = postprocess(parse({ extensions: [gfm(), ltem()] }).document()
      .write(preprocess()("| a |\n|---|\n", undefined, true))).map(([, t]) => t.type);
    assert.ok(!gfmTypes.includes("table" as Token["type"]) && gfmTypes.includes("ltemTable"));
  });

  test("a table can be turned off by name", () => {
    const out = micromark("| a |\n|---|\n", { extensions: [ltem(), { disable: { null: ["ltemTable"] } }], htmlExtensions: [ltemHtml()] });
    assert.equal(out, "<p>| a |\n|---|</p>\n");
  });
});

describe("behaviour", () => {
  test("HTML in the format of micromark's GFM tables", () => {
    assert.equal(html("| A {c:2} |\n| b | c |\n|:-:|---|\n| 1 \\\\ 2 | 3 |\n"),
      "<table>\n<thead>\n<tr>\n<th colspan=\"2\" align=\"center\">A</th>\n</tr>\n<tr>\n<th align=\"center\">b</th>\n"
      + "<th>c</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td align=\"center\">1<br />2</td>\n<td>3</td>\n</tr>\n</tbody>\n</table>\n");
  });

  test("pipe-led lines above the last header row are header rows (spec 2.3)", () => {
    assert.deepEqual(normalize(html("| a | << |\n| b | c |\n|---|---|\n")), normalize(
      '<table><thead><tr><th colspan="2">a</th></tr><tr><th>b</th><th>c</th></tr></thead></table>'));
  });

  test("a table may begin on any line of a paragraph (spec 2.3)", () => {
    assert.ok(html("a\nb\n| x |\n|---|\n").startsWith("<p>a\nb</p>\n<table>"));
    assert.ok(html("| x |\n| # orders |\n| ID |\n|---|\n| 1 |\n").startsWith("<p>| x |\n| # orders |</p>\n<table>"));
    // A pipe-led line above belongs to the header rows, so no table begins below it.
    assert.equal(html("| A {r:2} | B |\n| X | Y | |\n|---|---|\n"), "<p>| A {r:2} | B |\n| X | Y | |\n|---|---|</p>\n");
    assert.ok(html("Note\n| a | b |\n|---|\n|---|\n").startsWith("<p>Note\n| a | b |</p>\n<table>"));
  });

  test("a last header row that begins an HTML block is still a header row (spec 2.3)", () => {
    assert.ok(html("<div> | x\n|---|---|\n").includes("<th>&lt;div&gt;</th>"));
    assert.ok(html("text\n<div> | x\n|---|---|\n").startsWith("<p>text</p>\n<table>"));
  });

  test("the body ends at HTML blocks, as at the host's other blocks (spec 2.4)", () => {
    const out = html("| a |\n|---|\n| 1 |\n<div>\n| 2 |\n");
    assert.equal(out.split("<tr>").length - 1, 2);
    assert.ok(out.includes("</table>\n&lt;div&gt;"));
    assert.equal(html("| a |\n|---|\n| <b>1</b> |\n").split("<tr>").length - 1, 2);
  });

  test("a line that begins a block ends the body (spec 2.4)", () => {
    assert.ok(html("| a |\n|---|\n| 1 |\n2. x\n").includes("</table>\n<ol start=\"2\">"));
    assert.ok(html("| a |\n|---|\n| 1 |\n-\n").includes("</table>\n<ul>"));
    assert.ok(html("| a |\n|---|\n| 1 |\n```a`b\n").endsWith("</table>\n<p>```a`b</p>\n"));
    assert.equal(html("| a |\n|---|\n| 1 |\n===\n").split("<tr>").length - 1, 3);
  });

  test("a lazy line does not continue a table in a container", () => {
    assert.ok(html("> | a |\n> |---|\n| b |\n").endsWith("</blockquote>\n<p>| b |</p>\n"));
    assert.ok(html("> | a |\n|---|\n").startsWith("<blockquote>\n<p>| a |\n|---|</p>"));
  });

  test("inline Markdown, escapes and code in cells", () => {
    const src = "| **b** {c:2} | << | `x \\| y` |\n|---|---|---|\n| [l](u) | \\<< | \\{c:2} |\n| a \\\\| b | `c \\\\| d` | *e\\\\|f* |\n";
    const out = html(src);
    assert.ok(out.includes('<th colspan="2"><strong>b</strong></th>'));
    assert.ok(out.includes("<th><code>x | y</code></th>"));
    assert.ok(out.includes('<td><a href="u">l</a></td>\n<td>&lt;&lt;</td>\n<td>{c:2}</td>'));
    // \\| is a backslash and an escaped pipe: the cell text holds \|, an escaped pipe (spec 2.1).
    assert.ok(out.includes("<td>a | b</td>\n<td><code>c \\| d</code></td>\n<td><em>e|f</em></td>"));
    assert.deepEqual(normalizeTables(out), coreTables(src));
  });

  test("escaped pipes in links, images and raw HTML of cells", () => {
    assert.ok(html("| [a\\|b](x\\|y \"t\\|u\") |\n|---|\n").includes('<a href="x%7Cy" title="t|u">a|b</a>'));
    assert.ok(html("| ![a\\|b](i.png) |\n|---|\n").includes('<img src="i.png" alt="a|b" />'));
  });

  test("tables in containers", () => {
    const src = "> | A {c:2} |\n> |---|---|\n> | 1 | 2 |\n\n- | A | << |\n  |---|---|\n  | 1 | 2 |\n\n"
      + "1. x\n   | p |\n   | A {c:2} |\n   |---|---|\n\n> > | A {c:2} |\n> > |:-|-:|\n\n>\t| A {c:2} |\n>\t|---|---|\n";
    const out = html(src);
    assert.equal(out.split('<th colspan="2">A</th>').length - 1, 4);
    assert.ok(out.includes('<th colspan="2" align="left">A</th>'));
  });

  test("CRLF and CR line endings", () => {
    for (const eol of ["\r\n", "\r"]) {
      const src = ["text", "| a {c:2} |", "|---|---|", "| 1 \\\\ 2 | 3 |", ""].join(eol);
      assert.deepEqual(normalizeTables(html(src)), coreTables(src), JSON.stringify(eol));
      assert.ok(html(src).startsWith("<p>text</p>"));
    }
  });

  test("several tables in one document", () => {
    const src = "| a {c:2} |\n|---|---|\n\ntext\n\n| b |\n|---|\n| 1 |\n\n| c |\n| d |\n|---|\n";
    assert.equal(html(src).split("<table>").length - 1, 3);
    assert.deepEqual(normalizeTables(html(src)), coreTables(src));
  });

  for (const src of [
    "a | b\n|---|\n| c |\n|:-:|\n",
    "| a |\n    |---|\n| 1 |\n",
    "| # id |\n| a | << |\n|---|---|\n| 1 | 2 |\n",
    "text\n| a | b {c:2} |\n| c |\n|---|---|---|\n| 1 | 2 | 3 |\n",
    "| a | b |\n|---|\n|---|\n| 1 |\n",
    "a | b\n- | -\n",
    "````\n```\n| a |\n|---|\n````\n| b |\n|---|\n",
    "x\n| p {r:2} | q |\n| r |\n|---|---|\n| 1 | 2 |\n",
    "| A |\n|---|\n| 1 |\n　\n| 2 |\n",
    "| a\t{c:2} | x\\\\\\| |\n|---|---|---|\n",
  ]) {
    test(`finds the same tables as the core: ${JSON.stringify(src)}`, () => {
      assert.deepEqual(normalizeTables(html(src)), coreTables(src));
    });
  }

  test("incomplete input never throws, character by character", () => {
    const docs = [...EXAMPLES.map((ex) => ex.ltem), randomDocument(new Random(7)).markdown,
      "> | a {c:2} | \\\n> |--", "- | a | b\n  |:-", "| a \\\\ `b"];
    for (const doc of docs) {
      for (let i = 0; i <= doc.length; i++) {
        const prefix = doc.slice(0, i);
        assert.doesNotThrow(() => html(prefix), prefix);
      }
    }
  });

  test("random fragments never throw", () => {
    const rng = new Random(20261023);
    for (let i = 0; i < 5000; i++) {
      const fragment = randomFragment(rng);
      assert.doesNotThrow(() => withGfm(fragment), JSON.stringify(fragment));
    }
  });

  test("long pipe-led paragraphs and long tables stay fast", () => {
    const started = Date.now();
    const paragraph = Array.from({ length: 20000 }, (_, i) => `| line ${i} |`).join("\n");
    assert.ok(!html(paragraph).includes("<table>"));
    const table = ["| a | b | c |", "|---|---|---|", ...Array.from({ length: 20000 }, () => "| x |")].join("\n");
    assert.equal(html(table).split("<tr>").length - 1, 20001);
    assert.ok(Date.now() - started < 20000, `took ${Date.now() - started} ms`);
  });
});

test("tables agree with the core on random documents", () => {
  const rng = new Random(20261019);
  for (let i = 0; i < 3000; i++) {
    const doc = randomDocument(rng);
    assert.deepEqual(normalizeTables(html(doc.markdown)), coreTables(doc.unwrapped), doc.markdown);
  }
});

test("micromark's development build accepts the events", () => {
  const script = fileURLToPath(new URL("development.ts", import.meta.url));
  const out = execFileSync(process.execPath, ["--conditions=development", script], { encoding: "utf8" });
  assert.match(out, /^checked \d+ documents\n$/);
});
