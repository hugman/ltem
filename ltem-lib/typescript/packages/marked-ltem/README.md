# marked-ltem

[marked](https://marked.js.org/) extension for [LTEM](https://hugman.github.io/ltem/) tables: Markdown pipe tables with merged cells and multi-row headers.

```
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
```

renders as a table whose "Region" cell spans two rows and whose "Revenue" cell spans two columns.

Status: version 0.1.0, the first release, for LTEM 1.0. Not yet published to npm. The API may change before version 1.0.0.

## Install

```
npm install marked marked-ltem
```

Works with marked 17 and 18. The package is ESM; CommonJS code can use `require("marked-ltem").default` on Node.js 20.19, 22.12 or later. It needs no DOM, so it also runs in browsers through a bundler.

## Use

```ts
import { marked } from "marked";
import markedLtem from "marked-ltem";

marked.use(markedLtem());
marked.parse(text);
```

or, with an instance of its own:

```ts
import { Marked } from "marked";
import markedLtem from "marked-ltem";

const md = new Marked(markedLtem());
md.parse(text);
```

The extension takes over table recognition from marked, with GFM on (marked's default) or off. A table without LTEM notation renders as before. LTEM tables get `colspan`, `rowspan` and several header rows, following the LTEM specification, version 1.0:

- Header rows are the line directly above the delimiter row and the pipe-led lines above it. A `| # identifier |` line is reserved and stays in the paragraph before the table. A table may begin on any line of a paragraph; a delimiter row whose last header row does not fit stays ordinary text, and so do the lines above it. A line such as `- | -` is a list item, not a delimiter row.
- Body rows end at a blank line, a line indented by four or more spaces, or a line that starts another block (block quote, ATX heading, fenced code, thematic break, list item), and also wherever marked's own rules end a paragraph, such as at the start of an HTML block.
- `\\` in a cell is a line break. Each line is lexed as inlines on its own and the lines are joined with `<br>`.
- Alignment from the delimiter row is written as an `align` attribute, as marked does.

## Tokens

Code that reads marked's tokens instead of its HTML, such as a custom renderer for React or Svelte, gets two kinds of table tokens.

**marked's `table` token.** A table with one header row, no merged cells and no line breaks in cells is an ordinary `table` token (`Tokens.Table`), so such code keeps working for the tables it can draw correctly. Its cell texts are LTEM's (see `text` below), which for a GFM table without LTEM notation are the same as marked's.

**The `ltemTable` token.** Every other table is an `ltemTable` token, which code written for `table` tokens does not know. That is deliberate: a merged table drawn as a plain grid would be silently wrong, while an unknown token is a visible gap. The token is:

| Field | Contents |
|---|---|
| `type` | `"ltemTable"` |
| `raw` | The table's source lines |
| `align` | One entry per column: `"left"`, `"center"`, `"right"` or `null`. Its length is the number of columns. |
| `header` | The header rows, top to bottom. Each row is an array of the cells whose origin (top-left position) is in that row, in column order. |
| `rows` | The body rows, in the same form. A row whose positions are all covered by cells from rows above is an empty array, but still a row (one `<tr>`). |

Each cell is an object with:

| Field | Contents |
|---|---|
| `type` | `"ltemTableCell"` |
| `raw` | The cell's source, without the spaces and tabs around it, including a span attribute and escapes; `""` for a cell added to a short row |
| `text` | The cell text of the LTEM table model (see below) |
| `tokens` | Inline tokens of the cell, lexed by marked's inline lexer, so inline extensions and reference links apply. The lines of a cell are lexed one by one and separated by `br` tokens. |
| `header` | `true` for a header cell (its origin is in a header row) |
| `align` | The alignment of the cell's origin column |
| `row`, `col` | The grid position of the cell's origin, counting header rows and body rows together from 0 |
| `rowspan`, `colspan` | The number of rows and columns the cell spans (1 or more) |

The cell text is what LTEM hands to marked's inline lexer: the cell's lines, each trimmed of spaces and tabs, joined by `"\n"`, without the span attribute, with each escaped pipe read as a pipe, and with the backslash of the LTEM escapes `\<<`, `\^^` and `\{c:2}` removed. Other backslash escapes and inline Markdown are kept as written.

The HTML is that of marked's table renderer with `colspan` and `rowspan` attributes, and no `<tbody>` when the table has no body rows. A renderer for another output walks the same structure:

```ts
function renderLtemTable(token: LtemTableToken, inline: (tokens: Token[]) => string): string {
  const row = (cells: LtemTableCell[]) => "<tr>" + cells.map((cell) => {
    const tag = cell.header ? "th" : "td";
    const attrs = (cell.colspan > 1 ? ` colspan="${cell.colspan}"` : "")
      + (cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : "");
    return `<${tag}${attrs}>${inline(cell.tokens)}</${tag}>`;
  }).join("") + "</tr>";
  return "<table><thead>" + token.header.map(row).join("") + "</thead>"
    + (token.rows.length ? "<tbody>" + token.rows.map(row).join("") + "</tbody>" : "") + "</table>";
}
```

`walkTokens` visits the `ltemTable` token, its cells and their inline tokens. Another extension can replace the HTML of LTEM tables with a renderer named `ltemTable`; when that renderer returns `false`, this one is used. The types `LtemTableToken`, `LtemTableCell` and `MarkedLtemOptions` are exported.

marked has no source positions, so the tokens carry none beyond `raw`.

### Options

```ts
marked.use(markedLtem({ nativeTables: false }));
```

| Option | Default | Meaning |
|---|---|---|
| `nativeTables` | `true` | Emit marked's `table` token for tables that need no LTEM feature. With `false`, every table is an `ltemTable` token, for code that handles one kind of table only. |

## Known differences

All 46 examples of the specification render as expected, as whole documents, with marked 17 and 18 and with GFM on and off.

Where LTEM differs from GFM (specification Section 1.2), tables without LTEM notation can differ from what marked's own table rule makes of them:

- A line such as `- | -` is a list item, not a delimiter row.
- Only the backslash directly before a pipe escapes it: `\\|` is a backslash followed by an escaped pipe. marked counts the backslashes before a pipe.
- Only spaces and tabs are trimmed from cells. marked also trims other whitespace, such as an ideographic space (U+3000) or a no-break space.
- Any line that begins a list item ends the table body, such as `2. x` or a lone `-`. marked continues the table there.
- A last header row may have more cells than the delimiter row if the extra cells are empty; marked makes such lines a paragraph.
- `\\` in a cell is a line break.

marked's own behavior outside tables shows in a few places:

- In GFM mode, marked's paragraph rule ends a paragraph before two lines that look like a GFM header and delimiter row, even when they are no table. The extension joins the paragraph back, so that lines that are no table stay in their paragraph, as LTEM requires. Without the extension, marked splits such a paragraph in two.
- Where marked ends a paragraph, such as at an HTML block, it also ends a table. Which HTML starts a block differs between marked versions (marked 17 does not end a paragraph at `<?` or `<!DOCTYPE`).
- marked trims Unicode whitespace at the end of a list item, so a last table row in a list item that ends in an ideographic space or a no-break space loses it.
- marked 17 expands tabs in list items, which shows in the `raw` of cells there.

## Development

See the [workspace README](https://github.com/hugman/ltem/blob/main/ltem-lib/typescript/README.md). The tests render all specification examples as whole documents with marked 17 and 18, compare tables without LTEM notation with marked's own, compare thousands of random documents (with tables in block quotes and list items) with the tables of the core, and feed incomplete documents character by character.
