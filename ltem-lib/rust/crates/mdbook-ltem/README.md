# mdbook-ltem

[mdBook](https://rust-lang.github.io/mdBook/) preprocessor for [LTEM](https://hugman.github.io/ltem/) tables: Markdown pipe tables with merged cells and multi-row headers.

```
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
```

renders in the book as a table whose "Region" cell spans two rows and whose "Revenue" cell spans two columns. GFM tables without LTEM notation are left to mdBook and look as before.

Status: version 0.1.0, the first release, for LTEM 1.0. Not yet published to crates.io. Tested with mdBook 0.5.4; the input of mdBook 0.4 is read as well.

## Install

```
cargo install --path ltem-lib/rust/crates/mdbook-ltem
```

This puts the `mdbook-ltem` command where Cargo installs programs, which must be on the `PATH` when mdBook runs. Alternatively, set `command` in `book.toml` to the program's path.

## Use

Add the preprocessor to `book.toml`:

```toml
[preprocessor.ltem]
after = ["links"]
```

`after = ["links"]` runs it after mdBook's `links` preprocessor, so that tables in files brought in with `{{#include}}` are processed too.

mdBook runs it for the HTML renderer (`mdbook-ltem supports html` succeeds). Other renderers keep the LTEM text, which renderers without LTEM support show as GFM tables; to turn the tables into HTML for them too, list them, for example `renderers = ["html", "epub"]`.

Validation errors (LTEM specification, Section 5) are reported on standard error, which mdBook shows, for example:

```
mdbook-ltem: warning: chapter_1.md:12: V13 at (1,0): '<<' has no cell to extend
```

The table is still rendered, as the specification says. Rows padded or cut as in GFM (rule V14, a warning) are not reported. To turn the messages off:

```toml
[preprocessor.ltem]
after = ["links"]
warnings = false
```

## How it works

mdBook hands a preprocessor the book as JSON (`[context, book]` on standard input) and takes the book back on standard output. `mdbook-ltem` reads that protocol with serde_json. It does not depend on the `mdbook` or `mdbook-preprocessor` crates, which are MPL-2.0 and bring in many dependencies; walking the JSON also lets it read the books of mdBook 0.5 (`items`) and 0.4 (`sections`) alike, and it changes nothing but the chapters' Markdown.

For each chapter:

1. It finds the LTEM tables with [`pulldown-cmark-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/rust/crates/pulldown-cmark-ltem), using the pulldown-cmark options of mdBook's HTML renderer, which it takes from `[output.html]` in the context: `smart-punctuation`, `definition-lists` and `admonitions` (on by default in mdBook 0.5; in 0.4 only smart punctuation existed, off by default, turned on by `smart-punctuation` or `curly-quotes`). So the block structure is the one mdBook sees: tables are found in paragraphs, block quotes and list items, never in code blocks or HTML blocks. See that crate's README for the details and its known differences.
2. It replaces the lines of each LTEM table that mdBook would not render the same way on its own with one line: the container prefix of the table's first line (such as `> ` or a list marker), an empty HTML comment, and the table's HTML in a `<div class="table-wrapper">`, as mdBook wraps its own tables so that wide tables scroll. A line that begins with `<!--` is an HTML block that ends at the line holding `-->`, which is the same line, so the lines after the table are read as before and a tight list stays tight. Cell text is rendered by pulldown-cmark with mdBook's options and the chapter's link reference definitions; mdBook then rewrites `.md` links in it, as it does in all HTML.
3. pulldown-cmark reads some lines as the delimiter row of a GFM table where GFM and LTEM read none: `- | -` below a paragraph line, which is a list item, or a cell such as `-:-`. At the end of such a line it adds an empty HTML comment, so that mdBook renders the lines as LTEM does; the line itself renders as before.

## Known differences

Against the specification's examples, each a chapter of a book: with mdBook's `smart-punctuation`, `definition-lists` and `admonitions` off, 44 of the 46 examples give the expected HTML after the conformance normalization (leaving out the `<div class="table-wrapper">`). In examples 11 and 12 the table is a GFM table without LTEM notation and without body rows, which mdBook renders itself with an empty `<tbody>`. With mdBook's defaults, these examples also differ, through mdBook's own rendering of text:

- smart punctuation (examples 4, 5, 8, 9, 10, 11, 12 and 22): `--` and `---` in paragraph text and in a header cell become dashes, and the quote in `6.1"` becomes a curly quote.
- definition lists (example 4): `Total` above `:--` becomes a definition list.

A real `mdbook build` of a book of the 46 examples renders each chapter exactly as `pulldown-cmark-ltem` renders the example with mdBook's options, apart from what mdBook adds to every page (the table wrapper, heading ids and their links).

Behavior to know about:

- Footnote references in the cells of an LTEM table stay text (`[^1]`); in a GFM table without LTEM notation they work as before.
- A table whose first line is the first line of a task list item (`- [ ] | ... |`) is left to mdBook, because the HTML would have to be inline there.
- A lazy continuation line right after an LTEM table in a block quote or list item (a line without the `>` or the indentation) is read after the container, since the paragraph it continued is now an HTML block.
- `\\` in a cell is always a line break (LTEM specification, Section 4.2), so mdBook's MathJax delimiters `\\(` and `\\[` cannot be used in the cells of a table.

## Development

```
cargo test -p mdbook-ltem
cargo clippy -p mdbook-ltem --all-targets
```

The tests run the program through its command line: the protocol (with an input recorded from mdBook 0.5.4 and one in mdBook 0.4's layout), the 46 specification examples with mdBook's switches off and on, the tables of 3,000 random documents (also in block quotes and list items) against the LTEM core's, 500 random chapters without LTEM notation that must come back unchanged, containers and blocks around tables, and every prefix of a set of documents.

One test runs a real `mdbook build` of a book of the examples. It uses the `mdbook` command from `$MDBOOK` or from `target/mdbook/bin/mdbook` in the workspace, and passes with a note if neither exists:

```
cargo install mdbook --version 0.5.4 --no-default-features --features search --root target/mdbook
```

## License

MIT ([`LICENSE`](https://github.com/hugman/ltem/blob/main/ltem-lib/rust/crates/mdbook-ltem/LICENSE)). The program includes two generated data tables of the `ltem` crate, whose notices are in [`THIRD-PARTY-NOTICES`](https://github.com/hugman/ltem/blob/main/ltem-lib/rust/crates/mdbook-ltem/THIRD-PARTY-NOTICES). Its dependencies are [`pulldown-cmark-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/rust/crates/pulldown-cmark-ltem) and the [`ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/rust/crates/ltem) core (MIT), pulldown-cmark (MIT) and serde_json (MIT or Apache-2.0), with their own dependencies under MIT, Apache-2.0 or the Unlicense.
