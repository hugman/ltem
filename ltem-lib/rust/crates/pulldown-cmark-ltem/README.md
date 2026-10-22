# pulldown-cmark-ltem

[pulldown-cmark](https://crates.io/crates/pulldown-cmark) adapter for [LTEM](https://hugman.github.io/ltem/) tables: Markdown pipe tables with merged cells and multi-row headers.

```
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
```

renders as a table whose "Region" cell spans two rows and whose "Revenue" cell spans two columns.

Status: version 0.1.0, the first release, for LTEM 1.0. Not yet published to crates.io. The API may change before version 1.0.0.

## Install

The crate is not on crates.io yet. Depend on it by path or by git, next to pulldown-cmark 0.13:

```toml
[dependencies]
pulldown-cmark = { version = "0.13", default-features = false, features = ["html"] }
pulldown-cmark-ltem = { path = "path/to/ltem-lib/rust/crates/pulldown-cmark-ltem" }
```

The crate re-exports the pulldown-cmark it is built with as `pulldown_cmark_ltem::pulldown_cmark`.

## Use

`Parser` takes the place of `pulldown_cmark::Parser`:

```rust
use pulldown_cmark::{html, Options};

let parser = pulldown_cmark_ltem::Parser::new_ext(markdown, Options::ENABLE_FOOTNOTES);
let mut out = String::new();
html::push_html(&mut out, parser);
```

or, in one call, `pulldown_cmark_ltem::push_html(&mut out, markdown, options)`.

The events are pulldown-cmark's own, with each LTEM table in place of the events of its lines. A table is one HTML block, as if the document held the table's HTML: `Start(Tag::HtmlBlock)`, `Html(table)`, `End(TagEnd::HtmlBlock)`. Consumers of pulldown-cmark events handle it as they handle any HTML block, so event filters, syntax highlighters and renderers such as mdBook's keep working. `into_offset_iter()` gives each event its byte range in the source, like pulldown-cmark's; the events of an LTEM table carry the table's range.

`ENABLE_TABLES` is always on: LTEM tables take the place of GFM tables. A GFM table that uses no LTEM notation keeps pulldown-cmark's own table events and renders exactly as before.

`find_tables(markdown, options)` returns the LTEM tables of a document, in document order, for tools that need more than HTML. Each `TableBlock` has the table model (`ltem::Table`), its validation problems, its line range and byte range, the byte range of each cell's source, the rendered HTML, and `native`, which is true when pulldown-cmark renders the table the same way on its own.

## Behavior

The adapter follows the LTEM specification, version 1.0:

- Header rows are the line directly above the delimiter row and the pipe-led lines above it. A `| # identifier |` line is reserved and stays in the paragraph before the table. A table may begin on any line of a paragraph; a delimiter row whose last header row does not fit stays ordinary text. A line such as `- | -` is a list item, not a delimiter row.
- Body rows end at a line that begins another block (block quote, ATX heading, fenced code, thematic break, list item), at a line indented by four or more columns, and also wherever pulldown-cmark itself starts another block, such as an HTML block or a footnote definition.
- `\\` in a cell is a line break. Each line of a cell is rendered on its own as inlines by pulldown-cmark, with the parser's options (smart punctuation, strikethrough, math and so on) and the document's link reference definitions, and the lines are joined with `<br />`.
- The table HTML is laid out like pulldown-cmark's GFM tables, with `colspan` and `rowspan` when greater than 1, every header row in `<thead>`, no `<tbody>` without body rows, and alignment as `style="text-align: ..."`.

### Where tables are found

pulldown-cmark parses the document first, with GFM tables on, so its own rules decide the block structure. A table is made of paragraph lines, so the adapter looks at runs of sibling blocks that pulldown-cmark made from such lines: paragraphs (also the untagged paragraphs of tight lists), GFM tables and setext headings, on consecutive lines. It removes the lines' container prefixes, reads the lines with the LTEM core, and replaces the run's events where the LTEM reading differs.

- Tables are found at the top level, in block quotes (also GitHub-style alerts such as `> [!NOTE]`), and in list items (tight or loose, bullet or ordered, with or without a task checkbox), nested in any way.
- Tables are never found in fenced or indented code blocks, HTML blocks, ATX headings or metadata blocks.
- A lazy continuation line, which continues a paragraph inside a block quote or list item without the container's prefix, is never part of a table.
- Footnote definitions and definition lists are left to pulldown-cmark: a GFM table in them renders as before, LTEM notation is not read.
- The adapter reads container prefixes with pulldown-cmark 0.13's rules, tabs included, and checks them against where pulldown-cmark says each block starts. If they ever disagree, the run is left as pulldown-cmark renders it.

Text around a table keeps pulldown-cmark's events where it is a whole block, or a part of a paragraph that ends at a line break with no inline markup open. Otherwise it is parsed again on its own with the same options and the document's link definitions: for example the paragraph line before a table when emphasis runs from it into the table, or a line such as `2. two` that ends a table and so starts a list.

## Known differences

Against the specification's examples, rendered as whole documents with `Options::empty()`: 44 of the 46 examples give the expected HTML after the conformance normalization. In the other two (examples 11 and 12), the table is a GFM table without LTEM notation and without body rows, which the adapter leaves to pulldown-cmark, and pulldown-cmark writes an empty `<tbody>`.

A GFM table without LTEM notation renders as pulldown-cmark renders it, except in the cases that the specification lists (Section 1.2), and in these cases where pulldown-cmark differs from GFM:

- pulldown-cmark reads `- | -` below a paragraph line as a delimiter row; LTEM, like GFM, reads it as a list item.
- pulldown-cmark continues a table over a line indented by four or more columns; LTEM ends the table there, and the line becomes an indented code block.
- pulldown-cmark ends a table at a line that holds only a pipe (`|`); in LTEM that line is a body row of empty cells.
- pulldown-cmark accepts delimiter cells such as `-:-` and rejects tabs in a delimiter row; LTEM accepts only `:?-+:?` and allows tabs around cells, as GFM does.

Limitations:

- Footnote references in the cells of an LTEM table stay text (`[^1]`), because cell text is rendered without the document's footnote definitions. In a GFM table without LTEM notation they work as before.
- The whole document is parsed before the first event, since a table can only be recognized by looking ahead.
- A broken-link callback cannot be passed; reference links in cells see the document's link reference definitions only.
- A task list item whose text starts with an LTEM table keeps its checkbox before the table (pulldown-cmark drops it for a GFM table in that place).

## Development

```
cargo test -p pulldown-cmark-ltem
cargo clippy -p pulldown-cmark-ltem --all-targets
```

The tests read the conformance cases from `conformance/cases/spec-examples.json` in the LTEM repository. They render every specification example as a whole document; compare the tables of 3,000 random documents with the LTEM core's, at the top level and inside ten kinds of nested block quotes and list items (two of them with tabs); check that 3,000 random GFM documents without LTEM notation render exactly as pulldown-cmark renders them; and cover containers, inline markup, escapes, alignment, blocks around tables, incomplete input (every prefix of a set of documents) and large inputs.

## License

MIT ([`LICENSE`](https://github.com/hugman/ltem/blob/main/ltem-lib/rust/crates/pulldown-cmark-ltem/LICENSE)). The crate depends on the [`ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/rust/crates/ltem) core (MIT) and on pulldown-cmark (MIT), whose own dependencies are under MIT, Apache-2.0 or the Unlicense.
