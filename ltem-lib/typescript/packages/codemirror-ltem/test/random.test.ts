/**
 * Random documents: the editor finds the same tables as the preview (markdown-it-ltem), at
 * the same lines and with the same structure as the LTEM core. The documents are built from
 * constructs on which markdown-it and the core's light scan agree (see markdown-it-ltem's
 * tests, where the generator comes from).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { findTables } from "ltem-core";

import { editorTables, previewTables } from "./helpers.ts";
import { Random } from "../../../test-support/conformance.ts";

const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);

test("tables agree with the preview and the core on random documents", () => {
  const rng = new Random(20261017);
  for (let i = 0; i < 1500; i++) {
    const src = randomDocument(rng);
    const found = editorTables(src);
    assert.deepEqual(found.map((t) => t.lines), previewTables(src), src);
    assert.deepEqual(found.map((t) => t.model), findTables(src).map((r) => r.table), src);
  }
});

// -- random documents (from markdown-it-ltem's tests) ---------------------------------------

const BS = "\\";
const CELLS = ["", "x", "Revenue", "<<", "^^", "<<", "^^", "a {c:2}", "{c:2}", "b {r:2}", "{r:3}", "c {c:2,r:2}",
  "d {r:2,c:3}", "{c:0}", "e {c:1,c:2}", "f {r:0}", `${BS}<<`, `${BS}^^`, `x ${BS}{c:2}`, `a ${BS}${BS} b`,
  `l1 ${BS}${BS} l2 ${BS}${BS} l3`, `p ${BS}| q`, "**b**", "-", ":-:", "# id", "a << b", "$5 ~ $10",
  "x\t{c:2}", "{c:99}", "{r:99}", "z {c:2}", BS.repeat(3), `${IDEOGRAPHIC_SPACE}y${IDEOGRAPHIC_SPACE}`, "*e*"];
const SAFE_FIRST = ["x", "Revenue", "z {c:2}", "a {c:2}"];
const DELIMITERS = ["---", ":--", "--:", ":-:", "-"];

function randomRow(rng: Random, n: number): string {
  const lead = rng.random() > 0.1;
  const cells = Array.from({ length: n }, (_, i) => (i === 0 && !lead ? rng.choice(SAFE_FIRST) : rng.choice(CELLS)));
  const indent = rng.choice(["", "", "", " ", "   "]);
  return indent + (lead ? "| " : "") + cells.join(" | ") + (rng.random() > 0.1 ? " |" : "");
}

function randomTableLines(rng: Random): string[] {
  const cols = rng.randint(1, 5);
  const width = (): number => Math.max(1, cols + rng.choice([0, 0, 0, -1, 1, -2]));
  const lines: string[] = [];
  if (rng.random() < 0.3) lines.push(rng.choice(["Some text", "| # orders |", "plain | pipe", "| p |"]));
  const delimiter = (n: number): string => "|" + Array.from({ length: n }, () => rng.choice(DELIMITERS)).join("|") + "|";
  for (let i = rng.randint(1, 3); i > 0; i--) {
    lines.push(randomRow(rng, width()));
    if (rng.random() < 0.1) lines.push(delimiter(width())); // a delimiter row that may be rejected
  }
  lines.push(delimiter(cols));
  if (rng.random() < 0.1) lines.push(delimiter(width()));
  for (let i = rng.randint(0, 5); i > 0; i--) {
    lines.push(rng.random() < 0.05 ? IDEOGRAPHIC_SPACE : randomRow(rng, width()));
  }
  if (rng.random() < 0.3) {
    lines.push(rng.choice(["# Next", "> quote", "- item", "1. item", "***", "- - -", "    code", "- | -"]));
  }
  return lines;
}

function randomDocument(rng: Random): string {
  const blocks: string[] = [];
  for (let i = rng.randint(1, 5); i > 0; i--) {
    const kind = rng.random();
    if (kind < 0.7) {
      const lines = randomTableLines(rng);
      blocks.push(lines.join("\n"));
      // A list item takes in an indented block after a blank line; end the list first.
      if (/^(?:- |1\. )/.test(lines[lines.length - 1])) blocks.push("End of list");
    }
    else if (kind < 0.8) {
      blocks.push(rng.choice(["```\n| a |\n|---|\n```", "````\n```\n| a |\n|---|\n````", "~~~\n```js\n| a |\n|---|\n~~~~  "]));
    }
    else if (kind < 0.9) blocks.push("# Heading\n| a | b |\n|---|---|");
    else blocks.push("Some text\nmore text");
  }
  return blocks.join("\n\n") + "\n";
}
