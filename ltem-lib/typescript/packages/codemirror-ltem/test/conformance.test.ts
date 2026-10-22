/**
 * The 46 examples of the LTEM specification: the editor must find the same tables as the
 * preview (markdown-it-ltem), with the same structure as the reviewed table models.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { editorTables, previewTables } from "./helpers.ts";
import { loadExamples } from "../../../test-support/conformance.ts";

const examples = loadExamples();

test("the specification has 46 examples", () => {
  assert.equal(examples.length, 46);
});

for (const ex of examples) {
  test(`example ${ex.example} (${ex.section})`, () => {
    const found = editorTables(ex.ltem);
    assert.deepEqual(found.map((t) => t.lines), previewTables(ex.ltem), "table boundaries match the preview");
    assert.deepEqual(found.map((t) => t.model), ex.tables, "table structure matches the reviewed models");
  });
}
