# ltem

The Rust core of LTEM (LLM-friendly Table-Enhanced Markdown), version 1.0 of the [specification](../../../../spec/ltem-spec.md): GitHub Flavored Markdown pipe tables with merged cells (`<<`, `^^`, `{c:N}`, `{r:M}`, `{c:N,r:M}`), several header rows above the delimiter row, and line breaks in cells (`\\`).

```
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
```

The crate:

- finds and parses LTEM tables into the [table model](../../../../ast/table-model.md) and reports validation problems (rules V1–V7, V13, V14)
- renders a table as HTML with real `colspan` and `rowspan`
- writes a table model as canonical LTEM
- converts HTML tables to LTEM
- reads and writes the table model as JSON (serde)

It has no `unsafe` code, and its public types own their data, so bindings for other languages can wrap it thinly.

## Install

The crate is not on crates.io yet. Depend on it by path or by git:

```toml
[dependencies]
ltem = { path = "path/to/ltem-lib/rust/crates/ltem" }
# with CommonMark inline rendering:
# ltem = { path = "...", features = ["commonmark-inline"] }
```

## Use

```rust
let doc = "| Region | Revenue | <<  |\n| ^^     | Q1      | Q2  |\n|--------|---------|-----|\n| Asia   | 100     | 120 |\n";

for result in ltem::find_tables(doc) {
    let table = result.table.expect("find_tables returns tables only");
    for problem in &result.problems {
        println!("{problem}"); // for example "V13 at (1,0): '<<' has no cell to extend"
    }
    let html = ltem::render_html(&table, None);    // plain inline rendering
    let canonical = ltem::write(&table).unwrap();  // canonical LTEM
    let json = table.to_json_pretty();             // the table model as JSON
}
```

`parse_table(block, offset)` parses one block of non-blank lines, given as a string or as a list of lines. A table may begin on any line of the block; the result also gives the lines before and after the table, how each row was read (grid, compact or padded) and the table's line range. `find_tables(markdown)` splits a document into lines (at `\n`, `\r\n` or `\r`, as in CommonMark) and blocks, and calls it, skipping fenced and indented code blocks. It is a light scan, not a full CommonMark parser: it does not model containers such as list items and block quotes.

Markdown parser plugins that find tables themselves can use the line helpers `is_delimiter_row`, `is_upper_header_row`, `starts_block`, `ends_table_body`, `indentation`, `split_row` and `split_row_spans`.

### Where cells are in the source

`ParseResult::sources` gives, for each cell of the table and in the order of `table.cells`, a `CellSource { row, col, rowspan, colspan, line, start, end }`. `line` is in the same line coordinates as the result's `start` and `end`. `start` and `end` are **UTF-8 byte offsets** into that line, so `&line[start..end]` is the cell's source, without the spaces and tabs around it but with any span attribute and escapes. An empty cell has `start == end` at the end of its space between the pipes; a cell added by padding (rule V14) has `start == end ==` the length of the line. `write_with_sources(&table)` writes canonical LTEM and returns the sources of its cells, with lines counted from the table's first line. `CellSource` serializes as `{"row", "col", "rowspan", "colspan", "line", "start", "end"}`. (The Python implementation counts the same offsets in code points.)

### Rendering cell text

`render_html(&table, inline)` takes a function that renders one line of cell text (inline Markdown) as HTML. With `None` it uses `plain_inline`, which applies CommonMark backslash escapes and HTML escaping only. With the `commonmark-inline` feature, `ltem::commonmark_inline` renders CommonMark inlines with pulldown-cmark:

```rust
let html = ltem::render_html(&table, Some(&ltem::commonmark_inline));
```

The default stays `plain_inline` when the feature is enabled, so that enabling a feature never changes the output of existing calls.

### JSON

`Table` implements serde's `Serialize` and `Deserialize`. Serializing gives the table model exactly as [`table.schema.json`](../../../../ast/table.schema.json) defines it, with `"version": "1.0"` first and the keys in the schema's order (serializing into a `serde_json::Value` sorts the keys; serialize to a string to keep the order). `Problem` serializes as `{"rule", "row", "col"}`, the conformance format. `Table::check` reports violations of the model rules that the schema cannot express.

### HTML to LTEM

```rust
for converted in ltem::from_html("<table><tr><th>A</th><th>B</th></tr><tr><td colspan=2>x</td></tr></table>", None) {
    eprintln!("{:?}", converted.warnings);
    println!("{}", ltem::write(&converted.table).unwrap()); // | A | B |\n| --- | --- |\n| x | << |
}
```

The grid is formed as in the HTML table model. Row groups keep their document order, except that the first `<thead>` comes first and the first `<tfoot>` last; a later `<thead>` or `<tfoot>`, and each run of rows outside any group, is an ordinary body group in its place. Cells take the next free position, `rowspan="0"` reaches the end of its row group, and spans stop at the end of their row group. `colspan` and `rowspan` are read with HTML's rules for non-negative integers (`" 2 "` and `"2abc"` are 2; `"-1"`, `"1_0"` and `"２"` are errors, which count as 1) and are cut at 1000 and 65534. The header rows are the rows of the first `<thead>`; without one, or if it is empty, the leading rows made only of `<th>` cells; and if there are none, the first row, with a warning. `header_rows: Some(n)` sets the number; `Some(0)` means the table has no header, so it gets one header row of empty cells and every HTML row becomes a body row (specification Section 11). LTEM 1.0 has no row headers: `<th>` cells outside the header rows become ordinary cells, with one warning per table. The converter always produces a valid table model. Cell content becomes inline Markdown: emphasis, code, links and images are converted, `<sup>` and `<sub>` are kept as HTML, lists and paragraphs become lines, and text is escaped so that Markdown reads it literally. A table inside a cell is flattened to text, with a warning. `from_html_with` takes options, including `InlineFormat::Plain` to keep text only.

`html_to_ltem(html, header_rows)` converts and writes every table, separated by blank lines.

## The HTML tokenizer

The converter reads HTML with its own small tokenizer and tree builder instead of a general HTML parser crate. The reasons:

- **Same results as the Python implementation.** The tokenizer reads HTML the way Python's `html.parser` does, and the tree builder closes table elements implicitly the way the Python converter does, including for malformed and truncated input. A spec-compliant HTML5 parser such as html5ever builds a different tree (foster parenting, implied `tbody`, reconstructed formatting elements), so its tables would differ from the Python converter's on real-world input.
- **Size.** The converter adds no dependencies. In a size test with LTO and stripping, a program that only parses HTML with html5ever and markup5ever_rcdom was about 915 KB larger than an empty program and pulled in 27 crates; the whole LTEM converter (tokenizer, tree builder, character references and inline conversion) added about 305 KB. tl (MIT) is small, but it is a non-validating parser that does not close table elements implicitly.
- **License.** All code is part of this crate. html5ever (MIT or Apache-2.0) would also have been acceptable.

Character references are decoded as the HTML Standard defines them: all named references, including the legacy names that may appear without a semicolon, and numeric references with the standard's replacements. Elements whose content is raw text (`script`, `style` and similar) are read as text up to their end tag. Deep nesting is safe: the tree is traversed without recursion.

## Data tables

Two source files are generated by [`tools/gen_tables.py`](tools/gen_tables.py) and must not be edited by hand:

- `src/fromhtml/entities.rs`: the HTML Standard's named character references
- `src/pychar_tables.rs`: Unicode character classes (letters, letters and digits, printable characters, decimal digits) as Python 3.12 defines them for Unicode 15.0. The converter uses them where the Python implementation uses `str.isalnum` and similar methods, so both escape the same characters.

Regenerate them with `python3 tools/gen_tables.py` (Python 3.12).

The character references come from the [HTML Standard](https://html.spec.whatwg.org/multipage/named-characters.html), (c) WHATWG (Apple, Google, Mozilla, Microsoft), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The character classes come from the Unicode Character Database, under the [Unicode License v3](https://www.unicode.org/license.txt). Their notices are in [`THIRD-PARTY-NOTICES`](THIRD-PARTY-NOTICES). The rest of the crate is under the MIT License ([`LICENSE`](LICENSE)).

## Development

```
cargo test -p ltem --all-features
cargo clippy -p ltem --all-targets --all-features -- -D warnings
```

The tests read the conformance cases from `conformance/cases/spec-examples.json` in the LTEM repository. The rendering cases and the HTML round-trip test need the `commonmark-inline` feature.
