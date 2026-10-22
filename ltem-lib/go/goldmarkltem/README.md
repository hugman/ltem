# goldmarkltem

[goldmark](https://github.com/yuin/goldmark) extensions for [LTEM](../../../README.md) tables: Markdown pipe tables with merged cells and multi-row headers, as defined by the [LTEM specification](../../../spec/ltem-spec.md), version 1.0.

```
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
```

renders as a table whose "Region" cell spans two rows and whose "Revenue" cell spans two columns.

| goldmark | Package |
|---|---|
| v1 (1.8) | `github.com/hugman/ltem/ltem-lib/go/goldmarkltem` |
| v2 (2.1) | `github.com/hugman/ltem/ltem-lib/go/goldmarkltem/v2` |

Status: version 0.1.0, the first release, for LTEM 1.0. Not yet published. The API may change before version 1.0.0. Both packages pass the same tests. goldmark's own README says that v2 is in the early stages of release.

## Install

```
go get github.com/hugman/ltem/ltem-lib/go
```

## Use

goldmark v1:

```go
import (
	"github.com/yuin/goldmark"
	"github.com/hugman/ltem/ltem-lib/go/goldmarkltem"
)

md := goldmark.New(goldmark.WithExtensions(goldmarkltem.Extension))
var buf bytes.Buffer
err := md.Convert(source, &buf)
```

goldmark v2:

```go
import (
	"github.com/yuin/goldmark/v2/parser"
	"github.com/yuin/goldmark/v2/renderer/html"
	goldmarkltem "github.com/hugman/ltem/ltem-lib/go/goldmarkltem/v2"
)

p := parser.New(parser.WithExtensions(goldmarkltem.Parser))
r := html.New(html.WithExtensions(goldmarkltem.HTMLRenderer))
var buf bytes.Buffer
err := r.Render(&buf, source, p.Parse(source))
```

The extension takes the place of goldmark's table extension (`extension.Table` in v1, `extension.TableParser` and `extension.TableHTMLRenderer` in v2). Use one or the other: with both, LTEM tables still render, but goldmark's table extension also turns some paragraphs into tables that LTEM leaves as text (see [Differences from goldmark's table extension](#differences-from-goldmarks-table-extension)). For GitHub Flavored Markdown, use `goldmarkltem.GFM` (v1) or `GFMParser` and `GFMHTMLRenderer` (v2): goldmark's GFM extensions (linkify, strikethrough, task lists) with LTEM tables.

Options:

- v1: `goldmarkltem.New(opts...)` takes the options of goldmark's table extension (`extension.TableOption`), such as `extension.WithTableCellAlignMethod(extension.TableCellAlignAttribute)`.
- v2: `goldmarkltem.NewHTMLRenderer(goldmarkltem.WithTableCellAlignMethod(extension.TableCellAlignAttribute))`.

As in goldmark, alignment is written as `style="text-align:..."` in HTML5 and as `align="..."` in XHTML, unless an option says otherwise.

To render the cell text of a table model from the core package as CommonMark inlines, the v1 package has `goldmarkltem.CommonMarkInline`:

```go
html := ltem.RenderHTML(table, goldmarkltem.CommonMarkInline)
```

## What it does

A table begins when a line with the form of a delimiter row continues a paragraph whose last lines are header rows that fit (spec 2.3): a block parser takes those lines out of the paragraph. Body rows follow until a line ends the table: a blank line, a line indented by four or more columns, or a line that begins a block quote, ATX heading, fenced code block, thematic break or list item (spec 2.4). The table also ends where goldmark would start an HTML block that interrupts a paragraph, as a goldmark table does. What follows is parsed by goldmark as usual, so `2. x` after a table starts an ordered list and an indented line starts a code block.

The text of each cell is parsed as goldmark inlines, so emphasis, code, links, reference links defined anywhere in the document, footnotes and the inline extensions of goldmark and third parties work in cells. A cell with `\\` line breaks is parsed line by line (emphasis does not run across a line break), and the lines are joined with hard line breaks (`<br>`).

## The AST

A table with one header row and no merged cells is built from the nodes of goldmark's table extension, exactly as that extension builds it (`extension/ast` `Table`, `TableHeader`, `TableRow` and `TableCell`; and `TableBody` in v2), and goldmark's own table renderer renders it. Code that handles goldmark tables, such as table render hooks, keeps working for these tables.

Other tables are built from this package's nodes, so that code written for goldmark's single-row header does not render them wrongly:

| Node | Kind | Contents |
|---|---|---|
| `Table` | `KindTable` | `Alignments` (goldmark's `extension/ast.Alignment`, one per column); children `TableHead` and, if there are body rows, `TableBody` |
| `TableHead` | `KindTableHead` | the header rows (`<thead>`) |
| `TableBody` | `KindTableBody` | the body rows (`<tbody>`) |
| `TableRow` | `KindTableRow` | the cells whose origin is in the row; a row whose positions are all covered has none |
| `TableCell` | `KindTableCell` | `Row`, `Col`, `Rowspan`, `Colspan`, `Alignment`, `Header`; children are the cell's inlines |

`TableHTMLRenderer` renders these nodes in goldmark's style, with `colspan` and `rowspan` attributes and the attributes that goldmark's table renderer allows. Every node's `Pos()` is its offset in the source; a cell's is the start of its source.

## Specification examples

All 46 examples of the specification render as whole documents through goldmark (its CommonMark settings, raw HTML kept, and this extension) to the expected HTML, after the normalization of the conformance tests, with goldmark v1 and v2, in HTML5 and XHTML. goldmark's handling of the rest of each document does not change any example.

## Differences from goldmark's table extension

A table without LTEM notation renders exactly as with goldmark's table extension, byte for byte, with every alignment option, in the tests' random documents. The exceptions are inputs where the LTEM specification has its own rule, or where goldmark's table extension deviates from GFM:

| Input | goldmark's table extension | This extension |
|---|---|---|
| A pipe-led line directly above the header row | paragraph | a second header row (spec 2.3) |
| A header row with more cells than the delimiter row, the extra ones empty | paragraph | table (spec 2.3) |
| A header row with fewer cells than the delimiter row | table, the header padded | paragraph, as in GFM (spec 2.3) |
| A delimiter row without a pipe, such as `:--` | table | paragraph, as in GFM (spec 2.2) |
| A delimiter row whose header row does not fit, followed by a later one that does | no table | a table at the later one (spec 2.3) |
| An escaped pipe (a backslash and a pipe) at the end of a row | the pipe ends the row, the backslash stays in the cell | a pipe in the cell (spec 2.1) |
| A body row that has too few cells, in a column with alignment | the added cell has no alignment (v1 only) | the added cell has its column's alignment (spec Section 6) |
| A body line of `=` or of `--` | the table ends, the line is a paragraph | a body row (spec 2.4) |
| A body line indented by four or more columns, or one such as `2. x` that begins a block but cannot interrupt a paragraph | a body row | ends the table (spec 2.4) |
| A lazy continuation line after a table in a block quote or list item | a body row | not part of the table, as in GFM; it is a paragraph line after the container |
| A delimiter row that is a lazy continuation line | may begin a table | does not begin a table |
| A link reference definition, such as `[r]: /u`, directly above a delimiter row | a definition | a header row |
| LTEM notation: `<<`, `^^`, `{c:N}`, `{r:M}`, `\\`, `\<<`, `\^^`, `\{` | text | spans, line breaks and escapes |

## Known limitations

These follow goldmark's table extension, because goldmark parses cell text from the document source:

- The inline parser sees a cell's source as written. `\|`, `\<<`, `\^^` and `\{c:2}` reach it as CommonMark backslash escapes, which render the characters they escape. In code spans the backslash of `\|` is removed, as goldmark's table extension does. In autolinks, raw HTML, and inline extensions that do not apply backslash escapes (math, for example), the backslash of `\|` stays, where the specification removes it before inline parsing.
- `\\|` (a backslash, then an escaped pipe) renders as `\|`; the specification's cell text is `\|`, which CommonMark renders as `|`.
- Inside a list item, a table that follows a blank line does not make the list loose.

Block parsers of other extensions that interrupt paragraphs, other than goldmark's HTML block parser, do not end a table body.

## Development

See the [workspace README](../README.md#development). The tests render the specification examples, compare random documents with the core and tables without LTEM notation with goldmark's table extension, cover containers, inlines, escapes, alignment, several tables, the AST and incomplete input (every prefix of some documents, as a table arrives line by line), and fuzz the extension. The cases shared by the v1 and v2 tests are in `internal/gmtest`.
