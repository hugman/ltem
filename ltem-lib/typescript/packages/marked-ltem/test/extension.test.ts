/** The marked extension, on marked 17 and 18. */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";

import { findTables, renderHtml } from "ltem-core";
import { Marked, type Token, type Tokens } from "marked";
import { Marked as Marked17 } from "marked-17";

import markedLtem, { type LtemTableCell, type LtemTableToken, type MarkedLtemOptions } from "../dist/index.js";
import { Random, loadExamples, normalize, normalizeTables } from "../../../test-support/conformance.ts";
import { randomDocument, randomFragment } from "../../../test-support/documents.ts";

const require = createRequire(import.meta.url);
// marked 17 is installed under the alias "marked-17"; its API is the one typed by marked 18.
const VERSIONS: [string, typeof Marked, string][] = [
  ["marked 18", Marked, require("marked/package.json").version as string],
  ["marked 17", Marked17 as unknown as typeof Marked, require("marked-17/package.json").version as string],
];
const EXAMPLES = loadExamples();
const BS = "\\";

type Factory = typeof Marked;

function withLtem(factory: Factory, gfm = true, options?: MarkedLtemOptions): Marked {
  return new factory({ gfm }).use(markedLtem(options));
}

function html(m: Marked, src: string): string {
  return m.parse(src) as string;
}

/** HTML of the tables, rendered by the core with the same marked for cell text. */
function coreTables(m: Marked, src: string): ReturnType<typeof normalizeTables> {
  return findTables(src).map((r) => normalize(renderHtml(r.table, (line) => m.parseInline(line) as string)));
}

/** Every token and table cell, depth first, as marked's walkTokens visits them. */
function walk(m: Marked, tokens: Token[]): Token[] {
  const seen: Token[] = [];
  m.walkTokens(tokens, (token) => {
    seen.push(token);
  });
  return seen;
}

/** The first token, an ltemTable token. */
function first(tokens: Token[]): LtemTableToken {
  assert.equal(tokens[0].type, "ltemTable");
  return tokens[0] as LtemTableToken;
}

function tablesOf(tokens: Token[]): (LtemTableToken | Tokens.Table)[] {
  const out: (LtemTableToken | Tokens.Table)[] = [];
  const visit = (list: Token[]): void => {
    for (const token of list) {
      if (token.type === "ltemTable" || token.type === "table") out.push(token as LtemTableToken | Tokens.Table);
      if ("tokens" in token && token.tokens && token.type !== "ltemTable") visit(token.tokens);
      if (token.type === "list") for (const item of (token as Tokens.List).items) visit(item.tokens);
    }
  };
  visit(tokens);
  return out;
}

/** The token list without what differs between marked versions outside tables. */
function comparable(tokens: Token[]): unknown {
  return JSON.parse(JSON.stringify(tokens.filter((t) => t.type !== "space"), (key, value) =>
    key === "raw" && typeof value === "string" ? value.replace(/\n+$/, "") : value));
}

for (const [name, factory, version] of VERSIONS) {
  describe(name, () => {
    test(`is version ${name.slice(-2)}`, () => {
      assert.ok(version.startsWith(`${name.slice(-2)}.`), version);
    });

    for (const [label, gfm, options] of [
      ["GFM on", true, {}],
      ["GFM off", false, {}],
      ["nativeTables: false", true, { nativeTables: false }],
    ] as const) {
      describe(`spec examples as whole documents (${label})`, () => {
        const m = withLtem(factory, gfm, options);
        for (const ex of EXAMPLES) {
          test(`example ${ex.example} (${ex.section})`, () => {
            assert.deepEqual(normalize(html(m, ex.ltem)), normalize(ex.html));
          });
        }
      });
    }

    describe("tables without LTEM notation are marked's own table tokens and render as before", () => {
      const native = new factory();
      const m = withLtem(factory);
      const samples: Record<string, string> = {
        "simple": "| a | b |\n|---|---|\n| 1 | 2 |\n",
        "alignment": "| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |\n",
        "no outer pipes": "a | b\n--|--\n1 | 2\n",
        "missing and extra cells": "| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n",
        "escaped pipes and inlines": "| `a\\|b` | **x** |\n|---|---|\n| [l](u) | \\| |\n",
        "links, images, code and autolinks": "| [a](http://x.y \"t\") | ![i](p.png) |\n|---|---|\n| `c` | <http://x.y> |\n",
        "header only": "| a |\n|---|\n",
        "empty cells": "|  |  |\n|--|--|\n| 1 |  |\n",
        "after a paragraph": "text\n| a |\n|---|\n| 1 |\n",
        "ends at a blank line": "| a |\n|---|\n| 1 |\n\npara | x\n",
        "ends at a heading": "| a |\n|---|\n| 1 |\n# h\n",
        "ends at a blockquote": "| a |\n|---|\n| 1 |\n> q\n",
        "ends at a fence": "| a |\n|---|\n| 1 |\n```\ncode\n```\n",
        "ends at a list": "| a |\n|---|\n| 1 |\n- item\n2. item\n",
        "ends at a thematic break": "| a |\n|---|\n| 1 |\n***\n",
        "ends at an HTML block": "| a |\n|---|\n| 1 |\n<div>\nx\n</div>\n",
        "ends at an HTML comment": "| a |\n|---|\n| 1 |\n<!-- c -->\n",
        "ends at indented code": "| a |\n|---|\n| 1 |\n    code\n",
        "continues with a paragraph line": "| a | b |\n|---|---|\n| 1 | 2 |\nmore\n",
        "in a blockquote": "> | a | b |\n> |---|---|\n> | 1 | 2 |\n",
        "in a list item": "- | a | b |\n  |---|---|\n  | 1 | 2 |\n- next\n",
        "in a loose list": "- x\n\n  | a |\n  |---|\n  | 1 |\n\n- y\n",
        "not a table: wrong cell count": "| a | b |\n|---|\n| 1 |\n",
        "not a table: indented delimiter": "| a |\n    |---|\n",
        "not a table: a setext heading": "Revenue\n===\n|---|\n",
        "indented as code": "    | a |\n    |---|\n",
        "two tables": "| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |\n",
        "a table after a heading": "# T\n| a |\n|---|\n| 1 |\n",
        "a table with reference links": "| [a] |\n|---|\n| [b][a] |\n\n[a]: http://x.y\n",
      };
      for (const [label, src] of Object.entries(samples)) {
        test(label, () => {
          assert.equal(html(m, src), html(native, src));
          assert.deepEqual(comparable(m.lexer(src)), comparable(native.lexer(src)));
        });
      }
    });

    describe("where LTEM differs from marked's own table rule (spec 1.2, 2.1, 2.2, 2.4)", () => {
      const native = new factory();
      const m = withLtem(factory);
      const cases: [string, string, string][] = [
        ["a line that begins a list item is no delimiter row", "Size | Price\n- | -\n",
          "<p>Size | Price</p>\n<ul>\n<li>| -</li>\n</ul>\n"],
        ["only the backslash directly before a pipe escapes it", "| a \\\\| b |\n|---|\n",
          "<table>\n<thead>\n<tr>\n<th>a | b</th>\n</tr>\n</thead>\n</table>\n"],
        ["only spaces and tabs are trimmed from cells", "| \u3000a\u00a0 |\n|---|\n",
          "<table>\n<thead>\n<tr>\n<th>\u3000a\u00a0</th>\n</tr>\n</thead>\n</table>\n"],
        ["any list item marker ends the body", "| a |\n|---|\n| 1 |\n2. x\n",
          "<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>1</td>\n</tr>\n</tbody></table>\n<ol start=\"2\">\n<li>x</li>\n</ol>\n"],
        ["a last header row may have extra empty cells", "| a | b | |\n|---|---|\n",
          "<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n</table>\n"],
        ["\\\\ is a line break", "| a \\\\ b |\n|---|\n",
          "<table>\n<thead>\n<tr>\n<th>a<br>b</th>\n</tr>\n</thead>\n</table>\n"],
      ];
      for (const [label, src, expected] of cases) {
        test(label, () => {
          assert.equal(html(m, src), expected);
          assert.notEqual(html(native, src), expected);
        });
      }
    });

    describe("tokens", () => {
      const m = withLtem(factory);

      test("an ltemTable token with header rows, body rows, spans and alignment", () => {
        const [table] = m.lexer("| A {c:2} | B |\n| ^^ | << | C |\n|:-|--|-:|\n| x \\\\ *y* | z | w |\n");
        assert.equal(table.type, "ltemTable");
        const t = table as LtemTableToken;
        assert.equal(t.raw, "| A {c:2} | B |\n| ^^ | << | C |\n|:-|--|-:|\n| x \\\\ *y* | z | w |\n");
        assert.deepEqual(t.align, ["left", null, "right"]);
        const shape = (rows: LtemTableCell[][]): unknown => rows.map((row) => row.map((c) =>
          [c.type, c.raw, c.text, c.header, c.align, c.row, c.col, c.rowspan, c.colspan]));
        assert.deepEqual(shape(t.header), [
          [["ltemTableCell", "A {c:2}", "A", true, "left", 0, 0, 2, 2], ["ltemTableCell", "B", "B", true, "right", 0, 2, 1, 1]],
          [["ltemTableCell", "C", "C", true, "right", 1, 2, 1, 1]],
        ]);
        assert.deepEqual(shape(t.rows), [[
          ["ltemTableCell", "x \\\\ *y*", "x\n*y*", false, "left", 2, 0, 1, 1],
          ["ltemTableCell", "z", "z", false, null, 2, 1, 1, 1],
          ["ltemTableCell", "w", "w", false, "right", 2, 2, 1, 1],
        ]]);
      });

      test("cell tokens: each line lexed on its own, lines separated by br tokens", () => {
        const table = first(m.lexer("| a \\\\ **b** \\\\ | `c \\\\ d` | **e \\\\ f** |\n|---|---|---|\n"));
        const types = (cell: LtemTableCell): string[] => cell.tokens.map((t) => t.type);
        const [a, code, strong] = table.header[0];
        assert.deepEqual(types(a), ["text", "br", "strong", "br"]);
        assert.deepEqual(a.tokens[1], { type: "br", raw: "\n" });
        // A code span or emphasis cannot run across a line break (spec 4.2).
        assert.deepEqual(types(code), ["text", "br", "text"]);
        assert.deepEqual(types(strong), ["text", "br", "text"]);
        assert.equal(html(m, "| **e \\\\ f** |\n|---|\n").includes("<strong>"), false);
      });

      test("cell texts are the table model's: no span attribute, | for \\|, LTEM escapes without backslash", () => {
        const all = withLtem(factory, true, { nativeTables: false });
        const src = `| ${BS}<< | ${BS}^^ | x ${BS}{c:2} | a ${BS}| b {c:1} |\n|---|---|---|---|\n| y {r:1} |\n`;
        const table = first(all.lexer(src));
        assert.deepEqual(table.header[0].map((c) => c.text), ["<<", "^^", "x {c:2}", "a | b"]);
        assert.deepEqual(table.header[0].map((c) => c.raw), [`${BS}<<`, `${BS}^^`, `x ${BS}{c:2}`, `a ${BS}| b {c:1}`]);
        assert.deepEqual(table.rows[0].map((c) => [c.text, c.raw]), [["y", "y {r:1}"], ["", ""], ["", ""], ["", ""]]);
      });

      test("a table that needs no LTEM feature is marked's table token", () => {
        const [table] = m.lexer("| a {c:1} | \\<< |\n|:-|--|\n| 1 |\n");
        assert.deepEqual(comparable([table]), [{
          type: "table",
          raw: "| a {c:1} | \\<< |\n|:-|--|\n| 1 |",
          align: ["left", null],
          header: [
            { text: "a", tokens: [{ type: "text", raw: "a", text: "a", escaped: false }], header: true, align: "left" },
            { text: "<<", tokens: [{ type: "text", raw: "<<", text: "<<", escaped: false }], header: true, align: null },
          ],
          rows: [[
            { text: "1", tokens: [{ type: "text", raw: "1", text: "1", escaped: false }], header: false, align: "left" },
            { text: "", tokens: [], header: false, align: null },
          ]],
        }]);
      });

      test("what needs an ltemTable token: several header rows, spans, line breaks", () => {
        const type = (src: string): string => m.lexer(src)[0].type;
        assert.equal(type("| a |\n| b |\n|---|\n"), "ltemTable");
        assert.equal(type("| a {c:2} |\n|---|---|\n"), "ltemTable");
        assert.equal(type("| a |\n|---|\n| 1 |\n| ^^ |\n"), "ltemTable");
        assert.equal(type("| a |\n|---|\n| 1 {r:1} |\n| ^^ |\n"), "table"); // V13: the marker stays text
        assert.equal(type("| a \\\\ b |\n|---|\n"), "ltemTable");
        assert.equal(type("| a | << |\n|---|---|\n"), "ltemTable");
        assert.equal(type("| << | a |\n|---|---|\n"), "table"); // V13: the marker stays text
        assert.equal(type("| a |\n|---|\n| ^^ |\n"), "table"); // V7: the marker stays text
      });

      test("nativeTables: false makes every table an ltemTable token", () => {
        const all = withLtem(factory, true, { nativeTables: false });
        const tokens = all.lexer("| a | b |\n|---|---|\n| 1 | 2 |\n");
        assert.equal(tokens[0].type, "ltemTable");
        assert.equal(html(all, "| a | b |\n|---|---|\n| 1 | 2 |\n"), html(new factory(), "| a | b |\n|---|---|\n| 1 | 2 |\n"));
      });

      test("a fully covered row is an empty row; no body rows without them", () => {
        const covered = first(m.lexer("| A | B |\n|---|---|\n| x {r:2} | y {r:2} |\n|  |\n| 1 | 2 |\n"));
        assert.deepEqual(covered.rows.map((r) => r.length), [2, 0, 2]);
        assert.ok(html(m, "| A | B |\n|---|---|\n| x {r:2} | y {r:2} |\n|  |\n| 1 | 2 |\n").includes("<tr>\n</tr>"));
        const headerOnly = first(m.lexer("| A {r:2} |\n| ^^ |\n|---|\n"));
        assert.deepEqual([headerOnly.header.length, headerOnly.rows.length], [2, 0]);
        assert.ok(!html(m, "| A {r:2} |\n| ^^ |\n|---|\n").includes("<tbody>"));
      });

      test("HTML in the format of marked's table renderer", () => {
        assert.equal(html(m, "| A {c:2} |\n| b | c |\n|:-:|---|\n| 1 \\\\ 2 | 3 |\n"),
          "<table>\n<thead>\n<tr>\n<th colspan=\"2\" align=\"center\">A</th>\n</tr>\n<tr>\n<th align=\"center\">b</th>\n"
          + "<th>c</th>\n</tr>\n</thead>\n<tbody><tr>\n<td align=\"center\">1<br>2</td>\n<td>3</td>\n</tr>\n</tbody></table>\n");
      });

      test("a renderer for another output walks the token as the README shows", () => {
        // The function of the README, with marked's inline renderer for the cell tokens.
        function renderLtemTable(token: LtemTableToken, inline: (tokens: Token[]) => string): string {
          const row = (cells: LtemTableCell[]): string => "<tr>" + cells.map((cell) => {
            const tag = cell.header ? "th" : "td";
            const attrs = (cell.colspan > 1 ? ` colspan="${cell.colspan}"` : "")
              + (cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : "");
            return `<${tag}${attrs}>${inline(cell.tokens)}</${tag}>`;
          }).join("") + "</tr>";
          return "<table><thead>" + token.header.map(row).join("") + "</thead>"
            + (token.rows.length ? "<tbody>" + token.rows.map(row).join("") + "</tbody>" : "") + "</table>";
        }
        const plain = withLtem(factory, true, { nativeTables: false });
        for (const ex of EXAMPLES.filter((e) => e.tables.length === 1 && !/align/.test(e.html))) {
          const tokens = plain.lexer(ex.ltem);
          const table = tokens.find((t) => t.type === "ltemTable") as LtemTableToken;
          const out = renderLtemTable(table, (t) => plain.Parser.parseInline(t, plain.defaults));
          assert.deepEqual(normalize(out), normalizeTables(ex.html)[0], `example ${ex.example}`);
        }
      });

      test("walkTokens visits the cells and their inline tokens", () => {
        const tokens = m.lexer("| *a* {c:2} |\n|---|---|\n| [l](u) \\\\ `c` | x |\n");
        const types = walk(m, tokens).map((t) => t.type);
        assert.deepEqual(types, ["ltemTable", "ltemTableCell", "em", "text", "ltemTableCell", "link", "text", "br",
          "codespan", "ltemTableCell", "text"]);
        // A walkTokens extension changes links in LTEM cells as in any other place.
        const rewritten = withLtem(factory).use({
          walkTokens(token) {
            if (token.type === "link") token.href = "https://example.com/";
          },
        });
        assert.ok(html(rewritten, "| [l](u) {c:2} |\n|---|---|\n").includes('<a href="https://example.com/">l</a>'));
      });

      test("an extension can override the ltemTable renderer and fall back to it", () => {
        const custom = withLtem(factory).use({
          extensions: [{
            name: "ltemTable",
            renderer(token) {
              return (token as LtemTableToken).header.length > 1 ? "<p>several header rows</p>\n" : false;
            },
          }],
        });
        assert.equal(html(custom, "| a |\n| b |\n|---|\n"), "<p>several header rows</p>\n");
        assert.ok(html(custom, "| a {c:2} |\n|---|---|\n").includes('<th colspan="2">a</th>'));
      });

      test("inline extensions apply in cells, on each line", () => {
        const mark = withLtem(factory).use({
          extensions: [{
            name: "mark",
            level: "inline",
            start: (src: string) => src.indexOf("=="),
            tokenizer(src: string) {
              const match = /^==([^=]+)==/.exec(src);
              return match ? { type: "mark", raw: match[0], text: match[1] } : undefined;
            },
            renderer: (token) => `<mark>${token.text}</mark>`,
          }],
        });
        assert.ok(html(mark, "| ==a== {c:2} |\n|---|---|\n| ==b \\\\ c== | ==d== |\n").includes(
          '<th colspan="2"><mark>a</mark></th>'));
        assert.ok(html(mark, "| ==a== {c:2} |\n|---|---|\n| ==b \\\\ c== | ==d== |\n").includes(
          "<td>==b<br>c==</td>\n<td><mark>d</mark></td>"));
        assert.ok(html(mark, "| ==a== |\n|---|\n").includes("<th><mark>a</mark></th>"));
      });

      test("a renderer for marked's table token still draws tables without LTEM features", () => {
        const custom = withLtem(factory).use({ renderer: { table: () => "<p>custom table</p>\n" } });
        assert.equal(html(custom, "| a |\n|---|\n| 1 |\n"), "<p>custom table</p>\n");
        assert.ok(html(custom, "| a {c:2} |\n|---|---|\n").includes('<th colspan="2">a</th>'));
      });

      test("inline lexing elsewhere is unaffected", () => {
        assert.equal(m.parseInline("**a** \\\\ b"), "<strong>a</strong> \\ b");
        assert.equal(m.parseInline("\nfoo"), new factory().parseInline("\nfoo"));
        assert.equal(html(m, "[\nfoo](u)\n"), html(new factory(), "[\nfoo](u)\n"));
      });

      test("reference links defined after the table resolve in LTEM cells", () => {
        const out = html(m, "| [a] \\\\ [b][a] {c:2} |\n|---|---|\n\n[a]: http://x.y\n");
        assert.equal(out.split('<a href="http://x.y">').length - 1, 2);
      });

      test("async parsing gives the same HTML", async () => {
        const src = EXAMPLES[22].ltem;
        const asyncMarked = withLtem(factory).use({ async: true });
        assert.equal(await asyncMarked.parse(src), html(m, src));
      });

      test("using the extension twice changes nothing", () => {
        const src = EXAMPLES[22].ltem + "\n" + EXAMPLES[30].ltem;
        assert.equal(html(withLtem(factory).use(markedLtem()), src), html(m, src));
      });
    });

    describe("behaviour", () => {
      const m = withLtem(factory);

      test("pipe-led lines above the last header row are header rows (spec 2.3)", () => {
        assert.deepEqual(normalize(html(m, "| a | << |\n| b | c |\n|---|---|\n")), normalize(
          '<table><thead><tr><th colspan="2">a</th></tr><tr><th>b</th><th>c</th></tr></thead></table>'));
      });

      test("a reserved identifier line stays in the paragraph (spec 9)", () => {
        assert.ok(html(m, "| x |\n| # orders |\n| ID |\n|---|\n| 1 |\n").startsWith("<p>| x |\n| # orders |</p>\n<table>"));
      });

      test("a rejected delimiter row stays in the paragraph and a later one can begin a table (spec 2.3)", () => {
        const src = "| Region | Q1 | Q2 |\n|--------|----|\n| Asia | 1 |\n| a | b |\n|---|---|\n";
        const out = html(m, src);
        assert.ok(out.startsWith("<p>| Region | Q1 | Q2 |\n|--------|----|</p>\n<table>"), out);
        assert.deepEqual(normalizeTables(out), coreTables(m, src));
      });

      test("lines that look like a GFM table but are none stay in the paragraph", () => {
        // marked's own paragraph rule would end the paragraph before "| a | b |".
        for (const gfm of [true, false]) {
          const plain = withLtem(factory, gfm);
          assert.equal(html(plain, "Intro\n| a | b |\n|---|\n"), "<p>Intro\n| a | b |\n|---|</p>\n");
          assert.equal(html(plain, "| x |\n| a | b |\n|---|\n"), "<p>| x |\n| a | b |\n|---|</p>\n");
          assert.equal(html(plain, "| A {r:2} | B |\n| X | Y | |\n|---|---|\n"),
            "<p>| A {r:2} | B |\n| X | Y | |\n|---|---|</p>\n");
          assert.equal(html(plain, "text\n| a \\\\| b |\n|---|---|\n"), "<p>text\n| a \\| b |\n|---|---|</p>\n");
        }
      });

      test("a last header row that looks like a delimiter row stands alone (spec 2.3)", () => {
        const src = "Note\n| a | b |\n|---|\n|---|\n";
        assert.ok(html(m, src).startsWith("<p>Note\n| a | b |</p>\n<table>"));
        assert.deepEqual(normalizeTables(html(m, src)), coreTables(m, src));
      });

      test("a line holding only an ideographic space is a body row (spec 2.4)", () => {
        const src = "| A |\n|---|\n| 1 |\n　\n| 2 |\n";
        assert.equal(html(m, src).split("<tr>").length - 1, 4);
        assert.deepEqual(normalizeTables(html(m, src)), coreTables(m, src));
      });

      test("a line that begins a block ends the body, also where marked's table would go on (spec 2.4)", () => {
        assert.ok(html(m, "| a |\n|---|\n| 1 |\n2. x\n").includes("</table>\n<ol start=\"2\">"));
        assert.ok(html(m, "| a |\n|---|\n| 1 |\n-\n").includes("</table>\n<ul>"));
        assert.ok(html(m, "| a |\n|---|\n- | -\n").includes("</table>\n<ul>"));
      });

      test("the body ends where an HTML block begins, as marked's table does", () => {
        const native = new factory();
        for (const line of ["<div>", "<!-- c -->", "<pre>", "<?x ?>", "<!DOCTYPE html>", "<span>x</span>"]) {
          const src = `| a |\n|---|\n| 1 |\n${line}\n`;
          assert.equal(html(m, src), html(native, src), line);
          const merged = `| a {c:2} |\n|---|---|\n| 1 | 2 |\n${line}\n`;
          assert.equal(html(m, merged).split("<tr>").length, html(native, src).split("<tr>").length, line);
        }
        assert.equal(html(m, "| a |\n|---|\n| 1 |\n<div>\n").split("<tr>").length - 1, 2);
      });

      test("inline Markdown, escapes and code in cells", () => {
        const src = "| **b** {c:2} | << | `x \\| y` |\n|---|---|---|\n| [l](u) | \\<< | \\{c:2} |\n";
        const out = html(m, src);
        assert.ok(out.includes('<th colspan="2"><strong>b</strong></th>'));
        assert.ok(out.includes("<th><code>x | y</code></th>"));
        assert.ok(out.includes('<td><a href="u">l</a></td>\n<td>&lt;&lt;</td>\n<td>{c:2}</td>'));
        assert.deepEqual(normalizeTables(out), coreTables(m, src));
      });

      test("alignment on the cell's origin column", () => {
        const out = html(m, "| a | b {c:2} |\n|:-:|--:|:--|\n| 1 | 2 | 3 |\n");
        assert.ok(out.includes('<th align="center">a</th>\n<th colspan="2" align="right">b</th>'));
        assert.ok(out.includes('<td align="left">3</td>'));
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
        "x\n| p {r:2} | q |\n| r |\n|---|---|\n| 1 | 2 |\n",
        "| a {c:2} |\n|---|---|\n| 1 | 2 |\n| b |\n|---|\n| 3 |\n",
      ]) {
        test(`finds the same tables as the core: ${JSON.stringify(src)}`, () => {
          assert.deepEqual(normalizeTables(html(m, src)), coreTables(m, src));
        });
      }

      test("tables in containers", () => {
        const src = "> | A {c:2} |\n> |---|---|\n> | 1 | 2 |\n\n- | A | << |\n  |---|---|\n  | 1 | 2 |\n\n"
          + "1. x\n   | p |\n   | A {c:2} |\n   |---|---|\n\n> > | A {c:2} |\n> > |:-|-:|\n";
        const out = html(m, src);
        assert.equal(out.split('<th colspan="2">A</th>').length - 1, 3);
        assert.ok(out.includes('<th colspan="2" align="left">A</th>'));
        assert.ok(out.startsWith("<blockquote>\n<table>"));
        assert.ok(out.includes("<li>x<table>") || out.includes("<li>x\n<table>"), out);
      });

      test("CRLF line endings", () => {
        const src = "text\r\n| a {c:2} |\r\n|---|---|\r\n| 1 \\\\ 2 | 3 |\r\n";
        assert.deepEqual(normalizeTables(html(m, src)), coreTables(m, src));
      });

      test("several tables in one document", () => {
        const src = "| a {c:2} |\n|---|---|\n\ntext\n\n| b |\n|---|\n| 1 |\n\n| c |\n| d |\n|---|\n";
        assert.deepEqual(m.lexer(src).filter((t) => t.type !== "space").map((t) => t.type),
          ["ltemTable", "paragraph", "table", "ltemTable"]);
        assert.deepEqual(normalizeTables(html(m, src)), coreTables(m, src));
      });

      test("incomplete input never throws, line by line and character by character", () => {
        const docs = [...EXAMPLES.map((ex) => ex.ltem), randomDocument(new Random(7)).markdown,
          "> | a {c:2} | \\\n> |--", "- | a | b\n  |:-", "| a \\\\ `b"];
        for (const doc of docs) {
          for (let i = 0; i <= doc.length; i++) {
            const prefix = doc.slice(0, i);
            assert.doesNotThrow(() => html(m, prefix), prefix);
          }
        }
      });

      test("random fragments never throw", () => {
        const rng = new Random(20261023);
        const others = [withLtem(factory, false), withLtem(factory, true, { nativeTables: false })];
        for (let i = 0; i < 3000; i++) {
          const fragment = randomFragment(rng);
          for (const instance of [m, ...others]) assert.doesNotThrow(() => html(instance, fragment), JSON.stringify(fragment));
        }
      });

      test("a half-written last row renders the cells it has", () => {
        assert.ok(html(m, "| A | B {r:2} |\n|---|---|\n| 1").includes("<td>1</td>\n<td></td>"));
        assert.ok(!html(m, "| A | B |\n|--").includes("<table>"));
        assert.ok(html(m, "| A | B |\n| ^^ | C |\n|---|---|\n| x \\\\").includes("<td>x<br></td>"));
      });

      test("long pipe-led paragraphs, long tables and long lists stay fast", () => {
        const started = Date.now();
        const paragraph = Array.from({ length: 20000 }, (_, i) => `| line ${i} |`).join("\n");
        assert.ok(!html(m, paragraph).includes("<table>"));
        const table = ["| a | b | c |", "|---|---|---|", ...Array.from({ length: 20000 }, () => "| x |")].join("\n");
        assert.equal(html(m, table).split("<tr>").length - 1, 20001);
        const item = "- " + Array.from({ length: 5000 }, (_, i) => `| line ${i} |`).join("\n  ");
        assert.ok(!html(m, item).includes("<table>"));
        const many = Array.from({ length: 3000 }, (_, i) => `para ${i}\n| a {c:2} |\n|---|---|`).join("\n\n");
        assert.equal(html(m, many).split("<table>").length - 1, 3000);
        assert.ok(Date.now() - started < 20000, `took ${Date.now() - started} ms`);
      });
    });

    test("tables agree with the core on random documents", () => {
      const m = withLtem(factory, true, { nativeTables: false });
      const rng = new Random(20261019);
      for (let i = 0; i < 3000; i++) {
        const doc = randomDocument(rng);
        const out = html(m, doc.markdown);
        assert.deepEqual(normalizeTables(out), coreTables(m, doc.unwrapped), doc.markdown);
        // Each cell's raw is its source in the core (marked 17 expands tabs in list items).
        const lines = doc.unwrapped.split("\n");
        const spaces = (text: string): string => text.replace(/[ \t]+/g, " ");
        const core = findTables(doc.unwrapped).flatMap((r) =>
          r.sources.map((s) => spaces(lines[s.line].slice(s.start, s.end))));
        const cells = tablesOf(m.lexer(doc.markdown)).flatMap((t) =>
          [...(t as LtemTableToken).header, ...(t as LtemTableToken).rows].flat().map((c) => spaces(c.raw)));
        assert.deepEqual(cells, core, doc.markdown);
      }
    });

    test("native table tokens agree with the core on random documents", () => {
      const m = withLtem(factory);
      const rng = new Random(20261020);
      for (let i = 0; i < 1500; i++) {
        const doc = randomDocument(rng);
        assert.deepEqual(normalizeTables(html(m, doc.markdown)), coreTables(m, doc.unwrapped), doc.markdown);
      }
    });
  });
}
