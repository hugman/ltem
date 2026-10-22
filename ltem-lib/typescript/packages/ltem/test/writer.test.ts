/** The canonical writer: round trips and edge cases. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { checkTable, parseTable, tableFromJSON, write, type Table } from "../dist/index.js";
import { Random, loadExamples } from "../../../test-support/conformance.ts";
import { cell, makeTable, normalized, randomTable } from "../../../test-support/tables.ts";

const EXAMPLE_TABLES = loadExamples().flatMap((ex) => ex.tables.map((t) => tableFromJSON(t)));

function reparse(table: Table): Table {
  const result = parseTable(write(table));
  assert.deepEqual(result.problems, []);
  assert.ok(result.forms.length > 0 && result.forms.every((f) => f === "grid"));
  assert.ok(result.table);
  return result.table;
}

describe("example tables round trip", () => {
  EXAMPLE_TABLES.forEach((table, i) => {
    test(`table ${i + 1}`, () => {
      assert.deepEqual(normalized(reparse(table)), table);
    });
  });
});

test("random tables round trip", () => {
  const rng = new Random(20261002);
  for (let i = 0; i < 2000; i++) {
    const rows = rng.randint(1, 7);
    const headerRows = rng.randint(1, rows);
    const table = randomTable(rng, rows, rng.randint(1, 6), headerRows);
    assert.deepEqual(checkTable(table), []);
    assert.deepEqual(normalized(reparse(table)), table);
  }
});

test("write is idempotent", () => {
  const source = "| A {c:2} |\n|---|---|\n| 1 | 2 |";
  const once = write(parseTable(source).table!);
  const twice = write(parseTable(once).table!);
  assert.equal(once, "| A | << |\n| --- | --- |\n| 1 | 2 |");
  assert.equal(twice, once);
});

test("writer escapes only where needed", () => {
  const table = makeTable(2, 2, 1, [null, null], [
    cell(0, 0, "-"), cell(0, 1, "-"),
    cell(1, 0, "<<"), cell(1, 1, "x {c:2}"),
  ]);
  assert.equal(write(table), "| \\- | - |\n| --- | --- |\n| \\<< | x \\{c:2} |");
});

test("writer uses ^^ below an origin and << elsewhere, and writes alignment", () => {
  const table = makeTable(3, 3, 2, ["left", "center", "right"], [
    cell(0, 0, "Summary", 2, 2), cell(0, 2, "Note"), cell(1, 2, "Q4"),
    cell(2, 0, "a | b\nc"), cell(2, 1, "^^"), cell(2, 2, ""),
  ]);
  assert.equal(write(table), [
    "| Summary | << | Note |",
    "| ^^ | << | Q4 |",
    "| :--- | :---: | ---: |",
    "| a \\| b \\\\ c | \\^^ |  |",
  ].join("\n"));
});

test("writer avoids a reserved identifier line", () => {
  // The last header row is read as a header row even in this form, so it needs no escape.
  let table = makeTable(2, 1, 1, [null], [cell(0, 0, "# orders"), cell(1, 0, "1")]);
  assert.equal(write(table), "| # orders |\n| --- |\n| 1 |");
  assert.deepEqual(reparse(table), table);
  // A header row above the last one would end the header rows (spec Section 9).
  table = makeTable(4, 1, 3, [null], [cell(0, 0, "a"), cell(1, 0, "# x"), cell(2, 0, "b"), cell(3, 0, "1")]);
  assert.equal(write(table), "| a |\n| \\# x |\n| b |\n| --- |\n| 1 |");
  assert.deepEqual(normalized(reparse(table)), table);
});

test("writer rejects an invalid model", () => {
  const table = makeTable(1, 2, 1, [null, null], [cell(0, 0, "a")]);
  assert.throws(() => write(table), /invalid table model: positions without a cell/);
});
