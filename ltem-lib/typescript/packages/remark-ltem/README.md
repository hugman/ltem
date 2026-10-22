# remark-ltem

[remark](https://github.com/remarkjs/remark) plugin for [LTEM](https://hugman.github.io/ltem/) tables: Markdown pipe tables with merged cells and multi-row headers.

```
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
```

renders as a table whose "Region" cell spans two rows and whose "Revenue" cell spans two columns.

The plugin wires up [`micromark-extension-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript/packages/micromark-extension-ltem) (the syntax) and [`mdast-util-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript/packages/mdast-util-ltem) (the syntax tree and Markdown output), and exports the handlers that remark-rehype needs to make HTML.

Status: version 0.1.0, the first release, for LTEM 1.0. Not yet published to npm. The API may change before version 1.0.0.

## Install

```
npm install remark-ltem
```

Works with unified 11, remark-parse 11, remark-stringify 11 and remark-rehype 11, and with remark-gfm 4. The package is ESM; CommonJS code can use `require("remark-ltem").default` on Node.js 20.19, 22.12 or later.

## Use

```ts
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkLtem, { ltemHandlers } from "remark-ltem";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const file = await unified()
  .use(remarkParse)
  .use(remarkGfm)                                // optional
  .use(remarkLtem)
  .use(remarkRehype, { handlers: ltemHandlers })  // required for merged cells
  .use(rehypeStringify)
  .process(text);
String(file);
```

The plugin replaces the GFM table syntax, also when remark-gfm is used, in either order; the rest of GFM (strikethrough, autolink literals, footnotes, task lists) works as before. A table without LTEM notation renders as before. LTEM tables get `colspan`, `rowspan` and several header rows, following the LTEM specification, version 1.0. How tables are recognized is described in [`micromark-extension-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript/packages/micromark-extension-ltem); the syntax tree in [`mdast-util-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript/packages/mdast-util-ltem#syntax-tree).

`ltemHandlers` must be passed to remark-rehype. remark-rehype's own `table` handler puts only the first row in `<thead>` and fills every row up to the number of columns; without `ltemHandlers`, LTEM tables come out as a plain grid without merged cells, as in a renderer without LTEM support.

With remark-stringify, LTEM tables are written in LTEM's canonical form (see [`mdast-util-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript/packages/mdast-util-ltem#to-markdown)). Use remark-ltem after remark-gfm there: whichever plugin comes last writes tables, and remark-gfm writes LTEM tables as GFM tables, which loses merged cells and header rows.

## react-markdown

react-markdown passes options to remark-rehype through `remarkRehypeOptions`:

```tsx
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkLtem, { ltemHandlers } from "remark-ltem";

<Markdown remarkPlugins={[remarkGfm, remarkLtem]} remarkRehypeOptions={{ handlers: ltemHandlers }}>
  {text}
</Markdown>
```

Cells get the `colSpan`, `rowSpan` and `align` props. A sanitizer such as rehype-sanitize keeps `colspan` and `rowspan` with its default schema; with a schema of your own, allow them on `th` and `td`.

## MDX

In MDX, `<` starts JSX and `{` starts an expression, also in the text of table cells. With `compile` or `evaluate` of @mdx-js/mdx, pass the plugin and the handlers:

```ts
import { compile } from "@mdx-js/mdx";
import remarkLtem, { ltemHandlers } from "remark-ltem";

await compile(file, { remarkPlugins: [remarkLtem], remarkRehypeOptions: { handlers: ltemHandlers } });
```

The markers `<<` and `^^` and span attributes such as `{c:2}` are read by the table before MDX sees the cell text, so a table that uses them correctly compiles. Everything that stays text is MDX, though:

- A marker that cannot extend a cell (rule V13) stays in the cell as text, and `<<` is then a syntax error in MDX. So is the LTEM escape `\<<`. Write the text `<<` as `&lt;&lt;` or `\<\<`.
- `{` in cell text starts an expression, as `<` starts JSX. The LTEM escape `\{c:2}` works, because MDX accepts `\{`.
- Lines that are no table, for example because a delimiter row does not fit, are a paragraph, where `<<` is a syntax error too.

## Known differences

All 46 examples of the specification render as expected, as whole documents: with remark-ltem alone, with remark-gfm before or after it, and through react-markdown.

remark's own rules show as described for [`micromark-extension-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript/packages/micromark-extension-ltem#known-differences): a table ends where micromark starts a block, and the line after a table is read as a new block.

## Development

See the [workspace README](https://github.com/hugman/ltem/blob/main/ltem-lib/typescript/README.md). The tests render all specification examples as whole documents, alone and with remark-gfm in both orders, through react-markdown and through MDX; compare tables without LTEM notation and the rest of GFM with remark-gfm alone; compare thousands of random documents (with tables in block quotes and list items) with the tables of the core; write the examples with remark-stringify; and feed incomplete documents character by character.
