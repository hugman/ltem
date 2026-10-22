/** Table model validity, findTables and the command-line interface. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkTable, endsTableBody, findTables, formatProblem, indentation, isDelimiterRow, isUpperHeaderRow,
  parseTable, splitRow, tableFromJSON, VERSION, type Table,
} from "../dist/index.js";
import { loadExamples, loadSchema, schemaErrors } from "../../../test-support/conformance.ts";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

const DOC = `# Report

Some text with a price of $5.

| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |

\`\`\`
| not | a | table |
|-----|---|-------|
\`\`\`

| A {c:2} |
|---|---|
| 1 | 2 |
`;

describe("table model", () => {
  test("parsed models satisfy the schema and the model rules", () => {
    const schema = loadSchema();
    for (const ex of loadExamples()) {
      for (const result of findTables(ex.ltem)) {
        assert.deepEqual(schemaErrors(schema, JSON.parse(JSON.stringify(result.table))), []);
        assert.deepEqual(checkTable(result.table), []);
      }
    }
  });

  test("JSON keys follow the schema order", () => {
    const [result] = findTables("| A |\n|---|\n| 1 |\n");
    assert.equal(JSON.stringify(result.table),
      '{"version":"1.0","rows":2,"cols":1,"header_rows":1,"align":[null],"cells":['
      + '{"row":0,"col":0,"rowspan":1,"colspan":1,"text":"A"},'
      + '{"row":1,"col":0,"rowspan":1,"colspan":1,"text":"1"}]}');
  });

  test("tableFromJSON copies a model and checks its version", () => {
    const table = findTables(DOC)[0].table;
    assert.deepEqual(tableFromJSON(JSON.parse(JSON.stringify(table))), table);
    assert.throws(() => tableFromJSON({ ...table, version: "2.0" }), /unsupported table model version/);
    assert.throws(() => tableFromJSON({ ...table, rows: "2" }), /rows must be an integer/);
  });

  test("checkTable reports broken models", () => {
    const table: Table = {
      version: "1.0", rows: 2, cols: 2, header_rows: 1, align: [null],
      cells: [
        { row: 1, col: 0, rowspan: 1, colspan: 1, text: "" },
        { row: 0, col: 0, rowspan: 2, colspan: 1, text: "" },
      ],
    };
    assert.deepEqual(checkTable(table), [
      "align has 1 entries, expected 2",
      "cells are not sorted by row and column",
      "header cell (0,0) reaches into the body",
      "position (1,0) belongs to two cells",
      "positions without a cell: [(0, 1), (1, 1)]",
    ]);
  });
});

const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);

describe("line rules (spec 2.1 to 2.4)", () => {
  test("cells are trimmed of spaces and tabs only (spec 2.1)", () => {
    assert.deepEqual(splitRow(`| \t a\t | ${IDEOGRAPHIC_SPACE}b${IDEOGRAPHIC_SPACE} |`),
      ["a", `${IDEOGRAPHIC_SPACE}b${IDEOGRAPHIC_SPACE}`]);
    const [result] = findTables(`| A |\n|---|\n|${IDEOGRAPHIC_SPACE}x |\n`);
    assert.equal(result.table.cells[1].text, `${IDEOGRAPHIC_SPACE}x`);
  });

  test("indentation counts tab stops every 4 columns", () => {
    assert.equal(indentation("\t  x"), 6);
    assert.equal(indentation("  \tx"), 4);
    assert.equal(indentation(" x"), 1);
    assert.equal(indentation(""), 0);
  });

  test("a delimiter row is indented less than 4 columns and is not a list item (spec 2.2)", () => {
    assert.ok(isDelimiterRow("   |---|"));
    assert.ok(isDelimiterRow("-| -"));
    assert.ok(!isDelimiterRow("    |---|"));
    assert.ok(!isDelimiterRow("\t|---|"));
    assert.ok(!isDelimiterRow("---"));
    assert.ok(!isDelimiterRow("- | -"));
    assert.ok(!isDelimiterRow("   -\t|-"));
    assert.deepEqual(findTables("Size | Price\n- | -\n"), []);
  });

  test("a line that looks like a delimiter row is never an upper header row (spec 2.3)", () => {
    assert.ok(isUpperHeaderRow("| a |"));
    assert.ok(!isUpperHeaderRow("|---|:-:|"));
    assert.ok(!isUpperHeaderRow("| # orders |"));
    assert.ok(!isUpperHeaderRow("    | a |"));
  });

  test("lines that end a table body (spec 2.4)", () => {
    const ends = ["", " \t ", "    x", "> q", "# h", "```", "~~~", "***", "- - -", "___", "- x", "-",
      "+\tx", "1. x", "3) x"];
    const continues = ["#h", "--", "1234567890. x", "-x", "| x |", "plain text", IDEOGRAPHIC_SPACE];
    for (const line of ends) assert.ok(endsTableBody(line), JSON.stringify(line));
    for (const line of continues) assert.ok(!endsTableBody(line), JSON.stringify(line));
  });
});

describe("parseTable and findTables", () => {
  test("delimiter rows are tried in order; a rejected one stays in the paragraph (spec 2.3)", () => {
    const [result] = findTables("| Region | Q1 | Q2 |\n|--------|----|\n| Asia | 1 |\n| a | b |\n|---|---|\n");
    assert.deepEqual([result.start, result.end, result.table.header_rows], [2, 5, 2]);
    assert.deepEqual(result.before, ["| Region | Q1 | Q2 |", "|--------|----|"]);
    assert.deepEqual(result.table.cells.map((c) => c.text), ["Asia", "1", "a", "b"]);
  });

  test("a last header row that looks like a delimiter row stands alone (spec 2.3)", () => {
    const [result] = findTables("Note\n| a | b |\n|---|\n|---|\n");
    assert.deepEqual([result.start, result.end, result.table.header_rows], [2, 4, 1]);
    assert.deepEqual(result.before, ["Note", "| a | b |"]);
    assert.deepEqual(result.table.cells.map((c) => c.text), ["---"]);
    // If the first delimiter row's table fits, the second delimiter row is a body row.
    const [first] = findTables("| a |\n|---|\n|---|\n");
    assert.deepEqual(first.table.cells.map((c) => c.text), ["a", "---"]);
  });

  test("blank lines and closing fences follow CommonMark (spec 2.4)", () => {
    const [result] = findTables(`| A |\n|---|\n| 1 |\n${IDEOGRAPHIC_SPACE}\n| 2 |\n`);
    assert.deepEqual(result.table.cells.map((c) => c.text), ["A", "1", IDEOGRAPHIC_SPACE, "2"]);
    for (const src of ["````\n```\n| a |\n|---|\n````\n| b |\n|---|\n", "~~~\n```\n| a |\n|---|\n~~~~ \n| b |\n|---|\n"]) {
      assert.deepEqual(findTables(src).map((r) => [r.start, r.table.cells[0].text]), [[5, "b"]]);
    }
    assert.deepEqual(findTables("```\n```js\n| a |\n|---|\n```\n"), []);
  });

  test("a delimiter row below a line indented as code is skipped", () => {
    assert.deepEqual(findTables("| a |\n    b\n|---|\n"), []);
    assert.deepEqual(findTables("| a |\n\t|---|\n"), []);
  });

  test("the body ends at a list item or a thematic break (spec 2.4)", () => {
    for (const src of ["| A |\n|---|\n| 1 |\n- | -\n2. x\n", "| a |\n|---|\n| 1 |\n- - -\n"]) {
      const [result] = findTables(src);
      assert.deepEqual([result.start, result.end, result.table.rows], [0, 3, 2]);
    }
  });

  test("findTables skips code blocks and reports line indices", () => {
    const results = findTables(DOC);
    assert.equal(results.length, 2);
    const lines = DOC.split("\n");
    assert.ok(lines[results[0].start].startsWith("| Region"));
    assert.ok(lines[results[1].start].startsWith("| A {c:2}"));
    assert.equal(results[1].end, results[1].start + 3);
  });

  test("lines before and after a table", () => {
    const result = parseTable(["Intro", "| # id |", "| A |", "|---|", "| 1 |", "# Next", "| x |"], 10);
    assert.deepEqual(result.before, ["Intro", "| # id |"]);
    assert.deepEqual(result.after, ["# Next", "| x |"]);
    assert.equal(result.start, 12);
    assert.equal(result.end, 15);
    assert.deepEqual(result.forms, ["grid", "grid"]);
  });

  test("rows are read as grid, compact or padded", () => {
    const result = parseTable("| A {c:2} |\n|---|---|\n| 1 | 2 |\n| 1 |\n| 1 | 2 | 3 |");
    assert.deepEqual(result.forms, ["compact", "grid", "padded", "padded"]);
    assert.deepEqual(result.problems.map(formatProblem), [
      "V14 at row 2: row has 1 cells; it fits neither as a grid row (2 cells) nor as a compact row",
      "V14 at row 3: row has 3 cells; it fits neither as a grid row (2 cells) nor as a compact row",
    ]);
  });

  test("carriage returns at line ends are ignored", () => {
    const [result] = findTables("| A | B |\r\n|---|---|\r\n| 1 | 2 |\r\n");
    assert.deepEqual(result.table.cells.map((c) => c.text), ["A", "B", "1", "2"]);
  });

  for (const [name, eol] of [["CRLF", "\r\n"], ["CR", "\r"]]) {
    test(`findTables accepts ${name} line endings (CommonMark)`, () => {
      const doc = ["```", "| a |", "|---|", "```", "", "| b |", "|---|", "| 1 |", ""].join(eol);
      const results = findTables(doc);
      assert.equal(results.length, 1);
      assert.deepEqual(results[0].table.cells.map((c) => c.text), ["b", "1"]);
      assert.deepEqual([results[0].start, results[0].end], [5, 8]);
    });
  }

  for (const text of ["", "no table here", "| a |\n| b |"]) {
    test(`no table in ${JSON.stringify(text)}`, () => {
      assert.deepEqual(findTables(text), []);
    });
  }
});

function run(args: string[], input = ""): { code: number | null; stdout: string; stderr: string } {
  const proc = spawnSync(process.execPath, [CLI, ...args], { input, encoding: "utf8" });
  return { code: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}

describe("command line", () => {
  test("parse and render", () => {
    let out = run(["parse"], DOC);
    assert.equal(out.code, 0);
    assert.equal((JSON.parse(out.stdout) as { tables: unknown[] }).tables.length, 2);
    out = run(["render"], DOC);
    assert.equal(out.code, 0);
    assert.equal(out.stdout.split("<table>").length - 1, 2);
    assert.ok(out.stdout.includes('colspan="2"'));
  });

  test("validate", () => {
    const out = run(["validate", "--json"], "| A | B |\n|---|---|\n| << | 1 |\n");
    assert.equal(out.code, 1);
    assert.deepEqual(JSON.parse(out.stdout), { errors: [{ rule: "V13", row: 1, col: 0, severity: "error" }] });
    const text = run(["validate"], "| A | B |\n|---|---|\n| << | 1 |\n");
    assert.equal(text.code, 1);
    assert.equal(text.stdout, "table 1: V13 at (1,0): '<<' has no cell to extend\n");
    assert.equal(run(["validate"], DOC).code, 0);
    // Warnings (V14) leave the table valid: exit status 0.
    const warning = run(["validate", "--json"], "| A | B |\n|---|---|\n| 1 |\n");
    assert.equal(warning.code, 0);
    assert.deepEqual(JSON.parse(warning.stdout), { errors: [{ rule: "V14", row: 1, col: null, severity: "warning" }] });
  });

  test("write", () => {
    const model = '{"version": "1.0", "rows": 2, "cols": 1, "header_rows": 1, "align": [null], "cells": [{"row": 0, "col": 0, "rowspan": 1, "colspan": 1, "text": "a | b"}, {"row": 1, "col": 0, "rowspan": 1, "colspan": 1, "text": "<<"}]}';
    assert.deepEqual(run(["write"], model), { code: 0, stdout: "| a \\| b |\n| --- |\n| \\<< |\n", stderr: "" });
    const two = run(["write"], `{"tables": [${model}, ${model}]}`);
    assert.equal(two.code, 0);
    assert.equal(two.stdout.split("| --- |").length, 3);
    assert.equal(run(["write"], "not json").code, 2);
    assert.equal(run(["write"], model.replace('"rows": 2', '"rows": 3')).code, 1);
  });

  test("fmt keeps the indentation of a table", () => {
    const out = run(["fmt"], "- item\n\n  | a | b |\n  |-|-|\n  | 1 | 2 |\n");
    assert.deepEqual(out, { code: 0, stdout: "- item\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n", stderr: "" });
  });

  test("fmt rewrites tables only", () => {
    const out = run(["fmt"], DOC);
    assert.equal(out.code, 0);
    assert.ok(out.stdout.includes("Some text with a price of $5."));
    assert.ok(out.stdout.includes("| not | a | table |")); // code block untouched
    assert.ok(out.stdout.includes("| A | << |\n| --- | --- |\n| 1 | 2 |"));
    assert.ok(out.stdout.includes("| Region | Revenue | << |\n| ^^ | Q1 | Q2 |"));
    assert.ok(out.stdout.endsWith("| 1 | 2 |\n"));
  });

  test("reads a file argument and normalizes line ends", () => {
    const dir = mkdtempSync(join(tmpdir(), "ltem-"));
    try {
      const file = join(dir, "doc.md");
      writeFileSync(file, DOC.replaceAll("\n", "\r\n"));
      const out = run(["fmt", file]);
      assert.equal(out.code, 0);
      assert.equal(out.stdout, run(["fmt", "-"], DOC).stdout);
      assert.equal((JSON.parse(run(["parse", file]).stdout) as { tables: unknown[] }).tables.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("translates line endings on standard input", () => {
    const out = run(["fmt"], "```\r\n| a |\r\n```\r\n\r\n| b {c:2} |\r\n|---|---|\r\n");
    assert.equal(out.code, 0);
    assert.equal(out.stdout, "```\n| a |\n```\n\n| b | << |\n| --- | --- |\n");
    assert.equal(run(["fmt"], "| b {c:2} |\r|---|---|\r").stdout, "| b | << |\n| --- | --- |\n");
  });

  test("usage errors exit with status 2", () => {
    for (const args of [[], ["frobnicate"], ["parse", "--json"], ["parse", "a", "b"], ["parse", "/no/such/file"]]) {
      const out = run(args);
      assert.equal(out.code, 2, args.join(" "));
      assert.ok(out.stderr.length > 0);
    }
  });

  test("help and version", () => {
    assert.ok(run(["--help"]).stdout.startsWith("usage: ltem"));
    assert.equal(run(["--version"]).stdout, `ltem ${VERSION}\n`);
  });

  test("no tables", () => {
    assert.equal(run(["parse"], "just text\n").stdout, '{\n  "tables": []\n}\n');
    assert.equal(run(["render"], "just text\n").stdout, "\n");
    assert.equal(run(["fmt"], "just text\n").stdout, "just text\n");
  });
});
