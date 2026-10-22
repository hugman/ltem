/**
 * Updating a table's analysis after an edit in one row (`updateAnalysis`) gives the same
 * analysis as reading the table from the start, on random tables and random edits.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { splitRowSpans } from "ltem-core";

import { alignText, analyzeTable, deriveAnalysis, updateAnalysis } from "../dist/index.js";
import { Random } from "../../../test-support/conformance.ts";

const BS = "\\";
const CELLS = ["", "x", "값 1", "Revenue", "<<", "^^", "a {c:2}", "{c:2}", "b {r:2}", `${BS}<<`, `x ${BS}{c:2}`,
  `a ${BS}${BS} b`, `p ${BS}| q`, "**b**", "-", "# id", "a << b", "$5", "*e*", "인건비", "1,000"];
const EDITS = ["", "y", "가나다", "100", "<<", "^^", "z {c:2}", "{r:2}", `${BS}^^`, `two ${BS}${BS} lines`, `a ${BS}| b`,
  "a | b", "---", ":-:", "`code`", "x  y", BS, `${BS}${BS}`, "{c:0}", "끝"];

function randomTable(rng: Random): string[] {
  const cols = rng.randint(1, 5);
  const row = (): string => `| ${Array.from({ length: cols }, () => rng.choice(CELLS)).join(" | ")} |`;
  const lines: string[] = [];
  for (let i = rng.randint(1, 3); i > 0; i--) lines.push(row());
  lines.push(`|${"---|".repeat(cols)}`);
  for (let i = rng.randint(0, 6); i > 0; i--) lines.push(row());
  return lines;
}

test("an updated analysis equals a fresh one", () => {
  const rng = new Random(20261018);
  let updated = 0;
  let tried = 0;
  while (tried < 4000) {
    const lines = randomTable(rng);
    const old = analyzeTable(lines);
    if (!old) continue;
    const index = rng.randint(0, lines.length - 1);
    const spans = splitRowSpans(lines[index]);
    if (!spans.length) continue;
    const [, start, end] = rng.choice(spans);
    const next = lines.slice();
    next[index] = lines[index].slice(0, start) + rng.choice(EDITS) + lines[index].slice(end);
    tried++;
    const fresh = analyzeTable(next);
    const result = updateAnalysis(old, next, index);
    if (result === null) continue;
    updated++;
    assert.ok(fresh, `the edit keeps a table: ${next.join("\n")}`);
    assert.deepEqual(result, fresh, next.join("\n"));
  }
  // Plain text edits in origin cells are the common case; most of them must be updated.
  assert.ok(updated > 800, `updated ${updated} of ${tried}`);
});

test("an analysis derived after lining up and an edit equals a fresh one", () => {
  const rng = new Random(20261019);
  let derived = 0;
  for (let tried = 0; tried < 4000;) {
    const lines = randomTable(rng);
    const old = analyzeTable(lines);
    if (!old) continue;
    tried++;
    let next = rng.random() < 0.7 ? alignText(lines, old.table.header_rows) ?? lines : lines.slice();
    if (rng.random() < 0.8) {
      const index = rng.randint(0, next.length - 1);
      const spans = splitRowSpans(next[index]);
      if (spans.length) {
        const [, start, end] = rng.choice(spans);
        next = next.slice();
        next[index] = next[index].slice(0, start) + rng.choice(EDITS) + next[index].slice(end);
      }
    }
    const result = deriveAnalysis(old, next);
    if (result === null) continue;
    derived++;
    assert.deepEqual(result, analyzeTable(next), next.join("\n"));
  }
  assert.ok(derived > 1500, `derived ${derived}`);
});
