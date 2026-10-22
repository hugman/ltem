/** Where cells are in the source: ParseResult.sources and writeWithSources (a port of the Python tests). */

import assert from "node:assert/strict";
import { test } from "node:test";

import { findTables, parseTable, write, writeWithSources, type CellSource } from "../dist/index.js";
import { cellLines, splitAttribute } from "../dist/syntax.js";
import { Random } from "../../../test-support/conformance.ts";
import { randomTable, unescapeWriter } from "../../../test-support/tables.ts";

/** The model text of the cell whose source is line.slice(start, end). */
function textAt(line: string, source: CellSource): string {
  const piece = line.slice(source.start, source.end).replaceAll("\\|", "|");
  return cellLines(splitAttribute(piece)[0]);
}

test("sources of compact rows, attributes, escapes and padding", () => {
  const src = "intro\n| R {c:2} |\n| a   | \\| b |\n|---|---|\n| x | y |\n| z |";
  const r = parseTable(src);
  const lines = src.split("\n");
  assert.deepEqual(r.sources.map((s) => [s.row, s.col, s.rowspan, s.colspan, s.line, lines[s.line].slice(s.start, s.end)]), [
    [0, 0, 1, 2, 1, "R {c:2}"], [1, 0, 1, 1, 2, "a"], [1, 1, 1, 1, 2, "\\| b"],
    [2, 0, 1, 1, 4, "x"], [2, 1, 1, 1, 4, "y"], [3, 0, 1, 1, 5, "z"], [3, 1, 1, 1, 5, ""],
  ]);
  const padded = r.sources[r.sources.length - 1];
  assert.equal(padded.start, lines[5].length);
  assert.equal(padded.end, lines[5].length);
});

test("an empty cell sits at the end of its space between the pipes", () => {
  const [s0, s1] = parseTable("| a |   |\n|---|---|").sources;
  assert.deepEqual([s0.start, s0.end, s1.start, s1.end], [2, 3, 8, 8]);
});

test("findTables sources use document lines", () => {
  const doc = "# Title\n\n| a | << |\n|---|---|\n| 1 | 2 |\n";
  const [r] = findTables(doc);
  const lines = doc.split("\n");
  assert.deepEqual(r.sources.map((s) => [s.line, lines[s.line].slice(s.start, s.end)]), [[2, "a"], [4, "1"], [4, "2"]]);
  const crlf = findTables(doc.replaceAll("\n", "\r\n"))[0].sources.map((s) => [s.line, s.start, s.end]);
  assert.deepEqual(crlf, r.sources.map((s) => [s.line, s.start, s.end]));
});

test("offsets are UTF-16 code units", () => {
  const line = "| \u{1f600} | \u{1d400}b {c:2} |";
  const [a, b] = parseTable(`${line}\n|---|---|---|`).sources;
  assert.equal(line.slice(a.start, a.end), "\u{1f600}");
  assert.deepEqual([a.start, a.end, b.start, b.end], [2, 4, 7, 16]);
  assert.equal(line.slice(b.start, b.end), "\u{1d400}b {c:2}");
});

test("writeWithSources on random tables", () => {
  const rng = new Random(11);
  for (let i = 0; i < 2000; i++) {
    const rows = rng.randint(1, 7);
    const table = randomTable(rng, rows, rng.randint(1, 6), rng.randint(1, rows));
    const { text, sources } = writeWithSources(table);
    assert.equal(text, write(table));
    const lines = text.split("\n");
    assert.deepEqual(sources.map((s) => [s.row, s.col, s.rowspan, s.colspan]),
      table.cells.map((c) => [c.row, c.col, c.rowspan, c.colspan]));
    assert.deepEqual(sources.map((s) => unescapeWriter(textAt(lines[s.line], s))), table.cells.map((c) => c.text));
  }
});

test("sources of parsed random documents point at the cells", () => {
  const rng = new Random(5);
  for (let i = 0; i < 1000; i++) {
    const rows = rng.randint(1, 6);
    const table = randomTable(rng, rows, rng.randint(1, 5), rng.randint(1, rows));
    const doc = `Some text\n\n${write(table)}\n\nafter\n`;
    const [r] = findTables(doc);
    const lines = doc.split("\n");
    r.table.cells.forEach((cell, k) => assert.equal(textAt(lines[r.sources[k].line], r.sources[k]), cell.text));
  }
});
