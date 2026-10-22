/** Run the conformance cases extracted from the specification. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { defaultInline, findTables, plainInline, renderHtml } from "../dist/index.js";
import { errorSet, loadExamples, normalize, normalizeTables } from "../../../test-support/conformance.ts";

const EXAMPLES = loadExamples();
const INLINE = defaultInline();

test("the cases file holds every spec example", () => {
  const spec = readFileSync(new URL("../../../../../spec/ltem-spec.md", import.meta.url), "utf8");
  const fences = spec.split("\n").filter((line) => line === "`".repeat(32) + " example").length;
  assert.ok(fences > 0);
  assert.equal(EXAMPLES.length, fences);
});

test("cell text is rendered by markdown-it when it is installed", () => {
  assert.notEqual(INLINE, plainInline);
  assert.equal(INLINE("**a** `b`"), "<strong>a</strong> <code>b</code>");
});

describe("parse", () => {
  for (const ex of EXAMPLES) {
    test(`example ${ex.example} (${ex.section})`, () => {
      assert.deepEqual(findTables(ex.ltem).map((r) => r.table), ex.tables);
    });
  }
});

describe("validate", () => {
  for (const ex of EXAMPLES) {
    test(`example ${ex.example} (${ex.section})`, () => {
      const problems = findTables(ex.ltem).flatMap((r) => r.problems);
      assert.deepEqual(errorSet(problems), errorSet(ex.errors));
    });
  }
});

describe("render tables", () => {
  for (const ex of EXAMPLES) {
    test(`example ${ex.example} (${ex.section})`, () => {
      const got = findTables(ex.ltem).map((r) => normalize(renderHtml(r.table, INLINE)));
      assert.deepEqual(got, normalizeTables(ex.html));
    });
  }
});

describe("plain inline rendering", () => {
  test("escapes HTML and applies backslash escapes only", () => {
    assert.equal(plainInline('a \\* <b> & "q" \\a \\\\'), 'a * &lt;b&gt; &amp; &quot;q&quot; \\a \\');
    assert.equal(plainInline("**bold** it's"), "**bold** it's");
  });

  test("renders a table without markdown-it", () => {
    const [result] = findTables("| A {c:2} |\n|---|---|\n| x < y | \\| |\n");
    assert.equal(renderHtml(result.table, plainInline), [
      "<table>", "<thead>", "<tr>", '<th colspan="2">A</th>', "</tr>", "</thead>",
      "<tbody>", "<tr>", "<td>x &lt; y</td>", "<td>|</td>", "</tr>", "</tbody>", "</table>",
    ].join("\n"));
  });

  test("a table without body rows has no tbody", () => {
    const [result] = findTables("| A |\n|:-:|\n");
    assert.equal(renderHtml(result.table, plainInline),
      '<table>\n<thead>\n<tr>\n<th align="center">A</th>\n</tr>\n</thead>\n</table>');
  });
});
