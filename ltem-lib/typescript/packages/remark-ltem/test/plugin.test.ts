/** The remark plugin: alone, with remark-gfm, with remark-stringify, react-markdown and MDX. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { evaluate } from "@mdx-js/mdx";
import { findTables, renderHtml } from "ltem-core";
import { createElement } from "react";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import remarkStringify from "remark-stringify";
import { unified, type Processor } from "unified";

import remarkLtem, { ltemHandlers } from "../dist/index.js";
import { Random, loadExamples, normalize, normalizeTables } from "../../../test-support/conformance.ts";
import { randomDocument, randomFragment } from "../../../test-support/documents.ts";
import { BLOCK_CONSTRUCTS, paragraphContent } from "../../../test-support/unified.ts";

const EXAMPLES = loadExamples();

const PIPELINES = {
  "remark-ltem": unified().use(remarkParse).use(remarkLtem).use(remarkRehype, { handlers: ltemHandlers })
    .use(rehypeStringify),
  "remark-gfm, then remark-ltem": unified().use(remarkParse).use(remarkGfm).use(remarkLtem)
    .use(remarkRehype, { handlers: ltemHandlers }).use(rehypeStringify),
  "remark-ltem, then remark-gfm": unified().use(remarkParse).use(remarkLtem).use(remarkGfm)
    .use(remarkRehype, { handlers: ltemHandlers }).use(rehypeStringify),
};
const gfmOnly = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeStringify);
const withGfm = PIPELINES["remark-gfm, then remark-ltem"];

function html(processor: { processSync(value: string): unknown }, src: string): string {
  return String(processor.processSync(src));
}

/** A remark plugin that turns micromark's block constructs off, so a line is one paragraph. */
function inlineOnly(this: Processor): undefined {
  (this.data().micromarkExtensions ??= []).push({ disable: { null: BLOCK_CONSTRUCTS } });
}

const inlinePipeline = unified().use(remarkParse).use(remarkGfm).use(inlineOnly).use(remarkRehype).use(rehypeStringify);

/** HTML of the tables, rendered by the core with remark's inline processing for cell text. */
function coreTables(src: string): ReturnType<typeof normalizeTables> {
  return findTables(src).map((r) => normalize(renderHtml(r.table, (line) => paragraphContent(html(inlinePipeline, line)))));
}

for (const [name, processor] of Object.entries(PIPELINES)) {
  describe(`spec examples as whole documents: ${name}`, () => {
    for (const ex of EXAMPLES) {
      test(`example ${ex.example} (${ex.section})`, () => {
        assert.deepEqual(normalize(html(processor, ex.ltem)), normalize(ex.html));
      });
    }
  });
}

describe("with remark-gfm: tables without LTEM notation render as with remark-gfm alone", () => {
  const samples: Record<string, string> = {
    "simple": "| a | b |\n|---|---|\n| 1 | 2 |\n",
    "alignment": "| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |\n",
    "no outer pipes": "a | b\n--|--\n1 | 2\n",
    "missing and extra cells": "| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n",
    "escaped pipes and inlines": "| `a\\|b` | **x** |\n|---|---|\n| [l](u) | \\| |\n",
    "header only": "| a |\n|---|\n",
    "empty cells": "|  |  |\n|--|--|\n| 1 |  |\n",
    "after a paragraph": "text\n| a |\n|---|\n| 1 |\n",
    "ends at a blank line": "| a |\n|---|\n| 1 |\n\npara | x\n",
    "ends at a heading": "| a |\n|---|\n| 1 |\n# h\n",
    "ends at a blockquote": "| a |\n|---|\n| 1 |\n> q\n",
    "ends at a fence": "| a |\n|---|\n| 1 |\n```\ncode\n```\n",
    "ends at a list": "| a |\n|---|\n| 1 |\n- item\n",
    "ends at a thematic break": "| a |\n|---|\n| 1 |\n***\n",
    "ends at indented code": "| a |\n|---|\n| 1 |\n    code\n",
    "in a blockquote": "> | a | b |\n> |---|---|\n> | 1 | 2 |\n",
    "in a list item": "- | a | b |\n  |---|---|\n  | 1 | 2 |\n- next\n",
    "not a table: wrong cell count": "| a | b |\n|---|\n| 1 |\n",
    "two tables": "| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |\n",
    "other GFM in cells": "| ~~a~~ | www.example.com | [^1] |\n|---|---|---|\n\n[^1]: note\n",
  };
  for (const [label, src] of Object.entries(samples)) {
    test(label, () => {
      assert.equal(html(withGfm, src), html(gfmOnly, src));
      assert.equal(html(PIPELINES["remark-ltem, then remark-gfm"], src), html(gfmOnly, src));
    });
  }

  test("the rest of GFM works as before", () => {
    const src = "~~gone~~ www.example.com a@b.co\n\n- [x] done\n- [ ] todo\n\nNote[^n].\n\n[^n]: The note.\n";
    for (const processor of [withGfm, PIPELINES["remark-ltem, then remark-gfm"]]) {
      assert.equal(html(processor, src), html(gfmOnly, src));
    }
  });
});

describe("behaviour", () => {
  const processor = PIPELINES["remark-ltem"];

  test("tables in containers, with inline Markdown, escapes and alignment", () => {
    const src = "> | **A** {c:2} | `x \\| y` |\n> |:-|--|-:|\n> | \\<< | x \\{c:2} | a \\\\ b |\n\n"
      + "- | A | << |\n  |---|---|\n  | [l](u) | <b>h</b> |\n";
    const out = html(withGfm, src);
    assert.ok(out.includes('<th colspan="2" align="left"><strong>A</strong></th>'), out);
    assert.ok(out.includes('<th align="right"><code>x | y</code></th>'));
    assert.ok(out.includes('<td align="left">&#x3C;&#x3C;</td>\n<td>x {c:2}</td>\n<td align="right">a<br>\nb</td>'));
    assert.equal(out.split('<th colspan="2">A</th>').length - 1, 1);
    assert.deepEqual(normalizeTables(out), coreTables("| **A** {c:2} | `x \\| y` |\n|:-|--|-:|\n| \\<< | x \\{c:2} | a \\\\ b |\n\n"
      + "| A | << |\n|---|---|\n| [l](u) | <b>h</b> |\n"));
  });

  test("several tables in one document", () => {
    const src = "| a {c:2} |\n|---|---|\n\ntext\n\n| b |\n|---|\n| 1 |\n\n| c |\n| d |\n|---|\n";
    assert.equal(html(processor, src).split("<table>").length - 1, 3);
    assert.deepEqual(normalizeTables(html(processor, src)), coreTables(src));
  });

  test("a table may begin on any line of a paragraph (spec 2.3)", () => {
    assert.ok(html(processor, "a\nb\n| x |\n| y {c:2} |\n|---|---|\n").startsWith("<p>a\nb</p>\n<table>"));
  });

  test("incomplete input never throws, character by character", () => {
    const docs = [...EXAMPLES.map((ex) => ex.ltem), randomDocument(new Random(7)).markdown, "> | a {c:2} | \\\n> |--"];
    for (const doc of docs) {
      for (let i = 0; i <= doc.length; i++) {
        const prefix = doc.slice(0, i);
        assert.doesNotThrow(() => html(withGfm, prefix), prefix);
      }
    }
  });

  test("random fragments never throw", () => {
    const rng = new Random(20261023);
    for (let i = 0; i < 2000; i++) {
      const fragment = randomFragment(rng);
      for (const pipeline of Object.values(PIPELINES)) assert.doesNotThrow(() => html(pipeline, fragment), JSON.stringify(fragment));
    }
  });

  test("CRLF line endings", () => {
    assert.ok(html(processor, "| a {c:2} |\r\n|---|---|\r\n| 1 | 2 |\r\n").includes('<th colspan="2">a</th>'));
  });

  test("rehype-sanitize keeps the spans with its default schema", () => {
    const sanitized = unified().use(remarkParse).use(remarkLtem).use(remarkRehype, { handlers: ltemHandlers })
      .use(rehypeSanitize).use(rehypeStringify);
    for (const ex of EXAMPLES.filter((e) => /colspan|rowspan/.test(e.html))) {
      assert.deepEqual(normalize(html(sanitized, ex.ltem)), normalize(ex.html), `example ${ex.example}`);
    }
  });

  test("using the plugin twice changes nothing", () => {
    const twice = unified().use(remarkParse).use(remarkLtem).use(remarkLtem).use(remarkRehype, { handlers: ltemHandlers })
      .use(rehypeStringify);
    for (const ex of EXAMPLES) assert.equal(html(twice, ex.ltem), html(processor, ex.ltem));
  });

  test("without the handlers, remark-rehype shows the cells as a plain grid", () => {
    const plain = unified().use(remarkParse).use(remarkLtem).use(remarkRehype).use(rehypeStringify);
    const out = html(plain, "| Region | Revenue | << |\n| ^^ | Q1 | Q2 |\n|---|---|---|\n| Asia | 100 | 120 |\n");
    assert.ok(!out.includes("colspan") && out.includes("<td>Q1</td>") && out.includes("<td>Asia</td>"));
  });
});

describe("remark-stringify", () => {
  const writer = unified().use(remarkParse).use(remarkGfm).use(remarkLtem).use(remarkStringify);

  test("LTEM tables are written in the canonical form", () => {
    assert.equal(String(writer.processSync("| Region | Revenue | <<  |\n| ^^ | Q1 | Q2 |\n|:-|-:|---|\n| Asia | 1 |\n")),
      "| Region | Revenue | << |\n| ^^ | Q1 | Q2 |\n| :--- | ---: | --- |\n| Asia | 1 |  |\n");
  });

  test("spec examples are stable", () => {
    for (const ex of EXAMPLES) {
      const once = String(writer.processSync(ex.ltem));
      assert.equal(String(writer.processSync(once)), once, `example ${ex.example}`);
      assert.deepEqual(normalize(html(withGfm, once)), normalize(html(withGfm, ex.ltem)), `example ${ex.example}`);
    }
  });
});

test("tables agree with the core on random documents", () => {
  const rng = new Random(20261019);
  for (let i = 0; i < 3000; i++) {
    const doc = randomDocument(rng);
    assert.deepEqual(normalizeTables(html(withGfm, doc.markdown)), coreTables(doc.unwrapped), doc.markdown);
  }
});

describe("react-markdown", () => {
  /** react-markdown's HTML, with remark-ltem and its handlers as the README shows. */
  function react(src: string): string {
    return renderToStaticMarkup(createElement(Markdown, {
      remarkPlugins: [remarkGfm, remarkLtem],
      remarkRehypeOptions: { handlers: ltemHandlers },
      children: src,
    }));
  }

  for (const ex of EXAMPLES) {
    test(`example ${ex.example} (${ex.section})`, () => {
      assert.deepEqual(normalize(react(ex.ltem)), normalize(ex.html));
    });
  }
});

describe("MDX", () => {
  async function mdx(src: string): Promise<string> {
    const { default: Content } = await evaluate(src, {
      ...runtime, remarkPlugins: [remarkLtem], remarkRehypeOptions: { handlers: ltemHandlers },
    });
    return renderToStaticMarkup(createElement(Content));
  }

  test("markers and span attributes are read by the table, before MDX sees cell text", async () => {
    // The examples with merged cells whose text holds no < or { for MDX to read.
    const merged = EXAMPLES.filter((ex) => /colspan|rowspan/.test(ex.html) && !/&lt;|[{}]|<p>/.test(ex.html));
    assert.ok(merged.length >= 15, String(merged.length));
    for (const ex of merged) {
      assert.deepEqual(normalize(await mdx(ex.ltem)), normalize(ex.html), `example ${ex.example}`);
    }
  });

  test("< and { in cell text are MDX syntax", async () => {
    assert.deepEqual(normalize(await mdx("| a {c:2} |\n|---|---|\n| <b>x</b> | {1 + 1} |\n")), normalize(
      '<table><thead><tr><th colspan="2">a</th></tr></thead><tbody><tr><td><b>x</b></td><td>2</td></tr></tbody></table>'));
    // A marker that extends no cell is cell text, and so is the escape \<<.
    await assert.rejects(mdx("| A | B |\n|---|---|\n| << | 1 |\n"), /before name/);
    await assert.rejects(mdx("| a |\n|---|\n| \\<< |\n"), /before name/);
    // Lines that are no table are a paragraph.
    await assert.rejects(mdx("| a | b |\n|---|\n| x << y |\n"), /before name/);
    // Character references or MDX's own escapes write the text <<.
    assert.equal((await mdx("| a | b |\n|---|---|\n| &lt;&lt; | \\<\\< |\n")).split("<td>&lt;&lt;</td>").length - 1, 2);
  });
});
