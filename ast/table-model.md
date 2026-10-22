# LTEM table model

**Version:** 1.0 (2026-10-14), matching the [LTEM specification](../spec/ltem-spec.md) version 1.0.

The table model is the language-neutral result of parsing one LTEM table. Parsers produce it, and renderers, validators and converters read or write it. [`table.schema.json`](table.schema.json) gives its JSON Schema. This document gives the meaning of each field and the rules the schema cannot express.

The model describes the resolved table, not the source text. Two tables that differ only in notation have the same model. For example, a span written with `<<` and the same span written with `{c:2}` produce identical models.

## Example

This LTEM table:

```
| Region | Revenue  | <<  |
| ^^     | Q1       | Q2  |
|--------|---------:|----:|
| Asia   | **100**  | 120 |
| Europe | 90 \\ est. | 110 |
```

has this model:

```json
{
  "version": "1.0",
  "rows": 4,
  "cols": 3,
  "header_rows": 2,
  "align": [null, "right", "right"],
  "cells": [
    {"row": 0, "col": 0, "rowspan": 2, "colspan": 1, "text": "Region"},
    {"row": 0, "col": 1, "rowspan": 1, "colspan": 2, "text": "Revenue"},
    {"row": 1, "col": 1, "rowspan": 1, "colspan": 1, "text": "Q1"},
    {"row": 1, "col": 2, "rowspan": 1, "colspan": 1, "text": "Q2"},
    {"row": 2, "col": 0, "rowspan": 1, "colspan": 1, "text": "Asia"},
    {"row": 2, "col": 1, "rowspan": 1, "colspan": 1, "text": "**100**"},
    {"row": 2, "col": 2, "rowspan": 1, "colspan": 1, "text": "120"},
    {"row": 3, "col": 0, "rowspan": 1, "colspan": 1, "text": "Europe"},
    {"row": 3, "col": 1, "rowspan": 1, "colspan": 1, "text": "90\nest."},
    {"row": 3, "col": 2, "rowspan": 1, "colspan": 1, "text": "110"}
  ]
}
```

## Fields

| Field | Meaning |
|---|---|
| `version` | Version of the table model. Always `"1.0"` for this version. |
| `rows` | Number of grid rows. Header rows come first, then body rows. |
| `cols` | Number of grid columns, equal to the number of cells in the delimiter row. |
| `header_rows` | Number of header rows. It is at least 1 and at most `rows`. |
| `align` | One entry per column: `"left"`, `"center"`, `"right"`, or `null` when the delimiter row sets no alignment. |
| `cells` | The cells of the table (see below). |

Each cell has:

| Field | Meaning |
|---|---|
| `row`, `col` | Position of the cell's origin, its top-left position, counting from 0. |
| `rowspan`, `colspan` | Number of rows and columns the cell spans. Always present, 1 when the cell does not span. |
| `text` | The cell's inline Markdown source (see [Cell text](#cell-text)). |

A cell is a header cell if its `row` is less than `header_rows`. Every other cell is a body cell.

## Rules beyond the schema

A valid table model satisfies all of the following:

1. `align` has exactly `cols` entries.
2. Every cell lies inside the grid: `row + rowspan <= rows` and `col + colspan <= cols`.
3. Every grid position belongs to exactly one cell. Covered positions have no entry of their own.
4. A header cell does not reach into the body: if `row < header_rows`, then `row + rowspan <= header_rows`.
5. `cells` is sorted by `row` and then by `col`.
6. No `text` holds two backslashes in a row (`\\`). LTEM reads `\\` as a line break, so a parser never produces it and a writer cannot write it ([specification Appendix B](../spec/ltem-spec.md#appendix-b-not-in-version-10)).

A parser always produces a valid model, even from an invalid table, because the recovery rules in [specification Section 3.6](../spec/ltem-spec.md#36-invalid-tables) remove overlaps and cut spans.

## Cell text

`text` holds the cell's inline Markdown source, ready to be parsed as inlines by a Markdown processor. A parser gets it from the cell's source in this order:

1. Escaped pipes (`\|`) become `|`, as in GFM table parsing, when the row is split into cells.
2. The span attribute and the spaces and tabs before it are removed.
3. The text is split at each `\\` line break, pairing backslashes from left to right. Each line is trimmed of spaces and tabs; other whitespace, such as U+3000, is kept. The lines are joined by line feeds (`\n`).
4. The LTEM escapes lose their backslash in the places [specification Section 4.3](../spec/ltem-spec.md#43-escapes) lists: a line written `\<<` or `\^^` has the text `<<` or `^^`, and a line ending in ` \{c:2}` has text ending in ` {c:2}`. These escapes only stop LTEM from reading the text as notation, so removing them does not change how the text renders in CommonMark. A host whose own inline syntax gives these characters a meaning must escape them again before it parses the text as inlines: in Pandoc's Markdown, for example, `^^` is an empty superscript.

Everything else is kept as written. This includes other backslash escapes, such as `\*`, and inline syntax, such as `**bold**` or `$x^2$`.

A writer turning a model back into LTEM reverses these steps:

- it escapes every `|` as `\|`
- it writes each line feed as ` \\ `
- it adds the escapes from [specification Section 4.3](../spec/ltem-spec.md#43-escapes) where they are needed

Writing a model and reading it back gives a table with the same structure and with cell text that renders the same, but the text is not always identical. The escapes `\-` and `\#` that a writer adds to header rows stay in the text, and a line that already holds `\<<`, `\^^` or ends in ` \{c:2}` reads back without its backslash.

A converter that builds a model from another format, such as HTML, must produce valid inline Markdown in `text`. For example, it escapes a literal `*` as `\*` so that it is not read as emphasis. It writes two backslashes in a row in another way (rule 6), for example `&#92;\`; inside a code span, where character references are not decoded, it cannot, so it writes the content as text instead.

## Relation to TableStructure JSON

The paper refers to a "TableStructure JSON" format but does not define it. This model takes its field names (`rows`, `cols`, `header_rows`, `colspan`, `rowspan`) from the schema of an earlier draft of the specification (December 2024), and simplifies the rest for version 1.0:

- **One table per model.** Documents with several tables, table identifiers and references are left for a later version.
- **Header status is derived.** It follows from `header_rows`, so cells have no separate header flag.
- **Text only.** Cell content is the inline Markdown source. There are no content types for lists, math or mixed content, because those are handled by the host's inline syntax.
