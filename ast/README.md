# Table model (AST)

The language-neutral JSON representation of a parsed LTEM table. Every LTEM parser produces it, and renderers and converters (such as HTML to LTEM) read and write it.

| File | Contents | Status |
|---|---|---|
| [`table.schema.json`](table.schema.json) | JSON Schema for the table model | 1.0, final |
| [`table-model.md`](table-model.md) | Field meanings, rules beyond the schema, and how cell text is stored | 1.0, final |

The model describes the resolved table: the grid size, the number of header rows, column alignments, and for each cell its origin, colspan, rowspan and text. It does not record source details such as whitespace or which span notation (`<<` or `{c:N}`) was used.

## License

The table model schema and its description are under the MIT License ([`../LICENSE`](../LICENSE)), so that implementations can embed them.
