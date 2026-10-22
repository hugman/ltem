# ltem (TypeScript)

TypeScript implementation of [LTEM](https://hugman.github.io/ltem/): Markdown pipe tables with merged cells and multi-row headers. It follows the LTEM specification, version 1.0, and passes the [conformance cases](https://github.com/hugman/ltem/tree/main/conformance).

Status: version 0.1.1, for LTEM 1.0. The API may change before version 1.0.0.

## Install

```
npm install ltem-core                 # no dependencies
npm install ltem-core markdown-it     # also renders inline Markdown in cells
```

The package is ESM with TypeScript types and no runtime dependencies. It runs on Node.js 20 or later (and in Electron's main process) and in browsers; it needs no DOM. CommonJS code can load it with `require("ltem")` on Node.js 20.19, 22.12 or later, which load ES modules from `require`.

## Use

```ts
import { parseTable, renderHtml, write } from "ltem-core";

const result = parseTable(`\
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |`);

const table = result.table!;   // the table model (see ast/ in the LTEM repository)
JSON.stringify(table);         // the model as JSON, valid against ast/table.schema.json
renderHtml(table);             // <table> with colspan and rowspan
write(table);                  // canonical LTEM
result.problems;               // validation problems, if any
```

`findTables(markdown)` finds every LTEM table in a Markdown document and returns one result per table, with the line range it came from. It is a light scan that skips code blocks. It is not a full Markdown parser; to render whole documents, use a parser plugin such as [`markdown-it-ltem`](https://www.npmjs.com/package/markdown-it-ltem).

### Where cells are

Each parse result has `sources`, one entry per cell in the order of `table.cells`: `{ row, col, rowspan, colspan, line, start, end }`. `line` is a line index in the parsed text (the same lines as `start` and `end` of the result; `findTables` counts document lines, which end at "\n", "\r\n" or "\r"). `start` and `end` index that line in **UTF-16 code units** (JavaScript string indices) and cover the cell's source without the spaces and tabs around it, including any span attribute and escapes. An empty cell has `start == end` at the end of its space between the pipes; a cell added because its row was short (rule V14) has `start == end ==` the length of the line.

```ts
const { text, sources } = writeWithSources(table); // canonical LTEM, and where each cell is in it
```

### From HTML

`fromHtml(html, options?)` converts every top-level `<table>` of an HTML string to a table model and returns `{ table, warnings }` for each; `htmlToLtem(html, options?)` returns canonical LTEM, tables separated by blank lines. The HTML may be a fragment or malformed: the converter reads it as Python's `html.parser` does and builds the grid as browsers do (row groups, `rowspan="0"`, spans cut at their row group, HTML's rules for span values).

```ts
htmlToLtem("<table><tr><th>A</th><th>B</th></tr><tr><td colspan=2>both</td></tr></table>");
// "| A | B |\n| --- | --- |\n| both | << |"
```

| Option | Meaning |
|---|---|
| `headerRows` | Number of header rows. Default: the rows of the first `<thead>`; else the leading rows made only of `<th>` cells; else 1, with a warning. `0`: the table has no header; it gets one header row of empty cells and every HTML row is a body row (spec Section 11). A header cell whose rowspan reaches into the body is cut at the last header row, with a warning; no other cell moves. |
| `inline` | `"markdown"` (default): emphasis, code, links, images, `<sup>` and `<sub>` become inline Markdown. `"plain"`: text only (an image keeps its `alt` text). Either way, text is escaped so that Markdown reads it literally. |

Warnings report what LTEM cannot keep, such as a span cut to avoid an overlap, a nested table flattened to text, or `<th>` cells outside the header rows.

### Cell text

`renderHtml(table, inline?)` renders each line of cell text with `inline`. By default it uses markdown-it with its CommonMark preset if markdown-it is installed and can be loaded with Node's `require`. Otherwise cell text is HTML-escaped and backslash escapes are applied, but emphasis, links and code are shown as written. In a browser, pass your own renderer:

```ts
renderHtml(table, (line) => md.renderInline(line));
```

### Other exports

| Export | Purpose |
|---|---|
| `checkTable(table)` | Violations of the table model rules (empty if valid) |
| `tableFromJSON(value)` | A table from its JSON form, with type checks |
| `ownerGrid(table)`, `isHeader(table, cell)` | The cell that owns each grid position; header test |
| `formatProblem(problem)`, `problemSeverity(problem)` | A problem as one line of text; `"warning"` for V14, `"error"` otherwise |
| `writeWithSources(table)` | Canonical LTEM and the cell sources in it |
| `plainInline`, `defaultInline` | The fallback and the default inline renderers |
| `isDelimiterRow`, `isUpperHeaderRow`, `startsBlock`, `endsTableBody`, `indentation`, `splitRow`, `splitRowSpans` | Line-level helpers for parser plugins |

## Command line

```
ltem parse    [FILE]          # table models as JSON
ltem render   [FILE]          # HTML of each table
ltem validate [FILE] [--json] # validation problems; exit status 1 if there are errors
ltem fmt      [FILE]          # rewrite every table in canonical form
ltem write    [FILE]          # canonical LTEM of table models given as JSON
ltem from-html [FILE] [--header-rows N] [--plain]   # convert HTML tables; warnings on stderr
```

Input is read from FILE, or from standard input if FILE is missing or `-`.

## Third-party data

The package includes two generated tables (`tools/gen-tables.py` in the repository makes them from Python 3.12):

- the HTML named character references, from the [HTML Standard](https://html.spec.whatwg.org/multipage/named-characters.html), (c) WHATWG (Apple, Google, Mozilla, Microsoft), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/);
- Unicode character classes (letters, digits, printable characters) as Python defines them, from the Unicode Character Database 15.0, under the [Unicode License v3](https://www.unicode.org/license.txt).

Their notices are in [`THIRD-PARTY-NOTICES`](https://github.com/hugman/ltem/blob/main/ltem-lib/typescript/packages/ltem/THIRD-PARTY-NOTICES). The rest of the package is under the MIT License ([`LICENSE`](https://github.com/hugman/ltem/blob/main/ltem-lib/typescript/packages/ltem/LICENSE)).

## Development

See the [workspace README](https://github.com/hugman/ltem/blob/main/ltem-lib/typescript/README.md).
