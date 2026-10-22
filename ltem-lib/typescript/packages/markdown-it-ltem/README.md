# markdown-it-ltem

[markdown-it](https://github.com/markdown-it/markdown-it) plugin for [LTEM](https://hugman.github.io/ltem/) tables: Markdown pipe tables with merged cells and multi-row headers.

```
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
```

renders as a table whose "Region" cell spans two rows and whose "Revenue" cell spans two columns.

Status: version 0.1.1, for LTEM 1.0. The API may change before version 1.0.0.

## Install

```
npm install markdown-it markdown-it-ltem
```

Works with markdown-it 14 and 15. The package is ESM; CommonJS code can use `require("markdown-it-ltem").default` on Node.js 20.19, 22.12 or later.

## Use

```ts
import markdownit from "markdown-it";
import ltem from "markdown-it-ltem";

const md = markdownit().use(ltem);
md.render(text);
```

The plugin replaces markdown-it's GFM table rule and enables it, also in presets that have no table rule (such as `commonmark` and `zero`). A table without LTEM notation renders as before. LTEM tables get `colspan`, `rowspan` and several header rows, following the LTEM specification, version 1.0:

- Header rows are the line directly above the delimiter row and the pipe-led lines above it. A `| # identifier |` line is reserved and stays in the paragraph before the table. A table may begin on any line of a paragraph; a delimiter row whose last header row does not fit stays ordinary text. A line such as `- | -` is a list item, not a delimiter row, as in GFM.
- Body rows end at a blank line, a line indented by four or more spaces, or a line that starts another block (block quote, ATX heading, fenced code, thematic break, list item), and also wherever markdown-it's own rules start a block, such as an HTML block.
- `\\` in a cell is a line break. Each line is parsed as inlines on its own and the lines are joined with hard breaks (`<br>`).
- Alignment from the delimiter row is written as `style="text-align:..."`, as markdown-it does.

The token stream is the one markdown-it's table rule produces: `table_open`, `thead_open`, `tr_open`, `th_open` or `td_open` (with `colspan` and `rowspan` attributes when greater than 1), one `inline` token per cell, and the matching close tokens. There is no `tbody` when the table has no body rows.

Each `th_open` and `td_open` token has `map = [line, line + 1]` (the document line of the cell's origin) and `meta.ltem = { row, col, rowspan, colspan, line, start, end }`: the cell's grid position and where its source is. `start` and `end` are UTF-16 offsets (JavaScript string indices) in that document line, counted from the line's first character, so a container prefix such as `> ` shifts them; they cover the cell's source without the spaces and tabs around it, including any span attribute and escapes. Editors can use them to map a rendered cell back to the text.

## Development

See the [workspace README](https://github.com/hugman/ltem/blob/main/ltem-lib/typescript/README.md). The tests render all specification examples as whole documents with markdown-it 14 and 15.
