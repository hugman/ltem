/** The markdown-it plugin, on markdown-it 14 and 15. */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";

import { findTables, renderHtml } from "ltem-core";
import markdownit from "markdown-it";
import markdownit14 from "markdown-it-14";

import ltem, { type LtemCellPosition } from "../dist/index.js";
import { Random, loadExamples, normalize, normalizeTables } from "../../../test-support/conformance.ts";

type MarkdownIt = ReturnType<typeof markdownit>;
type Token = ReturnType<MarkdownIt["parse"]>[number];

const require = createRequire(import.meta.url);
const VERSIONS: [string, typeof markdownit, string][] = [
  ["markdown-it 15", markdownit, require("markdown-it/package.json").version as string],
  ["markdown-it 14", markdownit14, require("markdown-it-14/package.json").version as string],
];
const EXAMPLES = loadExamples();
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);

/** HTML of the tables, rendered by the core with the same markdown-it for cell text. */
function coreTables(md: MarkdownIt, src: string): ReturnType<typeof normalizeTables> {
  return findTables(src).map((r) => normalize(renderHtml(r.table, (line) => md.renderInline(line))));
}

/** The th_open and td_open tokens' maps and cell positions. */
function positions(md: MarkdownIt, src: string): { map: [number, number] | null; ltem: LtemCellPosition }[] {
  return md.parse(src, {})
    .filter((t) => t.type === "th_open" || t.type === "td_open")
    .map((t) => ({ map: t.map, ltem: (t.meta as { ltem: LtemCellPosition }).ltem }));
}

/** The source of each cell, sliced from the document line with its position. */
function cellSources(md: MarkdownIt, src: string): string[] {
  const lines = src.split("\n");
  return positions(md, src).map(({ ltem: p }) => lines[p.line].slice(p.start, p.end));
}

function summary(tokens: Token[]): string[] {
  return tokens.map((t) => {
    const attrs = t.attrs ? `[${t.attrs.map(([k, v]) => `${k}=${v}`).join(" ")}]` : "";
    const content = t.type === "inline" ? ` ${JSON.stringify(t.content)}` : "";
    return `${t.type}${attrs}${content}`;
  });
}

for (const [name, factory, version] of VERSIONS) {
  describe(name, () => {
    test(`is version ${name.slice(-2)}`, () => {
      assert.ok(version.startsWith(`${name.slice(-2)}.`), version);
    });

    describe("spec examples as whole documents (commonmark preset)", () => {
      const md = factory("commonmark").use(ltem);
      for (const ex of EXAMPLES) {
        test(`example ${ex.example} (${ex.section})`, () => {
          assert.deepEqual(normalize(md.render(ex.ltem)), normalize(ex.html));
        });
      }
    });

    describe("spec examples as whole documents (default preset)", () => {
      const md = factory().use(ltem);
      for (const ex of EXAMPLES) {
        test(`example ${ex.example} (${ex.section})`, () => {
          assert.deepEqual(normalize(md.render(ex.ltem)), normalize(ex.html));
        });
      }
    });

    describe("tables without LTEM notation render as with markdown-it's own table rule", () => {
      const native = factory();
      const md = factory().use(ltem);
      const samples: Record<string, string> = {
        "simple": "| a | b |\n|---|---|\n| 1 | 2 |\n",
        "alignment": "| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |\n",
        "no outer pipes": "a | b\n--|--\n1 | 2\n",
        "missing and extra cells": "| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n",
        "escaped pipes and inlines": "| `a\\|b` | **x** |\n|---|---|\n| [l](u) | \\| |\n",
        "header only": "| a |\n|---|\n",
        "after a paragraph": "text\n| a |\n|---|\n| 1 |\n",
        "ends at a blank line": "| a |\n|---|\n| 1 |\n\npara | x\n",
        "ends at a heading": "| a |\n|---|\n| 1 |\n# h\n",
        "ends at a blockquote": "| a |\n|---|\n| 1 |\n> q\n",
        "ends at a fence": "| a |\n|---|\n| 1 |\n```\ncode\n```\n",
        "ends at a list": "| a |\n|---|\n| 1 |\n- item\n2. item\n",
        "ends at a thematic break": "| a |\n|---|\n| 1 |\n***\n",
        "ends at an HTML block": "| a |\n|---|\n| 1 |\n<div>\nx\n</div>\n",
        "ends at indented code": "| a |\n|---|\n| 1 |\n    code\n",
        "continues with a paragraph line": "| a | b |\n|---|---|\n| 1 | 2 |\nmore\n",
        "in a blockquote": "> | a | b |\n> |---|---|\n> | 1 | 2 |\n",
        "in a list item": "- | a | b |\n  |---|---|\n  | 1 | 2 |\n- next\n",
        "not a table: wrong cell count": "| a | b |\n|---|\n| 1 |\n",
        "not a table: indented delimiter": "| a |\n    |---|\n",
        "not a table: a list item below": "Size | Price\n- | -\n",
        "indented as code": "    | a |\n    |---|\n",
        "two tables": "| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |\n",
      };
      for (const [label, src] of Object.entries(samples)) {
        test(label, () => {
          assert.equal(md.render(src), native.render(src));
        });
      }
    });

    describe("tokens", () => {
      const md = factory("commonmark").use(ltem);

      test("normal markdown-it table tokens with colspan, rowspan and alignment", () => {
        const tokens = md.parse("| A {c:2} | B |\n| ^^ | << | C |\n|:-|--|-:|\n| x \\\\ *y* | z | w |\n", {});
        assert.deepEqual(summary(tokens), [
          "table_open", "thead_open",
          "tr_open", "th_open[colspan=2 rowspan=2 style=text-align:left]", 'inline "A"', "th_close",
          "th_open[style=text-align:right]", 'inline "B"', "th_close", "tr_close",
          "tr_open", "th_open[style=text-align:right]", 'inline "C"', "th_close", "tr_close",
          "thead_close", "tbody_open",
          "tr_open", "td_open[style=text-align:left]", 'inline "x\\\\\\n*y*"', "td_close",
          "td_open", 'inline "z"', "td_close", "td_open[style=text-align:right]", 'inline "w"', "td_close",
          "tr_close", "tbody_close", "table_close",
        ]);
      });

      test("cell positions: map and meta.ltem on th_open and td_open", () => {
        const src = "intro\n\n| R {c:2} |\n| a   | \\| b |\n|---|---|\n| x | y |\n| z |\n";
        const got = positions(md, src);
        assert.deepEqual(got.map((p) => p.map), [[2, 3], [3, 4], [3, 4], [5, 6], [5, 6], [6, 7], [6, 7]]);
        assert.deepEqual(got.map(({ ltem: p }) => [p.row, p.col, p.rowspan, p.colspan, p.line]),
          [[0, 0, 1, 2, 2], [1, 0, 1, 1, 3], [1, 1, 1, 1, 3], [2, 0, 1, 1, 5], [2, 1, 1, 1, 5], [3, 0, 1, 1, 6], [3, 1, 1, 1, 6]]);
        assert.deepEqual(cellSources(md, src), ["R {c:2}", "a", "\\| b", "x", "y", "z", ""]);
        const padded = got[got.length - 1].ltem;
        assert.deepEqual([padded.start, padded.end], [5, 5]); // a padded cell sits at the end of its line
      });

      test("cell positions are offsets in the document line, after container prefixes", () => {
        const quoted = "Intro\n\n> | a | b {c:2} |\n> |---|---|---|\n>   | x \\| | \u{1f600} | |\n";
        assert.deepEqual(cellSources(md, quoted), ["a", "b {c:2}", "x \\|", "\u{1f600}", ""]);
        assert.deepEqual(positions(md, quoted).map(({ ltem: p }) => [p.line, p.start, p.end]),
          [[2, 4, 5], [2, 8, 15], [4, 6, 10], [4, 13, 15], [4, 18, 18]]);
        assert.deepEqual(cellSources(md, "- | a |\n  |---|\n  | 1 |\n"), ["a", "1"]);
        assert.deepEqual(cellSources(md, "> > | a | b |\n> > |:-|-:|\n"), ["a", "b"]);
        assert.deepEqual(cellSources(md, ">\t| a |\n>\t|---|\n"), ["a"]);
      });

      test("source maps", () => {
        const tokens = md.parse("| A |\n| B |\n|---|\n| 1 |\n| 2 |\n", {});
        const maps = tokens.filter((t) => t.map).map((t) => `${t.type} ${t.map!.join("-")}`);
        assert.deepEqual(maps, [
          "table_open 0-5", "thead_open 0-2", "tr_open 0-1", "th_open 0-1", "inline 0-1", "tr_open 1-2", "th_open 1-2",
          "inline 1-2", "tbody_open 3-5", "tr_open 3-4", "td_open 3-4", "inline 3-4", "tr_open 4-5", "td_open 4-5",
          "inline 4-5",
        ]);
      });

      test("lines of a cell are hard breaks inside one inline token", () => {
        const tokens = md.parse("| a \\\\ **b** \\\\ |\n|---|\n", {});
        const inline = tokens.filter((t) => t.type === "inline");
        assert.equal(inline.length, 1);
        assert.equal(inline[0].content, "a\\\n**b**\\\n");
        const lineTypes = ["a", "**b**", ""].map((line) => md.parseInline(line, {})[0].children!.map((t) => t.type));
        assert.deepEqual(inline[0].children!.map((t) => t.type),
          [...lineTypes[0], "hardbreak", ...lineTypes[1], "hardbreak", ...lineTypes[2]]);
      });

      test("a fully covered row still gets tr_open and tr_close; no tbody without body rows", () => {
        const covered = summary(md.parse("| A | B |\n|---|---|\n| x {r:2} | y {r:2} |\n|  |\n| 1 | 2 |\n", {}));
        assert.equal(covered.join(" ").split("tr_open tr_close").length - 1, 1);
        const headerOnly = summary(md.parse("| A {r:2} |\n| ^^ |\n|---|\n", {}));
        assert.ok(!headerOnly.includes("tbody_open"));
        assert.equal(headerOnly.filter((t) => t === "tr_open").length, 2);
      });
    });

    describe("behaviour", () => {
      const md = factory("commonmark").use(ltem);

      test("each line of a cell is parsed on its own (spec 4.2)", () => {
        const src = "| **a \\\\ b** | `c \\\\ d` | x \\ \\\\ y |\n|---|---|---|\n";
        const html = md.render(src);
        assert.ok(!html.includes("<strong>") && !html.includes("<code>"));
        assert.ok(html.includes("x \\<br />"));
        assert.deepEqual(normalizeTables(html), coreTables(md, src));
      });

      test("pipe-led lines above the last header row are header rows (spec 2.3)", () => {
        const html = md.render("| a | << |\n| b | c |\n|---|---|\n");
        assert.deepEqual(normalize(html), normalize(
          '<table><thead><tr><th colspan="2">a</th></tr><tr><th>b</th><th>c</th></tr></thead></table>'));
      });

      test("a reserved identifier line stays in the paragraph (spec 9)", () => {
        const html = md.render("| x |\n| # orders |\n| ID |\n|---|\n| 1 |\n");
        assert.ok(html.startsWith("<p>| x |\n| # orders |</p>\n<table>"));
      });

      test("a rejected delimiter row stays in the paragraph and a later one can begin a table (spec 2.3)", () => {
        const src = "| Region | Q1 | Q2 |\n|--------|----|\n| Asia | 1 |\n| a | b |\n|---|---|\n";
        const html = md.render(src);
        assert.ok(html.startsWith("<p>| Region | Q1 | Q2 |\n|--------|----|</p>\n<table>"));
        assert.deepEqual(normalizeTables(html), coreTables(md, src));
      });

      test("a last header row that looks like a delimiter row stands alone (spec 2.3)", () => {
        const src = "Note\n| a | b |\n|---|\n|---|\n";
        const tokens = md.parse(src, {});
        const maps = tokens.filter((t) => t.type.endsWith("_open") && t.map).map((t) => `${t.type} ${t.map!.join("-")}`);
        assert.deepEqual(maps, ["paragraph_open 0-2", "table_open 2-4", "thead_open 2-3", "tr_open 2-3", "th_open 2-3"]);
        assert.ok(md.render(src).startsWith("<p>Note\n| a | b |</p>\n<table>"));
        assert.deepEqual(normalizeTables(md.render(src)), coreTables(md, src));
      });

      test("a line holding only an ideographic space is a body row (spec 2.4)", () => {
        const src = `| A |\n|---|\n| 1 |\n${IDEOGRAPHIC_SPACE}\n| 2 |\n`;
        assert.equal(md.render(src).split("<tr>").length - 1, 4);
        assert.deepEqual(normalizeTables(md.render(src)), coreTables(md, src));
      });

      test("a list item below a table ends it", () => {
        // "- | -" is a list item, not a delimiter row (spec 2.2), so it ends the body.
        const src = "| a |\n|---|\n- | -\n";
        const html = md.render(src);
        assert.deepEqual(normalizeTables(html), coreTables(md, src));
        assert.ok(html.includes("</table>\n<ul>"));
      });

      for (const src of [
        "a | b\n|---|\n| c |\n|:-:|\n",
        "| a |\n    |---|\n| 1 |\n",
        "| # id |\n| a | << |\n|---|---|\n| 1 | 2 |\n",
        "text\n| a | b {c:2} |\n| c |\n|---|---|---|\n| 1 | 2 | 3 |\n",
        "| a | b |\n|---|\n|---|\n| 1 |\n",
        "a | b\n- | -\n",
        "a | b\n-| -\n",
        "````\n```\n| a |\n|---|\n````\n| b |\n|---|\n",
      ]) {
        test(`finds the same tables as the core: ${JSON.stringify(src)}`, () => {
          assert.deepEqual(normalizeTables(md.render(src)), coreTables(md, src));
        });
      }

      test("tables in containers", () => {
        const src = "> | A {c:2} |\n> |---|---|\n> | 1 | 2 |\n\n- | A | << |\n  |---|---|\n  | 1 | 2 |\n";
        const html = md.render(src);
        assert.equal(html.split('<th colspan="2">A</th>').length - 1, 2);
        assert.ok(html.startsWith("<blockquote>\n<table>"));
      });

      test("the zero preset gets a table rule", () => {
        assert.ok(factory("zero").use(ltem).render("| a |\n|---|\n| 1 |\n").includes("<td>1</td>"));
      });

      test("a preset without a table rule gets one before indented code", () => {
        const md2 = factory("commonmark");
        const ruler = md2.block.ruler as unknown as { __rules__: { name: string }[]; __cache__: unknown };
        ruler.__rules__ = ruler.__rules__.filter((r) => r.name !== "table");
        ruler.__cache__ = null;
        md2.use(ltem);
        assert.ok(md2.render("| a {c:2} |\n|---|---|\n").includes('<th colspan="2">a</th>'));
      });

      test("using the plugin twice changes nothing", () => {
        const src = EXAMPLES[22].ltem;
        assert.equal(factory("commonmark").use(ltem).use(ltem).render(src), md.render(src));
      });

      test("renderInline is unaffected", () => {
        assert.equal(md.renderInline("**a** \\\\ b"), "<strong>a</strong> \\ b");
      });

      test("long pipe-led paragraphs and long tables stay fast", () => {
        const started = Date.now();
        const paragraph = Array.from({ length: 20000 }, (_, i) => `| line ${i} |`).join("\n");
        assert.ok(!md.render(paragraph).includes("<table>"));
        const table = ["| a | b | c |", "|---|---|---|", ...Array.from({ length: 20000 }, () => "| x |")].join("\n");
        assert.equal(md.render(table).split("<tr>").length - 1, 20001);
        assert.ok(Date.now() - started < 10000, `took ${Date.now() - started} ms`);
      });
    });

    test("tables agree with the core on random documents", () => {
      const md = factory("commonmark").use(ltem);
      const rng = new Random(20261002);
      for (let i = 0; i < 1500; i++) {
        const src = randomDocument(rng);
        assert.deepEqual(normalizeTables(md.render(src)), coreTables(md, src), src);
        // At the top level, cell positions are the core's cell sources.
        const core = findTables(src).flatMap((r) => r.sources.map((s) => [s.row, s.col, s.rowspan, s.colspan, s.line, s.start, s.end]));
        const plugin = positions(md, src).map(({ ltem: p }) => [p.row, p.col, p.rowspan, p.colspan, p.line, p.start, p.end]);
        assert.deepEqual(plugin, core, src);
      }
    });
  });
}

// -- random documents ---------------------------------------------------------------------
//
// Blocks separated by blank lines, built only from constructs on which the plugin and the
// core's light scan agree by design: no HTML blocks; lines after which markdown-it
// continues a container lazily (block quotes, list items) end their block; and a list
// is closed by a paragraph before the next block.

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
