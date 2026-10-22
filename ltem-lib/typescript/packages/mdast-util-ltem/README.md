# mdast-util-ltem

[mdast](https://github.com/syntax-tree/mdast) utilities for [LTEM](../../../../README.md) tables: Markdown pipe tables with merged cells and multi-row headers. They turn LTEM tables into mdast `table` nodes, write them back as Markdown, and turn them into HTML through hast.

```
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
```

becomes a table whose "Region" cell spans two rows and whose "Revenue" cell spans two columns.

Use it with the syntax extension of [`micromark-extension-ltem`](../micromark-extension-ltem/). With remark, use [`remark-ltem`](../remark-ltem/), which wires both up.

Status: version 0.1.0, the first release, for LTEM 1.0. Not yet published to npm. The API may change before version 1.0.0.

## Install

```
npm install mdast-util-ltem micromark-extension-ltem
```

Works with mdast-util-from-markdown 2, mdast-util-to-markdown 2 and mdast-util-to-hast 13. The package is ESM; CommonJS code can use `require("mdast-util-ltem")` on Node.js 20.19, 22.12 or later.

## Use

```ts
import { toHtml } from "hast-util-to-html";
import { fromMarkdown } from "mdast-util-from-markdown";
import { ltemFromMarkdown, ltemHandlers, ltemToMarkdown } from "mdast-util-ltem";
import { toHast } from "mdast-util-to-hast";
import { toMarkdown } from "mdast-util-to-markdown";
import { ltem } from "micromark-extension-ltem";

const tree = fromMarkdown(text, { extensions: [ltem()], mdastExtensions: [ltemFromMarkdown()] });
toHtml(toHast(tree, { handlers: ltemHandlers }));         // HTML
toMarkdown(tree, { extensions: [ltemToMarkdown()] });     // Markdown
```

| Export | Purpose |
|---|---|
| `ltemFromMarkdown()` | Extension for mdast-util-from-markdown |
| `ltemToMarkdown()` | Extension for mdast-util-to-markdown |
| `ltemHandlers` | Handlers for mdast-util-to-hast (and remark-rehype): `{ table: ltemTableHandler }` |
| `ltemTableHandler` | The `table` handler on its own |

## Syntax tree

An LTEM table is an ordinary mdast `table` node with `tableRow` and `tableCell` children, and these fields:

| Node | Field | Contents |
|---|---|---|
| `table` | `align` | One alignment per column (`"left"`, `"center"`, `"right"` or `null`); its length is the number of columns |
| `table` | `headerRows` | The number of header rows: the first `headerRows` children are header rows, the rest body rows |
| `tableRow` | `children` | The cells whose origin (top-left position) is in this row, in column order. A row whose positions are all covered by cells from rows above has no children. |
| `tableCell` | `row`, `col` | The grid position of the cell's origin, counting header rows and body rows together from 0 |
| `tableCell` | `rowspan`, `colspan` | The number of rows and columns the cell spans (1 or more) |

A cell's children are phrasing content, parsed by micromark with every syntax extension in use. A `\\` line break in a cell is a `break` node, and each line is parsed on its own. Positions covered by merged cells, markers and placeholders have no nodes.

Positions follow the source: a table and its rows cover their lines; a cell covers its source without the spaces and tabs around it, including a span attribute; an empty cell is an empty range at the end of its space between the pipes, and an empty cell added at the end of a short row (rule V14) is an empty range at the end of the row. Inline nodes have their exact positions.

The fields are declared on the mdast types (`Table`, `TableCell`) by this package. They are optional there, because tables made by other tools, such as mdast-util-gfm, do not have them; a table without them has one header row and cells of one row and one column.

## To hast

`ltemHandlers` must be passed to mdast-util-to-hast, or to remark-rehype as its `handlers` option, because mdast-util-to-hast's own `table` handler puts only the first row in `<thead>` and fills every row up to the number of columns. With the handlers, all header rows go into `<thead>` with `<th>` cells, cells get `colSpan` and `rowSpan` above 1 and the `align` of their origin column, and there is no `<tbody>` when the table has no body rows. A table without LTEM fields comes out as with mdast-util-to-hast's own handler.

The handler lays the cells out as HTML does, so it also accepts tables built or changed by other code: each cell takes the next free column, spans are cut where they would leave the table, overlap another cell or (for header cells) reach into the body, and positions that no cell covers get empty cells. Without `align`, the table is as wide as its cells need. Data such as `data.hProperties` on rows and cells applies as usual.

Without the handlers, remark-rehype still shows the cell text in rows and columns, as a renderer without LTEM support does, but without merged cells and with only the first row as header.

## To Markdown

`ltemToMarkdown()` writes every `table` node in LTEM's canonical form, with the core's writer: one grid row per row, `^^` and `<<` for merged positions, all header rows above the delimiter row, ` \\ ` between the lines of a cell, and the escapes the specification asks for (`\|`, `\<<`, `\^^`, `\{c:2}`, and `\-` and `\#` in header rows that would read as something else). Tables are laid out as for hast, so any table node becomes a valid LTEM table. It also escapes paragraph lines that would read as a delimiter row, so that a paragraph stays a paragraph.

LTEM 1.0 cell text cannot hold two backslashes in a row, which it reads as a line break (specification Appendix B). An escaped backslash in text is written `&#92;`, and code, math or raw HTML that holds two backslashes in a row is written as text. A `break` node inside other phrasing, such as emphasis, becomes a space, because a line break of LTEM splits the whole cell. As in GFM, spaces at the start and end of a cell's lines are not kept.

When mdast-util-gfm's extension comes after this one, its `table` handler wins and writes LTEM tables as GFM tables, which loses merged cells and header rows. Put `ltemToMarkdown()` after `gfmToMarkdown()`.

## Known differences

All 46 examples of the specification render as expected, as whole documents, with and without mdast-util-gfm, and survive a round trip through Markdown.

micromark's own rules show as described for [`micromark-extension-ltem`](../micromark-extension-ltem/#known-differences). Escaped pipes in code, math, raw HTML and autolinks of cells lose their backslash in the syntax tree, as the specification asks.

## Development

See the [workspace README](../../README.md). The tests render all specification examples as whole documents, check the table structure and cell positions against the core on random documents, compare thousands of random documents with the tables of the core, turn changed and invalid trees into HTML and Markdown, and write the specification examples and random documents to Markdown and read them back.
