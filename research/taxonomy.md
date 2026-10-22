# A taxonomy of table structural complexity

To compare table formats fairly, we need a common yardstick: what structure can a format express, and what structure does a given table need? The LTEM paper answers with a taxonomy that has two axes:

- **Structural features (F1–F6):** six basic operations for expressing table structure. Each feature is independent of the others, so a format either has it or does not.
- **Complexity levels (L1–L6):** what a table needs, counted cumulatively. Each level adds one feature to the level below it.

This page restates the taxonomy from Section 3 and Appendix A of the paper, with examples written in LTEM 1.0.

## Structural features

| Feature | Name | What it expresses |
|---|---|---|
| F1 | Grid formation | Cells exist at the intersections of rows and columns. |
| F2 | Header designation | Cells have roles: header cells and data cells. In HTML, `<th>` and `<td>`; in Markdown, the rows above the `\|---\|` delimiter row. |
| F3 | Cell merging | A cell covers more than one row or column. |
| F4 | Header nesting | Headers form a hierarchy, such as "Q1", "Q2" and "Q3" grouped under a "Revenue" header. |
| F5 | Section stacking | One table holds several sections with the same columns, such as "Model A results" and "Model B results" in one regression table. |
| F6 | Table composition | Tables with different columns form one logical unit, such as "(a) Correlation matrix" and "(b) Sample sizes" in one figure. |

F3 is the decisive branch. A substantial share of tables in scientific papers need merged cells for group headers or category cells.

## Complexity levels

| Level | Name | Features required | Typical table |
|---|---|---|---|
| L1 | Atomic grid | F1 | A plain list of values |
| L2 | Headered table | F1–F2 | A standard table with a header row |
| L3 | Spanning table | F1–F3 | A table with merged cells |
| L4 | Multi-level header | F1–F4 | A table whose headers form a hierarchy |
| L5 | Block-partitioned | F1–F5 | Sections with the same columns in one table |
| L6 | Composite table | F1–F6 | Parts with different columns combined |

Because the levels are cumulative, a format that lacks a feature cannot express that level or any level above it. A format without cell merging (F3) cannot express L3 tables, and it cannot express L4, L5 or L6 tables either.

## How formats compare

Table 1 of the paper, with one note added for LTEM 1.0:

| Feature | CSV | Markdown | MultiMarkdown | HTML | LaTeX | LTEM | LTEM syntax |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| F1 Grid formation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `\| \|` |
| F2 Header designation | △ | ✓ | ✓ | ✓ | ✓ | ✓ | `\|---\|` |
| F3 Cell merging | ✗ | ✗ | △ | ✓ | ✓ | ✓ | `<<`, `^^`, `{c:N,r:M}` |
| F4 Header nesting | ✗ | ✗ | △ | ✓ | ✓ | ✓ | multi-header rows |
| F5 Section stacking | ✗ | ✗ | ✗ | △† | ✓ | ✓ | section-label rows |
| F6 Table composition | ✗ | ✗ | ✗ | △† | ✓ | ✓* | `\| # id \|`, `@ref` |

✓ native support · △ partial or non-standard · ✗ not supported

\* The paper describes table identifiers (`| # id |`) and references (`@ref`) for F6. **They are in the paper, but LTEM 1.0 leaves them for a later version.** Tables composed of several parts, or nested in one another, turn out to be less common than the structures below them, and every renderer that supports LTEM would need considerable extra work to handle them. Version 1.0 concentrates on the extensions tables need most: merged cells and multi-row headers. The specification reserves the identifier line so that a later version can add identifiers ([Section 9](../spec/ltem-spec.md#9-reserved-syntax)). Until then, F6 is written as separate tables (see [L6](#l6-composite-table) below).

† HTML can approximate sections and composed tables with several `<tbody>` elements or separate `<table>` elements, but it cannot state how the parts relate; that takes extra markup or code of your own.

Notes on the partial entries:

- **CSV, F2.** A header line is a convention. Nothing in the data marks it, and RFC 4180 makes it optional.
- **MultiMarkdown, F3 and F4.** Some renderers support column spans written as repeated pipes, but the syntax is not standardized, and row spans are even more limited. Header nesting needs a parent header that spans its children, so it is limited in the same way.
- **LaTeX** is the only one of the five formats that covers every level, through nesting: `tabular` environments inside each other, and `subtable`.

The pattern matters for language models. The format they process most efficiently, Markdown, cannot express the L3 and higher tables that are common in scientific papers. The formats that can, HTML and LaTeX, are verbose, and their span syntax (`<td colspan="2">`, `\multicolumn{2}{c}{...}`) leaves the model to work out where each cell actually sits. LTEM was designed to fill this gap: it encodes F3–F5 explicitly while keeping Markdown's line-by-line readability.

## Examples by level

Each example adds one feature to the one before it. All of them are valid LTEM 1.0.

### L1: Atomic grid

A grid of values with no header. An LTEM table always has a header row, so a table without a header gets a header row of empty cells ([Section 11](../spec/ltem-spec.md#11-tables-without-header-rows-informative)).

```ltem
|        |     |     |
|--------|-----|-----|
| Korea  | 100 | 120 |
| Japan  | 80  | 95  |
| France | 90  | 110 |
```

### L2: Headered table

F2 adds a header row. This is an ordinary GFM table.

```ltem
| Country | Q1  | Q2  |
|---------|-----|-----|
| Korea   | 100 | 120 |
| Japan   | 80  | 95  |
| France  | 90  | 110 |
```

### L3: Spanning table

F3 adds merged cells. `^^` merges a cell with the cell above it, so "Asia" covers two rows.

```ltem
| Region | Country | Q1  | Q2  |
|--------|---------|-----|-----|
| Asia   | Korea   | 100 | 120 |
| ^^     | Japan   | 80  | 95  |
| Europe | France  | 90  | 110 |
```

### L4: Multi-level header

F4 adds a header hierarchy. Every row above the delimiter row is a header row. `<<` merges a cell with the cell to its left, so "Revenue" spans Q1 and Q2, and "Region" and "Country" span both header rows.

```ltem
| Region | Country | Revenue | <<  |
| ^^     | ^^      | Q1      | Q2  |
|--------|---------|---------|-----|
| Asia   | Korea   | 100     | 120 |
| ^^     | Japan   | 80      | 95  |
| Europe | France  | 90      | 110 |
```

### L5: Block-partitioned

F5 adds sections that share the columns. LTEM needs no extra syntax for this: a section label is a body row whose first cell spans all columns ([Section 10](../spec/ltem-spec.md#10-section-rows-informative)).

```ltem
| Region   | Country | Revenue | <<  |
| ^^       | ^^      | Q1      | Q2  |
|----------|---------|---------|-----|
| Hardware | <<      | <<      | <<  |
| Asia     | Korea   | 100     | 120 |
| ^^       | Japan   | 80      | 95  |
| Europe   | France  | 90      | 110 |
| Software | <<      | <<      | <<  |
| Asia     | Korea   | 40      | 45  |
| Europe   | France  | 30      | 35  |
```

### L6: Composite table

F6 combines parts with different columns into one unit, as in a figure with panels (a) and (b). In LTEM 1.0, each part is its own table, and the text around them says how they belong together:

```ltem
(a) Revenue by country

| Country | Q1  | Q2  |
|---------|-----|-----|
| Korea   | 100 | 120 |
| France  | 90  | 110 |

(b) Staff by office

| Office | Engineers | Sales |
|--------|-----------|-------|
| Seoul  | 42        | 12    |
| Paris  | 18        | 9     |
```

A later version may add the paper's identifiers and references, so that the tables themselves can state the link.

## Using the taxonomy

**To classify a table,** find the highest feature it needs:

1. Does it compose parts with different columns into one unit? Then it is L6.
2. Do rows split it into sections that share the same columns? Then it is L5.
3. Do header cells group other header cells? Then it is L4.
4. Does any cell cover more than one row or column? Then it is L3.
5. Does it have header cells? Then it is L2. Otherwise it is L1.

**To assess a format,** find the first feature it lacks. The format can express every level below that feature and none above it.

**To build a benchmark,** spread the tables across the levels on purpose. Existing table benchmarks were collected for tasks such as question answering, without control over structure; most tables in WikiTableQuestions, for example, are L2. A result such as "format A beats format B" may then hold only for simple tables. The paper's Synthetic Table Benchmark (STB) gives about 30% of its tables to L3, the first level where Markdown and CSV can no longer express the structure. See the [research artifacts](README.md).

## Citation

Eunbin Kim, Hyeonseok Kang, Sangkeun Jung. *LTEM: LLM-Friendly Table-Enhanced Markdown for Table Understanding and Generation.* EMNLP 2026.
