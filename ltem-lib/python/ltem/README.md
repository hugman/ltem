# ltem (Python)

Reference Python implementation of [LTEM](../../../README.md): Markdown pipe tables with merged cells and multi-row headers. It follows the LTEM specification, version 1.0.

Status: version 0.1.0, the first release, for LTEM 1.0. The API may change before version 1.0.0.

## Install

```
pip install ltem-core              # no dependencies
pip install "ltem-core[markdown]"  # also renders inline Markdown in cells (uses markdown-it-py)
```

## Use

```python
import ltem

result = ltem.parse_table("""\
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |""")

table = result.table            # the table model (see ast/ in the LTEM repository)
table.to_dict()                 # JSON-ready dict
ltem.render_html(table)         # <table> with colspan and rowspan
ltem.write(table)               # canonical LTEM
result.problems                 # validation problems, if any

for item in ltem.from_html(html):   # HTML tables -> table models
    print(ltem.write(item.table), item.warnings)

text, sources = ltem.write_with_sources(table)   # canonical LTEM and where each cell is
```

### Where cells are

`ParseResult.sources` and `write_with_sources` give, for each cell of the table and in the same order, a `CellSource(row, col, rowspan, colspan, line, start, end)`:

- `line` counts lines from 0: lines of the parsed text for `parse_table` and `find_tables`, lines of the table for `write_with_sources`.
- `start` and `end` index that line in Python string units (code points). They cover the cell's source without the spaces and tabs around it, including any span attribute and escapes.
- For an empty cell, `start` equals `end`, at the end of its space between the pipes. A cell added because its row was short (rule V14) has `start == end ==` the length of its line.

Without `markdown-it-py`, cell text is HTML-escaped and backslash escapes are applied, but emphasis, links and code are shown as written.

`ltem.find_tables(markdown)` finds every LTEM table in a Markdown document. It is a light scan that skips code blocks. It is not a full Markdown parser.

## Command line

```
ltem parse    [FILE]          # table models as JSON
ltem render   [FILE]          # HTML of each table
ltem validate [FILE] [--json] # validation problems; exit status 1 if any
ltem fmt      [FILE]          # rewrite every table in canonical form
ltem from-html [FILE] [--header-rows N] [--plain]  # convert HTML tables to LTEM
```

`from_html(html, header_rows=None, inline="markdown")` options:

- `header_rows`: the number of header rows. By default it is the `<thead>` rows; without `<thead>`, the leading rows made only of `<th>` cells; and if there are none, the first row (with a warning). With `0`, the table has no header: it gets one header row of empty cells and every HTML row becomes a body row (spec Section 11).
- `inline`: `"markdown"` keeps emphasis, code, links and images as Markdown; `"plain"` keeps text only. Either way, text is escaped so that it reads literally.

`<th>` cells below the header rows become ordinary cells, since LTEM 1.0 has no row headers; the converter reports this once per table in `warnings`.

`from_html` forms the grid as browsers do: cells take the next free position, `rowspan="0"` reaches the end of its row group, and spans stop at the edge of `<thead>`, `<tbody>` or `<tfoot>`. The header rows are the `<thead>` rows; without `<thead>`, the leading rows made only of `<th>` cells; and if there are none, the first row. Cell content becomes inline Markdown: `<br>` and block elements become line breaks, and `<strong>`, `<em>`, `<code>`, `<a>`, `<img>`, lists, `<sup>` and `<sub>` are kept. A table inside a cell is flattened to text with a warning, since LTEM 1.0 has no nested tables.

## Development

From `ltem-lib/python`:

```
uv sync --all-packages
uv run --directory ltem pytest
```

The tests run the conformance cases in [`conformance/`](../../../conformance/).
