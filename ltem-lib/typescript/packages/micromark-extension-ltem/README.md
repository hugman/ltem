# micromark-extension-ltem

[micromark](https://github.com/micromark/micromark) extensions for [LTEM](../../../../README.md) tables: Markdown pipe tables with merged cells and multi-row headers.

```
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
```

renders as a table whose "Region" cell spans two rows and whose "Revenue" cell spans two columns.

This package holds the syntax extension and an HTML extension for micromark. For a syntax tree, use it with [`mdast-util-ltem`](../mdast-util-ltem/); with remark, use [`remark-ltem`](../remark-ltem/), which wires both up.

Status: version 0.1.0, the first release, for LTEM 1.0. Not yet published to npm. The API may change before version 1.0.0.

## Install

```
npm install micromark micromark-extension-ltem
```

Works with micromark 4. The package is ESM; CommonJS code can use `require("micromark-extension-ltem")` on Node.js 20.19, 22.12 or later.

## Use

```ts
import { micromark } from "micromark";
import { ltem, ltemHtml } from "micromark-extension-ltem";

micromark(text, { extensions: [ltem()], htmlExtensions: [ltemHtml()] });
```

With GFM:

```ts
import { gfm, gfmHtml } from "micromark-extension-gfm";

micromark(text, { extensions: [gfm(), ltem()], htmlExtensions: [gfmHtml(), ltemHtml()] });
```

`ltem()` replaces the GFM table construct: it turns off the construct named `table` (the one of micromark-extension-gfm-table), in any order of extensions, and adds a table construct of its own, named `ltemTable`. A table without LTEM notation reads as before. LTEM tables get `colspan`, `rowspan` and several header rows, following the LTEM specification, version 1.0:

- Header rows are the line directly above the delimiter row and the pipe-led lines above it. A `| # identifier |` line is reserved and stays in the paragraph before the table. A table may begin on any line of a paragraph; a delimiter row whose last header row does not fit stays ordinary text. A line such as `- | -` is a list item, not a delimiter row. A last header row that starts with `<` is still a header row, even where micromark would start an HTML block.
- Body rows end at a blank line, a line indented by four or more spaces, or a line that starts another block (block quote, ATX heading, fenced code, thematic break, list item), and also wherever micromark's own constructs start a block, such as an HTML block or a math block of another extension. A lazy line (one that does not continue the block quote or list item of the table) is never part of the table.
- `\\` in a cell is a line break. Each line is parsed as inlines on its own; `ltemHtml()` joins the lines with `<br />`.
- The backslash that escapes a pipe is removed before inline parsing, as the specification says, so `a \\| b` holds the cell text `a \| b`, an escaped pipe. In code spans it is removed too: `` `x \| y` `` is the code `x | y`.
- `ltemHtml()` writes all header rows in `<thead>`, alignment as an `align` attribute (as micromark's GFM HTML does), and no `<tbody>` when the table has no body rows.

## Tokens

For code that reads micromark's events, a table is:

| Token | Contents |
|---|---|
| `ltemTable` | The whole table. `token._ltemTable` is `{ align, headerRows }`: one alignment per column (`"left"`, `"center"`, `"right"` or `null`) and the number of header rows. |
| `ltemTableHead` | The header rows and the delimiter row |
| `ltemTableBody` | The body rows, if any |
| `ltemTableRow` | A row, header rows first. `token._ltemPadding` lists the empty cells added at the end of a short row (rule V14), which have no source, in the form of `_ltemCell`. |
| `ltemTableDelimiterRow` | The delimiter row, in the head after the header rows |
| `ltemTableCell` | A cell, in the row of its origin, in column order. `token._ltemCell` is `{ row, col, rowspan, colspan, header, align }`: the grid position of the cell's origin (header and body rows counted together from 0), its spans, whether it is a header cell, and the alignment of its column. The token covers the cell's source without the spaces and tabs around it, including a span attribute; an empty cell is an empty token at the end of its space between the pipes. |
| `ltemTableLineBreak` | A `\\` line break in a cell |

The text of each line of a cell is a `chunkText` token, which micromark parses as inlines. Positions covered by merged cells, markers and placeholders have no tokens. The types `LtemTableInfo` and `LtemCellInfo` are exported, and the token types are registered in micromark-util-types.

## Known differences

All 46 examples of the specification render as expected, as whole documents, with and without micromark-extension-gfm.

Where LTEM differs from GFM (specification Section 1.2), tables without LTEM notation can differ from what micromark-extension-gfm-table makes of them, for example `- | -` below a line, `\\|` in a cell, or `\\` in a cell.

micromark's own rules show in a few places:

- A table ends where micromark starts a block (see above), and the line after a table is read as a new block: `2. x` below a table starts a list.
- In `ltemHtml()` output, an escaped pipe in raw HTML or in an autolink of a cell keeps its backslash, and so does one in math of another extension; mdast-util-ltem removes it from the syntax tree.

## Development

See the [workspace README](../../README.md). The tests render all specification examples as whole documents, compare tables without LTEM notation with micromark-extension-gfm, compare thousands of random documents (with tables in block quotes and list items) with the tables of the core, feed incomplete documents character by character, and run micromark's development build, which checks the events.
