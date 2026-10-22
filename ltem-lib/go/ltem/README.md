# ltem (Go)

The Go core of LTEM (LLM-friendly Table-Enhanced Markdown), version 1.0 of the [specification](https://github.com/hugman/ltem/blob/main/spec/ltem-spec.md): GitHub Flavored Markdown pipe tables with merged cells (`<<`, `^^`, `{c:N}`, `{r:M}`, `{c:N,r:M}`), several header rows above the delimiter row, and line breaks in cells (`\\`).

The package:

- finds and parses LTEM tables into the [table model](https://github.com/hugman/ltem/blob/main/ast/table-model.md) and reports validation problems (rules V1–V7, V13, V14)
- renders a table as HTML with real `colspan` and `rowspan`, with a pluggable renderer for cell text
- writes a table model as canonical LTEM, and rewrites the tables of a document in canonical form
- reads and writes the table model as JSON
- tells where each cell is in the source

It uses only the standard library.

Status: version 0.1.0, for LTEM 1.0. Not yet published. The API may change before version 1.0.0.

```
go get github.com/hugman/ltem/ltem-lib/go/ltem
```

## Use

```go
result := ltem.ParseTable("| Region | Revenue | <<  |\n" +
	"| ^^     | Q1      | Q2  |\n" +
	"|--------|---------|-----|\n" +
	"| Asia   | 100     | 120 |")

table := result.Table                 // *ltem.Table, nil if there is no table
html := ltem.RenderHTML(table, nil)   // <th rowspan="2">Region</th> ...
text, err := ltem.Write(table)        // canonical LTEM
model, err := json.Marshal(table)     // the table model as JSON
for _, p := range result.Problems {   // validation problems, if any
	fmt.Println(p.Rule, p.Row, p.Col, p.Severity(), p.Message)
}
```

| Function | What it does |
|---|---|
| `FindTables(markdown)` | Finds the tables of a document: splits it into lines (at `\n`, `\r\n` or `\r`, as in CommonMark) and into blocks at blank lines, skips fenced and indented code blocks, and parses each block. A light scan, not a full Markdown parser: it does not model containers such as block quotes and list items. |
| `ParseLines(lines, offset)`, `ParseTable(block)` | Parse one block of non-blank lines that may contain a table. A table may begin on any line of the block; delimiter rows are tried from the top. `Result.Start` and `End` give the table's lines, counted from `offset`; lines from `End` on may hold another table. |
| `TableAt(lines, d, offset)` | Parses the table whose delimiter row is `lines[d]`, or returns no table. For parser integrations that see a paragraph one line at a time. |
| `RenderHTML(table, inline)` | Renders a table in the format of the specification's examples: `<thead>` with every header row, `<tbody>` with the body rows if there are any, `colspan`, `rowspan` and `align`. `inline` renders one line of cell text; the lines of a cell are joined with `<br />`. |
| `PlainInline(text)` | The default cell renderer: CommonMark backslash escapes and HTML escaping only. For CommonMark inlines, use `goldmarkltem.CommonMarkInline` from the goldmark v1 package, or your own renderer. |
| `Write(table)`, `WriteWithSources(table)` | Write a table model in canonical form (spec Section 8), and where each cell is in the output. |
| `Format(markdown)` | Rewrites every table that `FindTables` finds in canonical form and keeps everything else; a table keeps the indentation of its first line. |
| `SplitRow`, `SplitRowSpans`, `Indentation`, `IsDelimiterRow`, `IsUpperHeaderRow`, `StartsBlock`, `EndsTableBody` | Line-level rules of spec Section 2, for parser integrations. |
| `CellLineSpans(source)` | Splits the source of one cell into the lines of its text (spec 4.2) and gives where each line is in the source. |

`Result.Forms` tells how each row was read: `GridRow`, `CompactRow`, or `PaddedRow` (rule V14).

### Problems

A `Problem` has the `Rule` (`V1` … `V7`, `V13`, `V14`), the grid `Row` and `Col` of the cell, placeholder or marker concerned (`Col` is -1 for V14, which concerns a whole row), and a `Message`. `Severity()` is `SeverityWarning` for V14 and `SeverityError` otherwise; a table is valid if it has no error. Problems come in the order they were found, which is the order of the Python reference implementation. `String()` gives, for example, `V13 at (1,0): '<<' has no cell to extend`; the JSON form is `{"rule": "V13", "row": 1, "col": 0, "severity": "error"}`, with `null` for a missing column.

### Where cells are

`Result.Sources` gives, for each cell and in the order of `Table.Cells`, a `CellSource{Row, Col, Rowspan, Colspan, Line, Start, End}`. `Line` is counted like `Result.Start`. `Start` and `End` are **byte offsets** into that line, so `line[Start:End]` is the cell's source: without the spaces and tabs around it, with any span attribute and escapes. An empty cell has `Start == End` at the end of its space between the pipes; a cell added because its row was short (rule V14) has `Start == End ==` the length of its line. The Rust core uses the same offsets; the Python core counts code points and the TypeScript core UTF-16 units.

`CellLineSpans(line[Start:End])` splits a cell's source into the lines of its text and gives the byte range of each line in the source, without the spaces and tabs around it, the `\\` line breaks and the span attribute. A line of model text is the span's source with each `\|` read as `|` and the backslash of an LTEM escape (`\<<`, `\^^`, `\{c:2}`) removed.

### The table model as JSON

`Table` marshals to the table model of [`table.schema.json`](https://github.com/hugman/ltem/blob/main/ast/table.schema.json), with `"version": "1.0"` and the keys in the schema's order and the cells sorted. Unmarshaling requires every field, rejects unknown fields and other versions, and checks the types. `Table.Check` reports the violations of the rules that the schema cannot express ([`table-model.md`](https://github.com/hugman/ltem/blob/main/ast/table-model.md)), and also sizes below 1, unknown alignments, and grids of more than 2^28 positions. `Write` refuses a table that fails `Check`, with a `*ModelError`.

## Behavior notes

- Like GFM, the output is proportional to rows × columns: a row with fewer cells than the delimiter row is padded with empty cells. A document with a very wide delimiter row and many short rows therefore makes a large table, as it does in other GFM implementations.
- A carriage return at the end of a line is ignored by `ParseLines` and `TableAt`.

## Tests

See the [workspace README](https://github.com/hugman/ltem/blob/main/ltem-lib/go/README.md#development). The tests read the conformance cases directly, compare the package with the Python and Rust implementations on random documents, and fuzz the parser.
