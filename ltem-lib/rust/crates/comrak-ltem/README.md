# comrak-ltem

[comrak](https://crates.io/crates/comrak) adapter for [LTEM](../../../../README.md) tables: Markdown pipe tables with merged cells and multi-row headers.

```
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
```

renders as a table whose "Region" cell spans two rows and whose "Revenue" cell spans two columns.

Status: version 0.1.0, the first release, for LTEM 1.0. Not yet published to crates.io. The API may change before version 1.0.0. The crate is also a prototype for an opt-in LTEM extension in comrak itself; see [Toward an extension in comrak](#toward-an-extension-in-comrak).

## Install

The crate is not on crates.io yet. Depend on it by path or by git, next to comrak 0.56:

```toml
[dependencies]
comrak = { version = "0.56", default-features = false }
comrak-ltem = { path = "path/to/ltem-lib/rust/crates/comrak-ltem" }
```

The crate re-exports the comrak it is built with as `comrak_ltem::comrak`.

## Use

```rust
use comrak::Options;

let mut options = Options::default();
options.extension.strikethrough = true;
let html = comrak_ltem::markdown_to_html(markdown, &options);
```

`parse_document(&arena, markdown, &options)` returns comrak's AST with the LTEM tables in place, for any of comrak's formatters and plugins:

```rust
let arena = comrak::Arena::new();
let root = comrak_ltem::parse_document(&arena, markdown, &options);
let mut html = String::new();
comrak::format_html_with_plugins(root, &options, &mut html, &plugins)?;
```

The table extension is always on: LTEM tables take the place of GFM tables. A GFM table that uses no LTEM notation keeps comrak's own `Table` node and renders exactly as before. Each LTEM table becomes a `Raw` node holding the table's HTML, with the table's source position.

## Behavior

The adapter follows the LTEM specification, version 1.0:

- Header rows are the line directly above the delimiter row and the pipe-led lines above it. A `| # identifier |` line is reserved and stays in the paragraph before the table. A table may begin on any line of a paragraph; a delimiter row whose last header row does not fit stays ordinary text. A delimiter row needs a pipe.
- Body rows end at a line that begins another block (block quote, ATX heading, fenced code, thematic break, list item), at a line indented by four or more columns, and also wherever comrak itself starts another block, such as an HTML block.
- `\\` in a cell is a line break. Each line of a cell is rendered as inlines by comrak with the same options (smart punctuation, autolinks, strikethrough, `unsafe`, `escape` and so on), and the lines are joined with `<br />`.
- The table HTML is laid out like comrak's GFM tables, with `colspan` and `rowspan` when greater than 1, every header row in `<thead>`, no `<tbody>` without body rows, and alignment as `align="..."`. With `render.sourcepos`, the table, its rows and its cells get `data-sourcepos` attributes, counted in bytes or, with `parse.sourcepos_chars`, in characters.
- The table HTML is made when the document is parsed, with the render options given to `parse_document` (`compact_html` leaves out its line feeds, as comrak does).

Cell text sees the document's link reference definitions, though comrak does not expose them: the lines of cell text are put in front of the document, each in a paragraph of its own followed by a separator, and parsed once together with it. So a document with LTEM tables to render is parsed twice.

### Where tables are found

comrak parses the document first, with tables on, so its own rules decide the block structure. A table is made of paragraph lines, so the adapter looks at runs of sibling blocks that comrak made from such lines: paragraphs, GFM tables and setext headings, on consecutive lines. It removes the lines' container prefixes, reads the lines with the LTEM core, and replaces the run's nodes where the LTEM reading differs.

- Tables are found at the top level, in block quotes and alerts (such as `> [!NOTE]`), and in list items and task list items, nested in any way.
- Tables are never found in fenced or indented code blocks, HTML blocks, ATX headings or front matter.
- A lazy continuation line, which continues a paragraph inside a block quote or list item without the container's prefix, is never part of a table.
- Footnote definitions, description lists, multiline block quotes (`>>>`), multiline alerts and block directives are left to comrak: a GFM table in them renders as before, LTEM notation is not read.
- The adapter reads container prefixes with comrak 0.56's rules, tabs included, and checks them against the source positions of the blocks. If they ever disagree, the run is left as comrak renders it.

Text around a table keeps comrak's nodes where it is a whole block, or a part of a paragraph that ends at a line break with no inline markup open. Otherwise it is parsed again, in the document's context and without comrak's table extension: for example the paragraph line before a table when emphasis runs from it into the table, or a line such as `2. two` that ends a table and so starts a list.

## Known differences

All 46 examples of the specification, rendered as whole documents, give the expected HTML after the conformance normalization, with comrak's default options and with GitHub-like ones (strikethrough, autolinks, task lists, footnotes, alerts, `unsafe`).

A GFM table without LTEM notation renders as comrak renders it, except in the cases that the specification lists (Section 1.2), and in these cases where comrak differs from LTEM:

- comrak ends a table at a line that holds only a pipe (`|`); in LTEM that line is a body row of empty cells.
- comrak reads a delimiter row without a pipe, as in `Total` above `:--`, as a one-column table; LTEM does not (specification example 4).

Limitations:

- Footnote references in the cells of an LTEM table stay text (`[^1]`): their numbers would be those of the combined parse, not of the document. In a GFM table without LTEM notation they work as before.
- There is no round trip: `format_commonmark` and `format_xml` write an LTEM table as its HTML.
- Within a task list item, comrak reads `- [ ] | a | b |` above a delimiter row as a GFM table whose first cell is `[ ]`, and the adapter follows comrak there.

## Toward an extension in comrak

This crate works around comrak from the outside. An opt-in `ltem` extension inside comrak (an `extension.ltem` option that implies `table`) would be simpler and complete. What it would need, from what the prototype ran into:

- **Span fields in the AST.** `NodeValue::TableCell` is a unit variant. It needs `colspan` and `rowspan` (for example `TableCell(NodeTableCell { colspan: u32, rowspan: u32 })`, a breaking change of the variant), and covered positions get no cell node. `NodeTable` would keep `alignments` and `num_columns` and could record the number of header rows. comrak keeps the size of `Ast` small on purpose (it asserts 88 bytes); two `u32` fields fit, but the effect on its benchmarks has to be measured, as for earlier AST changes.
- **Several header rows.** comrak builds the header from the one paragraph line above the delimiter row and splits the lines before it off into a paragraph. LTEM also takes the pipe-led lines above it (not a reserved `| # id |` line), lets the last header row fit as a compact row instead of requiring the same number of cells, and tries the paragraph's later delimiter rows when an earlier one does not fit. The HTML formatter writes a `<thead>` for each header row (`TableRow(true)`); it would have to put all header rows in one `<thead>`.
- **Span resolution.** Markers (`<<`, `^^`), span attributes (`{c:N}`, `{r:M}`), grid and compact rows, and the recovery rules for invalid tables (specification Sections 2.5 to 3.6). The LTEM core in this repository (MIT) implements them in a few hundred lines that can be ported; its conformance cases give the expected results.
- **Cell text by line.** `\\` splits a cell into lines before inline parsing, each line is parsed on its own, and the escapes `\<<`, `\^^` and `\{` lose their backslash in the places the specification lists. Inside comrak this means one inline parse per line with `LineBreak` nodes between them. Done inside the parser, cell text also gets the document's link definitions and footnotes directly, which this crate cannot do for footnotes.
- **Where a table ends.** comrak already ends a table at a blank line, an indented line and a line that begins a block. LTEM differs only in reading a line that holds only `|` as a row.
- **Round trip.** `format_commonmark` would write LTEM: the canonical form (specification Section 8) writes covered positions as `^^` or `<<`, puts `\` before text that would read as notation, and writes line breaks as ` \\ `. The core's `write` function shows the rules. `format_xml` would carry the spans as attributes.
- **Tests.** The specification's 46 examples, and the differential tests of this crate against the core (random documents at the top level and in containers, GFM tables without LTEM notation unchanged), can be ported to comrak's test suite.

Done inside comrak's block parser, the container prefixes, lazy lines and tabs that this crate reads again from the source would be handled by comrak itself.

## Development

```
cargo test -p comrak-ltem
cargo clippy -p comrak-ltem --all-targets
```

The tests read the conformance cases from `conformance/cases/spec-examples.json` in the LTEM repository. They render every specification example as a whole document; compare the tables of 3,000 random documents with the LTEM core's, at the top level and inside ten kinds of nested block quotes and list items (two of them with tabs); check that 3,000 random GFM documents without LTEM notation render exactly as comrak renders them; and cover containers, task list items, comrak's options in cell text, reference links, front matter, source positions in bytes and characters, blocks around tables, incomplete input (every prefix of a set of documents) and large inputs.

## License

MIT ([`LICENSE`](LICENSE)). The crate depends on the [`ltem`](../ltem/) core (MIT) and on comrak (BSD-2-Clause), whose own dependencies are under MIT, Apache-2.0 or Zlib, with Unicode data under the Unicode License. A program that includes comrak has to reproduce comrak's copyright notice and license (BSD-2-Clause) with its binary.
