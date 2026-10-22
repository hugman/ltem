/** The mdast utilities: from Markdown, to hast and to Markdown. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Element, Root as HastRoot } from "hast";
import { toHtml } from "hast-util-to-html";
import { findTables, renderHtml, type Table as ModelTable } from "ltem-core";
import type { Nodes, PhrasingContent, Root, Table, TableCell, TableRow } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown, mathToMarkdown } from "mdast-util-math";
import { toHast } from "mdast-util-to-hast";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import { ltem } from "micromark-extension-ltem";

import { ltemFromMarkdown, ltemHandlers, ltemTableHandler, ltemToMarkdown } from "../dist/index.js";
import { Random, loadExamples, normalize, normalizeTables } from "../../../test-support/conformance.ts";
import { randomDocument, randomFragment } from "../../../test-support/documents.ts";
import { BLOCK_CONSTRUCTS, paragraphContent } from "../../../test-support/unified.ts";

const EXAMPLES = loadExamples();

function parse(src: string, withGfm = false): Root {
  return fromMarkdown(src, {
    extensions: withGfm ? [gfm(), ltem()] : [ltem()],
    mdastExtensions: withGfm ? [gfmFromMarkdown(), ltemFromMarkdown()] : [ltemFromMarkdown()],
  });
}

function hast(tree: Nodes): HastRoot | Element {
  return toHast(tree, { handlers: ltemHandlers }) as HastRoot | Element;
}

function render(src: string, withGfm = false): string {
  return toHtml(hast(parse(src, withGfm)));
}

function write(tree: Nodes, withGfm = false): string {
  return toMarkdown(tree, { extensions: withGfm ? [gfmToMarkdown(), ltemToMarkdown()] : [ltemToMarkdown()] });
}

/** HTML for one line of cell text, parsed and compiled as inlines only. */
function inline(line: string): string {
  return paragraphContent(toHtml(toHast(fromMarkdown(line, { extensions: [{ disable: { null: BLOCK_CONSTRUCTS } }] }))));
}

/** HTML of the tables, rendered by the core with the same inline processing. */
function coreTables(src: string): ReturnType<typeof normalizeTables> {
  return findTables(src).map((r) => normalize(renderHtml(r.table, inline)));
}

/** The table nodes of a tree, depth first. */
function tables(node: Nodes): Table[] {
  if (node.type === "table") return [node];
  return "children" in node ? node.children.flatMap((child) => tables(child)) : [];
}

/** A tree without positions, for comparing trees. */
function strip<T>(node: T): T {
  return JSON.parse(JSON.stringify(node, (key, value) => (key === "position" ? undefined : value)));
}

/** A table node as the core's table model, from its fields. */
function model(table: Table): Omit<ModelTable, "version" | "cells"> & { cells: unknown[] } {
  return {
    rows: table.children.length,
    cols: table.align!.length,
    header_rows: table.headerRows!,
    align: table.align!,
    cells: table.children.flatMap((row) => row.children.map((c) => [c.row, c.col, c.rowspan, c.colspan])),
  };
}

function cellNode(text: string, fields: Partial<TableCell> = {}): TableCell {
  return { type: "tableCell", ...fields, children: text ? [{ type: "text", value: text }] : [] };
}

function tableNode(rows: TableCell[][], fields: Partial<Table> = {}): Table {
  return { type: "table", ...fields, children: rows.map((cells): TableRow => ({ type: "tableRow", children: cells })) };
}

for (const withGfm of [false, true]) {
  describe(`spec examples as whole documents${withGfm ? ", with mdast-util-gfm" : ""}`, () => {
    for (const ex of EXAMPLES) {
      test(`example ${ex.example} (${ex.section})`, () => {
        assert.deepEqual(normalize(render(ex.ltem, withGfm)), normalize(ex.html));
      });
    }
  });
}

describe("from Markdown", () => {
  test("table, tableRow and tableCell nodes with LTEM's fields and positions", () => {
    const tree = parse("| A {c:2} | B |\n| ^^ | << | C |\n|:-|--|-:|\n| x \\\\ *y* | z |\n");
    assert.deepEqual(strip(tree.children), [{
      type: "table", align: ["left", null, "right"], headerRows: 2, children: [
        { type: "tableRow", children: [
          { type: "tableCell", row: 0, col: 0, rowspan: 2, colspan: 2, children: [{ type: "text", value: "A" }] },
          { type: "tableCell", row: 0, col: 2, rowspan: 1, colspan: 1, children: [{ type: "text", value: "B" }] },
        ] },
        { type: "tableRow", children: [
          { type: "tableCell", row: 1, col: 2, rowspan: 1, colspan: 1, children: [{ type: "text", value: "C" }] },
        ] },
        { type: "tableRow", children: [
          { type: "tableCell", row: 2, col: 0, rowspan: 1, colspan: 1, children: [
            { type: "text", value: "x" }, { type: "break" }, { type: "emphasis", children: [{ type: "text", value: "y" }] },
          ] },
          { type: "tableCell", row: 2, col: 1, rowspan: 1, colspan: 1, children: [{ type: "text", value: "z" }] },
          { type: "tableCell", row: 2, col: 2, rowspan: 1, colspan: 1, children: [] },
        ] },
      ],
    }]);
  });

  test("positions: the table, rows, cells without spaces around them, and inline content", () => {
    const tree = parse("intro\n\n> | R {c:2} |\n> | a   | \\| *b* |\n> |---|---|\n> | x |\n");
    const table = tables(tree)[0];
    const at = (node: Nodes): string => {
      const { start, end } = node.position!;
      return `${start.line}:${start.column}-${end.line}:${end.column}`;
    };
    assert.equal(at(table), "3:3-6:8");
    assert.deepEqual(table.children.map(at), ["3:3-3:14", "4:3-4:19", "6:3-6:8"]);
    assert.deepEqual(table.children.flatMap((row) => row.children.map(at)),
      ["3:5-3:12", "4:5-4:6", "4:11-4:17", "6:5-6:6", "6:8-6:8"]);
    const emphasis = table.children[1].children[1].children[1];
    assert.equal(emphasis.type, "emphasis");
    assert.equal(at(emphasis), "4:14-4:17");
  });

  test("escaped pipes: removed in text, links, code, raw HTML and autolinks (spec 2.1)", () => {
    const src = "| a\\|b | `c\\|d` | <span title=\"e\\|f\"> | [g\\|h](i\\|j) | x\\\\| | `y\\\\|z` | <http://k\\|l> |\n"
      + "|-|-|-|-|-|-|-|\n";
    const cells = tables(parse(src))[0]
      .children[0].children.map((cell) => strip(cell.children));
    assert.deepEqual(cells, [
      [{ type: "text", value: "a|b" }],
      [{ type: "inlineCode", value: "c|d" }],
      [{ type: "html", value: "<span title=\"e|f\">" }],
      [{ type: "link", url: "i|j", title: null, children: [{ type: "text", value: "g|h" }] }],
      // \\| is a backslash and an escaped pipe: the cell text holds \|, an escaped pipe.
      [{ type: "text", value: "x|" }],
      [{ type: "inlineCode", value: "y\\|z" }],
      [{ type: "link", url: "http://k|l", title: null, children: [{ type: "text", value: "http://k|l" }] }],
    ]);
  });

  test("escaped pipes in math of mdast-util-math are removed too (spec 2.1)", () => {
    const tree = fromMarkdown("| $\\|r\\| < 1$ |\n|---|\n", {
      extensions: [math(), ltem()], mdastExtensions: [mathFromMarkdown(), ltemFromMarkdown()],
    });
    assert.deepEqual(strip(tables(tree)[0].children[0].children[0].children), [{
      type: "inlineMath", value: "|r| < 1", data: { hName: "code", hProperties: { className: ["language-math", "math-inline"] },
        hChildren: [{ type: "text", value: "|r| < 1" }] },
    }]);
  });

  test("a math block of mdast-util-math ends the body, as other blocks of the host do (spec 2.4)", () => {
    const tree = fromMarkdown("| a |\n|---|\n| 1 |\n$$\nx\n$$\n", {
      extensions: [math(), ltem()], mdastExtensions: [mathFromMarkdown(), ltemFromMarkdown()],
    });
    assert.deepEqual(tree.children.map((node) => node.type), ["table", "math"]);
    assert.equal(tables(tree)[0].children.length, 2);
  });

  test("a line break in a cell is a break node; each line is parsed on its own (spec 4.2)", () => {
    const cell = tables(parse("| **a \\\\ b** \\\\ `c` |\n|---|\n"))[0].children[0].children[0];
    assert.deepEqual(strip(cell.children), [
      { type: "text", value: "**a" }, { type: "break" }, { type: "text", value: "b**" }, { type: "break" },
      { type: "inlineCode", value: "c" },
    ]);
  });

  test("tables in containers", () => {
    const tree = parse("> | A {c:2} |\n> |---|---|\n\n- | a | << |\n  |---|---|\n  | 1 | 2 |\n");
    assert.deepEqual(tables(tree).map((t) => t.children[0].children[0].colspan), [2, 2]);
  });

  test("with mdast-util-gfm: other GFM constructs in cells", () => {
    const tree = parse("| ~~a~~ www.example.com {c:2} |\n|---|---|\n| [^1] | - [ ] x |\n\n[^1]: note\n", true);
    const [head, body] = tables(tree)[0].children;
    assert.deepEqual(head.children[0].children.map((c) => c.type), ["delete", "text", "link"]);
    assert.deepEqual(body.children[0].children.map((c) => c.type), ["footnoteReference"]);
  });

  test("table structure and cell positions agree with the core on random documents", () => {
    const rng = new Random(20261021);
    for (let i = 0; i < 1500; i++) {
      const { markdown } = randomDocument(rng, { containers: false });
      const results = findTables(markdown);
      const found = tables(parse(markdown));
      assert.equal(found.length, results.length, markdown);
      found.forEach((table, t) => {
        const core = results[t].table;
        const { cells, ...rest } = model(table);
        assert.deepEqual(rest, { rows: core.rows, cols: core.cols, header_rows: core.header_rows, align: core.align }, markdown);
        assert.deepEqual(cells, core.cells.map((c) => [c.row, c.col, c.rowspan, c.colspan]), markdown);
        const positions = table.children.flatMap((row) => row.children.map((c) =>
          [c.position!.start.line - 1, c.position!.start.column - 1, c.position!.end.column - 1]));
        assert.deepEqual(positions, results[t].sources.map((s) => [s.line, s.start, s.end]), markdown);
      });
    }
  });
});

describe("to hast", () => {
  test("header rows in thead, spans, alignment of the origin column, no tbody without body rows", () => {
    assert.equal(render("| A {c:2} |\n| b | c |\n|:-:|---|\n| 1 \\\\ 2 | 3 |\n"),
      "<table>\n<thead>\n<tr>\n<th colspan=\"2\" align=\"center\">A</th>\n</tr>\n<tr>\n<th align=\"center\">b</th>\n"
      + "<th>c</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td align=\"center\">1<br>\n2</td>\n<td>3</td>\n</tr>\n</tbody>\n</table>");
    assert.ok(!render("| A {r:2} |\n| ^^ |\n|---|\n").includes("<tbody>"));
    assert.ok(render("| A | B |\n|---|---|\n| x {r:2} | y {r:2} |\n|  |\n| 1 | 2 |\n").includes("<tr>\n</tr>"));
  });

  test("hast positions of the table, its head, body, rows and cells", () => {
    const table = hast(parse("| a |\n| b |\n|---|\n| 1 |\n| 2 |\n")).children[0] as Element;
    const elements = (node: Element): Element[] =>
      [node, ...node.children.flatMap((child) => (child.type === "element" ? elements(child) : []))];
    assert.deepEqual(elements(table).map((e) => `${e.tagName} ${e.position?.start.line}-${e.position?.end.line}`), [
      "table 1-5", "thead 1-2", "tr 1-1", "th 1-1", "tr 2-2", "th 2-2", "tbody 4-5", "tr 4-4", "td 4-4", "tr 5-5", "td 5-5",
    ]);
  });

  test("a table without LTEM fields comes out as with mdast-util-to-hast's own handler", () => {
    for (const src of ["| a | b |\n|:-|-:|\n| 1 |\n| 1 | 2 | 3 |\n", "a | b\n--|--\n", "| `x\\|y` | *z* |\n|---|---|\n| 1 | 2 |\n"]) {
      const tree = fromMarkdown(src, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
      assert.equal(toHtml(toHast(tree, { handlers: ltemHandlers })), toHtml(toHast(tree)), src);
    }
  });

  test("cells are laid out as HTML does, with spans cut to a valid grid", () => {
    const table = tableNode([
      [cellNode("a", { colspan: 2 }), cellNode("b"), cellNode("dropped")],
      [cellNode("c", { rowspan: 5 })],
      [cellNode("d", { colspan: 9 })],
    ], { align: [null, "right", null], headerRows: 1 });
    assert.deepEqual(normalize(toHtml(hast(table))), normalize(
      '<table><thead><tr><th colspan="2">a</th><th>b</th></tr></thead><tbody>'
      + '<tr><td rowspan="2">c</td><td align="right"></td><td></td></tr><tr><td colspan="2" align="right">d</td></tr></tbody></table>'));
    const noAlign = tableNode([[cellNode("a", { colspan: 2 })], [cellNode("b"), cellNode("c")]]);
    assert.deepEqual(normalize(toHtml(hast(noAlign))), normalize(
      '<table><thead><tr><th colspan="2">a</th></tr></thead><tbody><tr><td>b</td><td>c</td></tr></tbody></table>'));
  });

  test("data on rows and cells applies, as with mdast-util-to-hast's own handlers", () => {
    const table = tableNode([[cellNode("a", { data: { hProperties: { className: ["x"] } } })]]);
    table.children[0].data = { hName: "tr", hProperties: { id: "r" } };
    assert.equal(toHtml(hast(table)), '<table>\n<thead>\n<tr id="r">\n<th class="x">a</th>\n</tr>\n</thead>\n</table>');
  });

  test("the handler is exported on its own too", () => {
    assert.equal(ltemHandlers.table, ltemTableHandler);
  });

  test("tables agree with the core on random documents", () => {
    const rng = new Random(20261019);
    for (let i = 0; i < 3000; i++) {
      const doc = randomDocument(rng);
      assert.deepEqual(normalizeTables(render(doc.markdown)), coreTables(doc.unwrapped), doc.markdown);
    }
  });
});

describe("to Markdown", () => {
  test("tables in the canonical form (spec Section 8)", () => {
    assert.equal(write(parse("| Region | Revenue | <<  |\n| ^^     | Q1      | Q2  |\n|:--|--:|:-:|\n| Asia | 100 \\\\ *x* |\n")),
      "| Region | Revenue | << |\n| ^^ | Q1 | Q2 |\n| :--- | ---: | :---: |\n| Asia | 100 \\\\ *x* |  |\n");
    assert.equal(write(parse("| A {c:2,r:2} | B |\n| C |\n|---|---|---|\n")), "| A | << | B |\n| ^^ | << | C |\n| --- | --- | --- |\n");
  });

  test("escapes: pipes, markers, span attributes and header rows that read as something else (spec 4.3)", () => {
    const table = tableNode([
      [cellNode("<<"), cellNode("^^"), cellNode("x {c:2}"), cellNode("a | b")],
      [cellNode("-"), cellNode(":-:"), cellNode("--"), cellNode("---")],
      [cellNode("# id"), cellNode(""), cellNode(""), cellNode("")],
    ], { align: [null, null, null, null], headerRows: 2 });
    assert.equal(write(table),
      "| \\<< | \\^^ | x \\{c:2} | a \\| b |\n| \\- | :-: | -- | --- |\n| --- | --- | --- | --- |\n| # id |  |  |  |\n");
    const header = tableNode([[cellNode("# id")], [cellNode("x")]], { align: [null], headerRows: 2 });
    assert.equal(write(header), "| \\# id |\n| x |\n| --- |\n");
  });

  test("inline Markdown in cells: code with pipes, raw HTML, links, breaks", () => {
    const md = "| `a\\|b` | <span title=\"c\\|d\"> | [e](f \"g\") | ~~h~~ |\n| --- | --- | --- | --- |\n";
    assert.equal(write(parse(md, true), true), md);
  });

  test("math of mdast-util-math is written as it is, with pipes escaped by the writer", () => {
    const options = { extensions: [math(), ltem()], mdastExtensions: [mathFromMarkdown(), ltemFromMarkdown()] };
    const tree = fromMarkdown("| $\\|r\\|$ | $a\\\\b$ |\n|---|---|\n", options);
    const md = toMarkdown(tree, { extensions: [mathToMarkdown(), ltemToMarkdown()] });
    // In the second cell, the line break cuts the math: two lines of text with dollar signs.
    assert.equal(md, "| $\\|r\\|$ | \\$a \\\\ b\\$ |\n| --- | --- |\n");
    assert.deepEqual(strip(fromMarkdown(md, options)), strip(tree));
    const literal: Table = tableNode([[{ type: "tableCell", children: [{ type: "inlineMath", value: "x\\\\y" }] }]]);
    assert.equal(toMarkdown(literal, { extensions: [mathToMarkdown(), ltemToMarkdown()] }), "| x&#92;\\y |\n| --- |\n");
  });

  test("text that would make two backslashes in a row", () => {
    const table = tableNode([[
      cellNode("a\\*b"),
      { type: "tableCell", children: [{ type: "inlineCode", value: "c\\\\d" }] },
      cellNode("e\\"),
    ]]);
    const md = write(table);
    assert.equal(md, "| a&#92;\\*b | c&#92;\\d | e\\ |\n| --- | --- | --- |\n");
    assert.deepEqual(strip(tables(parse(md))[0].children[0].children.map((c) => c.children)),
      [[{ type: "text", value: "a\\*b" }], [{ type: "text", value: "c\\\\d" }], [{ type: "text", value: "e\\" }]]);
  });

  test("line breaks inside markup and line endings in text keep the row on one line", () => {
    const strong: PhrasingContent = { type: "strong", children: [{ type: "text", value: "a" }, { type: "break" }, { type: "text", value: "b" }] };
    const table = tableNode([[{ type: "tableCell", children: [strong] }, cellNode("c\nd")]]);
    assert.equal(write(table), "| **a b** | c&#xA;d |\n| --- | --- |\n");
  });

  test("any table becomes a valid LTEM table: spans cut, cells added, columns from the cells", () => {
    const table = tableNode([
      [cellNode("a", { colspan: 3, rowspan: 4 })],
      [cellNode("b")],
      [],
    ], { headerRows: 1 });
    assert.equal(write(table), "| a | << | << |\n| b |  |  |\n|  |  |  |\n".replace(/\n(?=\| b)/, "\n| --- | --- | --- |\n"));
    assert.equal(write(tableNode([])), "");
  });

  test("paragraphs that look like a table stay paragraphs", () => {
    const tree: Root = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "a | b\n|---|---|\n:-- | --:" }] }] };
    const md = write(tree);
    assert.equal(tables(parse(md)).length, 0, md);
    assert.deepEqual(strip(parse(md).children), strip(tree.children));
  });

  test("the order of extensions decides who writes tables", () => {
    const tree = parse("| A {c:2} |\n|---|---|\n");
    assert.equal(toMarkdown(tree, { extensions: [gfmToMarkdown(), ltemToMarkdown()] }), "| A | << |\n| --- | --- |\n");
    // mdast-util-gfm after mdast-util-ltem writes the table as GFM, which loses the span.
    assert.equal(toMarkdown(tree, { extensions: [ltemToMarkdown(), gfmToMarkdown()] }), "| A |\n| - |\n");
  });

  test("spec examples survive a round trip", () => {
    for (const ex of EXAMPLES) {
      const tree = parse(ex.ltem);
      const md = write(tree);
      assert.deepEqual(strip(parse(md)), strip(tree), `example ${ex.example}:\n${md}`);
      assert.equal(write(parse(md)), md, `example ${ex.example}`);
    }
  });

  test("random fragments never throw, and their Markdown is stable after one round", () => {
    const rng = new Random(20261023);
    for (let i = 0; i < 3000; i++) {
      const fragment = randomFragment(rng);
      const once = write(parse(fragment, true), true);
      const twice = write(parse(once, true), true);
      assert.equal(write(parse(twice, true), true), twice, JSON.stringify(fragment));
      assert.doesNotThrow(() => toHtml(hast(parse(fragment, true))), JSON.stringify(fragment));
    }
  });

  test("random documents survive a round trip", () => {
    const rng = new Random(20261022);
    for (let i = 0; i < 1500; i++) {
      const { markdown } = randomDocument(rng);
      const tree = parse(markdown, true);
      const md = write(tree, true);
      const again = parse(md, true);
      assert.deepEqual(tables(again).map((t) => strip(t)), tables(tree).map((t) => strip(t)), `${markdown}\n----\n${md}`);
      assert.equal(write(again, true), md, markdown);
    }
  });
});
