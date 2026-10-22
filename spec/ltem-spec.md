# LTEM Specification

- **Version:** 1.0 (2026-10-14)
- **Authors:** Sangkeun Jung, Eunbin Kim
- **Editor:** Sangkeun Jung (EurekaAI)
- **Status:** Final. Corrections of errors are published as versions 1.0.1, 1.0.2 and so on. What version 1.0 leaves out is listed in [Appendix B](#appendix-b-not-in-version-10).
- **Copyright:** © 2026 EurekaAI Co., Ltd.
- **License:** This specification is licensed under the [Creative Commons Attribution-NoDerivatives 4.0 International License](https://creativecommons.org/licenses/by-nd/4.0/) (CC BY-ND 4.0). The full text is in [`LICENSE`](LICENSE).

You may copy and redistribute this specification unchanged, in any medium, if you credit it. You may not distribute modified versions. A translation is a modified version, so translating it needs permission; official translations are published with the specification.

The conformance tests in [`conformance/`](../conformance/), including the examples of this document, the table model in [`ast/`](../ast/), and the code in this repository are under the MIT License, so that implementations can use them freely. Patent claims essential to this specification are licensed royalty-free to conforming implementations in [`PATENTS`](../PATENTS). The use of the name LTEM is described in [`TRADEMARK.md`](../TRADEMARK.md).

## 1. Introduction

### 1.1 What LTEM is

LTEM (LLM-friendly Table-Enhanced Markdown) extends the pipe tables of GitHub Flavored Markdown (GFM) so that a table can have merged cells and several header rows. An LTEM table is still plain text that reads from top to bottom. People and language models can write it by hand. Renderers without LTEM support still show the cell text in rows and columns.

LTEM was introduced in the paper *LTEM: LLM-Friendly Table-Enhanced Markdown for Table Understanding and Generation* (EMNLP 2026). This document turns the notation described in the paper into a specification that implementations can be tested against. [Appendix A](#appendix-a-relation-to-the-paper) lists where this document adds to the paper.

To learn the notation, start with the [guide to writing LTEM tables](../docs/guide.md).

### 1.2 Relation to CommonMark and GFM

An LTEM table is a leaf block that takes the place of the GFM table extension. Everything outside tables is ordinary Markdown, handled by the host Markdown processor.

Inside a table, LTEM defines the structure: rows, header rows, cells and spans. The text inside each cell is parsed as inlines by the host processor, as in GFM.

A GFM table that uses no LTEM notation is an LTEM table with the same meaning and the same HTML output. There are a few exceptions, all rare:

- A pipe-led paragraph line directly above a table becomes a header row ([Section 2.3](#23-header-rows)).
- A cell whose text is exactly `<<` or `^^`, or ends in a span attribute such as `{c:2}`, is read as LTEM notation ([Section 4.3](#43-escapes)).
- Two backslashes (`\\`) in a cell mark a line break ([Section 4.2](#42-line-breaks)), also inside a code span. In GFM they stand for one literal backslash, or for two inside a code span.
- A line that begins a block, or that is indented by four or more columns, is never the last header row ([Section 2.3](#23-header-rows)). GFM may make such a line a header row when it continues a paragraph, for example `2. a | b` after a line of text. The block test of Section 2.3 looks at the line alone, so in rare cases it differs from CommonMark in other ways too: for example, a line of three backticks followed by text that holds a backtick counts as a fence.
- A last header row may have more cells than the delimiter row if the extra cells are empty, because it fits as a compact row ([Section 2.3](#23-header-rows)). GFM requires the same number of cells, so `| a | b | |` over `|---|---|` is a table in LTEM and a paragraph in GFM.
- A line that holds a single pipe and nothing else, such as `|`, is a body row of empty cells ([Section 2.1](#21-rows-and-cells)). GFM ends the table before such a line.
- A delimiter row must contain a pipe ([Section 2.2](#22-the-delimiter-row)). GFM also accepts one without a pipe below a one-column header row, so `Total` above `:--` is a table in GFM and a paragraph in LTEM.
- A line that begins an HTML block in CommonMark, such as `<div> | x`, can be the last header row ([Section 2.3](#23-header-rows)). In GFM it begins an HTML block, and no table forms.

### 1.3 Scope of version 1.0

Version 1.0 covers:

- cells merged across columns (colspan) and rows (rowspan)
- several header rows above the delimiter row
- line breaks inside a cell

Version 1.0 does not cover the following. A later version may add them.

- table identifiers and references between tables (`| # id |`, `@id`). The paper describes these for composing tables. [Section 9](#9-reserved-syntax) reserves the identifier line.
- tables inside cells
- two literal backslashes in a row in cell text, and header cells in body rows (row headers) ([Appendix B](#appendix-b-not-in-version-10))
- styling such as borders, colors and column widths

### 1.4 Conformance

The key words MUST, MUST NOT, SHOULD and MAY are to be read as described in RFC 2119.

This specification addresses three kinds of software:

- A **renderer** reads LTEM and produces output such as HTML. A renderer MUST accept every input, including invalid tables, and MUST handle invalid tables as [Section 3.6](#36-invalid-tables) describes.
- A **validator** reports the problems listed in [Section 5](#5-validation-rules).
- A **writer** produces LTEM text, for example from HTML or from a table model. A writer MUST produce valid LTEM that a parser reads as the same table: the same rows, header rows, spans and alignment, and cell text that renders the same (the text itself may differ in escapes, see [Section 4.3](#43-escapes)). A writer SHOULD produce the canonical form in [Section 8](#8-canonical-form).

The examples are normative, including those in informative sections, which show results that follow from rules defined elsewhere. Each example shows LTEM input, a line containing a single `.`, and the expected HTML. The examples assume a host that implements CommonMark and no extension other than LTEM. When comparing HTML, test harnesses SHOULD ignore whitespace between tags and the order of attributes.

A table without LTEM notation renders as in GFM:

```````````````````````````````` example
| Region | Q1  | Q2  |
|--------|-----|-----|
| Asia   | 100 | 120 |
.
<table>
<thead>
<tr>
<th>Region</th>
<th>Q1</th>
<th>Q2</th>
</tr>
</thead>
<tbody>
<tr>
<td>Asia</td>
<td>100</td>
<td>120</td>
</tr>
</tbody>
</table>
````````````````````````````````

## 2. Table structure

### 2.1 Rows and cells

A **row** is a line split into cells by pipe characters (`|`), as in GFM:

- A leading and a trailing pipe are optional.
- A pipe preceded by a backslash (`\|`) does not split cells. It stands for a literal pipe in the cell text. This holds everywhere in the line, including inside code spans and math. Only the backslash directly before the pipe counts: `\\|` is a backslash followed by an escaped pipe, so the cell text holds `\|`, which CommonMark renders as `|`.
- Spaces and tabs at the start and end of each cell are removed. Other whitespace, such as the ideographic space (U+3000) that documents use to indent a cell, is kept. In this specification, to **trim** text means to remove spaces and tabs only, in this way.

The **indentation** of a line is the spaces and tabs at its start, counted in columns. A tab advances to the next multiple of four columns, as in CommonMark.

Inside a container block, such as a block quote or a list item, the lines of a table are taken after the host has removed the markers and the indentation of the containers, as CommonMark does for every block.

```````````````````````````````` example
| Item      | Amount |
|-----------|--------|
| Revenue   | 100    |
|　Subtotal | 60     |
.
<table>
<thead>
<tr>
<th>Item</th>
<th>Amount</th>
</tr>
</thead>
<tbody>
<tr>
<td>Revenue</td>
<td>100</td>
</tr>
<tr>
<td>　Subtotal</td>
<td>60</td>
</tr>
</tbody>
</table>
````````````````````````````````

A pipe inside a formula must be escaped like any other pipe:

```````````````````````````````` example
| Series   | Condition    |
|----------|--------------|
| Infinite | $\|r\| < 1$  |
.
<table>
<thead>
<tr>
<th>Series</th>
<th>Condition</th>
</tr>
</thead>
<tbody>
<tr>
<td>Infinite</td>
<td>$|r| &lt; 1$</td>
</tr>
</tbody>
</table>
````````````````````````````````

### 2.2 The delimiter row

A line has the **form of a delimiter row** if all of the following hold. These are the GFM rules, except that GFM does not always require the pipe ([Section 1.2](#12-relation-to-commonmark-and-gfm)):

- it contains at least one pipe
- its indentation is at most three columns
- it does not begin a list item ([Section 2.3](#23-header-rows)), as `- | -` does
- split into cells as in [Section 2.1](#21-rows-and-cells), each of its cells holds one or more hyphens (`-`), optionally with a colon (`:`) at the start, the end or both

The **delimiter row** of a table is such a line ([Section 2.3](#23-header-rows) says which one). The number of its cells is the number of **columns** of the table. Each cell sets the alignment of its column: a colon at the start means left, a colon at the end means right, colons at both ends mean center, and no colon means no alignment.

A line without a pipe is not a delimiter row, so a one-column table needs a pipe in its delimiter row:

```````````````````````````````` example
Total
:--
.
<p>Total
:--</p>
````````````````````````````````

A line indented by four or more columns is ordinary text:

```````````````````````````````` example
| a | b |
    |---|---|
| 1 | 2 |
.
<p>| a | b |
|---|---|
| 1 | 2 |</p>
````````````````````````````````

A line that begins a list item is a list item, not a delimiter row, as in GFM. `- | -` starts a list:

```````````````````````````````` example
Size | Price
- | -
.
<p>Size | Price</p>
<ul>
<li>| -</li>
</ul>
````````````````````````````````

### 2.3 Header rows

A table has one or more **header rows** above the delimiter row.

- The line directly above the delimiter row is the last header row, as in GFM. A leading pipe is optional. Like a GFM header row, it is a paragraph line. The following lines cannot be the last header row, so a delimiter row below one of them starts no table:
  - a line indented by four or more columns
  - a line that begins a block quote, an ATX heading, a fenced code block, a thematic break or a list item
  - a setext heading underline, that is, a line of one or more `=` or one or more `-` (after an indentation of at most three columns, followed only by spaces and tabs), when the line before it is part of the same paragraph and does not begin a block. As in CommonMark, it turns that line into a heading.
- If the last header row itself has the form of a delimiter row, it is the only header row, as in GFM.
- Otherwise the lines directly above it are header rows too, as long as each begins with a pipe after an indentation of at most three columns, does not have the form of a delimiter row, and is not a reserved identifier line ([Section 9](#9-reserved-syntax)). The first line above them that does not qualify ends the header rows. That line and the lines before it stay a paragraph.

A line **begins a block** if, after an indentation of at most three columns, it starts with one of the following:

- `>` (block quote)
- one to six `#` followed by a space, a tab or the end of the line (ATX heading)
- three or more backticks or three or more tildes (fenced code block)
- three or more `-`, `*` or `_` of one kind, possibly separated by spaces and tabs, with nothing else on the line (thematic break)
- `-`, `+` or `*`, or one to nine digits followed by `.` or `)`, followed by a space, a tab or the end of the line (list item)

This test looks at the line alone, not at its context. For example, `2. a | b` begins a block even where CommonMark would read it as the continuation of a paragraph, because an ordered list that does not start at 1 cannot interrupt one.

```````````````````````````````` example
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
.
<table>
<thead>
<tr>
<th rowspan="2">Region</th>
<th colspan="2">Revenue</th>
</tr>
<tr>
<th>Q1</th>
<th>Q2</th>
</tr>
</thead>
<tbody>
<tr>
<td>Asia</td>
<td>100</td>
<td>120</td>
</tr>
</tbody>
</table>
````````````````````````````````

A setext heading underline above the delimiter row makes a heading, as in GFM:

```````````````````````````````` example
Revenue
===
|---|
| 1 |
.
<h1>Revenue</h1>
<p>|---|
| 1 |</p>
````````````````````````````````

A first column titled `#` needs the leading pipe. Without it, the line is a heading:

```````````````````````````````` example
# | Name | Score
--|------|------
1 | Kim  | 90
.
<h1>| Name | Score</h1>
<p>--|------|------
1 | Kim  | 90</p>
````````````````````````````````

A table is recognized only if its last header row fits the columns, given the positions that the header rows above it cover. The header rows are resolved from the top ([Section 3](#3-span-resolution)), and the last one must be read under rule 1 or rule 2 of [Section 3.2](#32-grid-rows-and-compact-rows): as a grid row, or as a compact row, whose leftover empty cells are ignored. A last header row that needs rule 3 (V14) does not fit. This generalizes the GFM rule that the header row must have as many cells as the delimiter row. If the last header row does not fit, the lines are not a table:

```````````````````````````````` example
| Region | Q1 | Q2 |
|--------|----|
| Asia   | 1  |
.
<p>| Region | Q1 | Q2 |
|--------|----|
| Asia   | 1  |</p>
````````````````````````````````

A table may begin on any line of a paragraph, as in GFM. Delimiter rows are tried from the top. A delimiter row whose last header row does not fit is ordinary text, and a later delimiter row in the same paragraph may still begin a table:

```````````````````````````````` example
| a | b |
|---|
| c |
|:-:|
.
<p>| a | b |
|---|</p>
<table>
<thead>
<tr>
<th align="center">c</th>
</tr>
</thead>
</table>
````````````````````````````````

A last header row that has the form of a delimiter row is the only header row, as in GFM:

```````````````````````````````` example
Note
| a | b |
|---|
|---|
.
<p>Note
| a | b |</p>
<table>
<thead>
<tr>
<th>---</th>
</tr>
</thead>
</table>
````````````````````````````````

Lines above the header rows that do not begin with a pipe stay a paragraph:

```````````````````````````````` example
Quarterly revenue
| Region | Q1  |
|--------|-----|
| Asia   | 100 |
.
<p>Quarterly revenue</p>
<table>
<thead>
<tr>
<th>Region</th>
<th>Q1</th>
</tr>
</thead>
<tbody>
<tr>
<td>Asia</td>
<td>100</td>
</tr>
</tbody>
</table>
````````````````````````````````

### 2.4 Body rows

The rows below the delimiter row are **body rows**. As in GFM, the table ends at the first line that is blank (empty or holding only spaces and tabs, as CommonMark defines it), is indented by four or more columns, or begins a block as defined in [Section 2.3](#23-header-rows). A host Markdown processor may also end the table where its own rules start another block, such as an HTML block. Where this happens is up to the host; the examples do not depend on it.

```````````````````````````````` example
| Step | Action |
|------|--------|
| 1    | Mix    |
- Stir well
.
<table>
<thead>
<tr>
<th>Step</th>
<th>Action</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td>Mix</td>
</tr>
</tbody>
</table>
<ul>
<li>Stir well</li>
</ul>
````````````````````````````````

A line holding other whitespace, such as an ideographic space (U+3000), is not blank, so it is a body row:

```````````````````````````````` example
| Item |
|------|
| 1    |
　
| 2    |
.
<table>
<thead>
<tr>
<th>Item</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
</tr>
<tr>
<td>　</td>
</tr>
<tr>
<td>2</td>
</tr>
</tbody>
</table>
````````````````````````````````

### 2.5 Kinds of cells

After trimming, each cell is one of the following:

| Cell text | Kind |
|---|---|
| exactly `<<` | colspan marker |
| exactly `^^` | rowspan marker |
| empty | empty cell |
| anything else | content cell, which may end with a span attribute |

A marker must be the whole cell. A cell such as `a << b` is a content cell. The markers are written with the ASCII characters `<` (U+003C) and `^` (U+005E). Look-alike characters, such as `«` (U+00AB), are text.

### 2.6 Span attributes

A content cell may end with a **span attribute**:

| Attribute | Meaning |
|---|---|
| `{c:N}` | the cell spans N columns |
| `{r:M}` | the cell spans M rows |
| `{c:N,r:M}` or `{r:M,c:N}` | both |

In general, a span attribute is `{`, one or more items separated by commas, and `}`. Each item is `c:` or `r:` followed by one or more ASCII digits (`0`–`9`). There are no spaces inside the braces. The attribute is the last thing in the cell, and it is either the whole cell or preceded by a space or tab. The attribute and the spaces and tabs before it are not part of the cell text.

A text **ends in a span attribute** if it ends in text of this form that is either the whole text or preceded by a space or tab. `x {c:2}` and `{c:2}` end in a span attribute; `x{c:2}` and `x {c:2} y` do not.

The items are read in order. A value of zero breaks rule V1. An item whose key (`c` or `r`) appeared earlier in the same attribute breaks rule V1 too, and is ignored. So `{c:0,c:3}` and `{c:3,c:0}` each break V1 twice.

A cell may consist of an attribute alone. For example, `{c:2}` is a content cell without text that spans two columns. It is not an empty cell: where this specification requires an empty cell, such as for a placeholder or a leftover cell of a compact row, the trimmed cell must have no characters at all.

## 3. Span resolution

### 3.1 The grid

A table is a grid. It has as many columns as the delimiter row has cells, and one row for each header row and body row. Every position in the grid belongs to exactly one cell.

A cell that occupies more than one position is a **spanning cell**. Its top-left position is its **origin**. Its other positions are **covered**.

Rows are processed from top to bottom, and positions within a row from left to right. A position may already be covered when its turn comes, in two ways:

- a cell in an earlier row spans down into it
- a cell earlier in the same row spans across it

### 3.2 Grid rows and compact rows

A row can take two forms:

- In a **grid row**, every position has its own cell in the text. A covered position holds an empty cell or a marker as a placeholder.
- In a **compact row**, covered positions have no cell in the text. Only positions that are not covered get a cell.

Let *n* be the number of cells in a row and *C* the number of columns. The row is read as follows:

1. If *n* = *C*, the row is a grid row.
2. Otherwise, the row is a compact row if placing its cells one by one into the positions that are not covered ([Section 3.3](#33-placing-a-cell)) fills all those positions. Cells left over must be empty, and they are ignored. Trying this form changes nothing: if it fails, the row is read under rule 3 as if it had not been tried, and problems met during the try are not reported.
3. Otherwise, the row does not fit (rule V14). It is read as a grid row after empty cells are added at its end or cells are dropped from its end, as in GFM.

Both forms may contain markers. A table may mix the two forms row by row.

A span attribute in a grid row, with empty cells as placeholders:

```````````````````````````````` example
| Revenue {c:2} |    |
|---------------|----|
| Q1            | Q2 |
.
<table>
<thead>
<tr>
<th colspan="2">Revenue</th>
</tr>
</thead>
<tbody>
<tr>
<td>Q1</td>
<td>Q2</td>
</tr>
</tbody>
</table>
````````````````````````````````

The same table with a compact first row:

```````````````````````````````` example
| Revenue {c:2} |
|---------------|----|
| Q1            | Q2 |
.
<table>
<thead>
<tr>
<th colspan="2">Revenue</th>
</tr>
</thead>
<tbody>
<tr>
<td>Q1</td>
<td>Q2</td>
</tr>
</tbody>
</table>
````````````````````````````````

A row span written with empty placeholders, and the same span written with compact rows:

```````````````````````````````` example
| Product | Quarter | Sales |
|---------|---------|-------|
| Phone {r:2} | Q1  | 100   |
|         | Q2      | 120   |
.
<table>
<thead>
<tr>
<th>Product</th>
<th>Quarter</th>
<th>Sales</th>
</tr>
</thead>
<tbody>
<tr>
<td rowspan="2">Phone</td>
<td>Q1</td>
<td>100</td>
</tr>
<tr>
<td>Q2</td>
<td>120</td>
</tr>
</tbody>
</table>
````````````````````````````````

```````````````````````````````` example
| Product | Quarter | Sales |
|---------|---------|-------|
| Phone {r:2} | Q1  | 100   |
| Q2      | 120     |
.
<table>
<thead>
<tr>
<th>Product</th>
<th>Quarter</th>
<th>Sales</th>
</tr>
</thead>
<tbody>
<tr>
<td rowspan="2">Phone</td>
<td>Q1</td>
<td>100</td>
</tr>
<tr>
<td>Q2</td>
<td>120</td>
</tr>
</tbody>
</table>
````````````````````````````````

A row whose positions are all covered has no cell in compact form. It is written as a single empty cell, which is ignored:

```````````````````````````````` example
| A    | B    |
|------|------|
| x {r:2} | y {r:2} |
|      |
| 1    | 2    |
.
<table>
<thead>
<tr>
<th>A</th>
<th>B</th>
</tr>
</thead>
<tbody>
<tr>
<td rowspan="2">x</td>
<td rowspan="2">y</td>
</tr>
<tr>
</tr>
<tr>
<td>1</td>
<td>2</td>
</tr>
</tbody>
</table>
````````````````````````````````

### 3.3 Placing a cell

A cell placed at a position that is not covered acts by kind:

- An **empty cell** becomes a 1×1 cell with no text.
- A **content cell** becomes a cell with its origin at this position. Its colspan and rowspan come from its span attribute, or are 1. The positions it spans become covered.
- A **colspan marker** `<<` extends the cell to its left by one column ([Section 3.4](#34-markers)).
- A **rowspan marker** `^^` extends the cell above it by one row ([Section 3.4](#34-markers)).

In a grid row, a cell at a covered position is a placeholder. It must be empty or a marker (rules V5 and V6), and it is not placed.

A span attribute may also be followed by marker placeholders:

```````````````````````````````` example
| Region {c:2} | <<  | Total |
| Area         | Rep | Sum   |
|--------------|-----|-------|
| North        | Tom | 110   |
.
<table>
<thead>
<tr>
<th colspan="2">Region</th>
<th>Total</th>
</tr>
<tr>
<th>Area</th>
<th>Rep</th>
<th>Sum</th>
</tr>
</thead>
<tbody>
<tr>
<td>North</td>
<td>Tom</td>
<td>110</td>
</tr>
</tbody>
</table>
````````````````````````````````

### 3.4 Markers

A `<<` at position (*r*, *c*) extends the cell that owns position (*r*, *c*−1). This succeeds when both of the following hold:

- that cell's origin is in row *r*, and its last column is *c*−1
- that cell's span attribute has no `c`

The cell's colspan then grows by one. Otherwise the marker breaks rule V13.

```````````````````````````````` example
| Item  | Specs | <<     | <<    |
|-------|-------|--------|-------|
| Phone | 6.1"  | 170 g  | 128GB |
| Note  | Same as phone | << | <<   |
.
<table>
<thead>
<tr>
<th>Item</th>
<th colspan="3">Specs</th>
</tr>
</thead>
<tbody>
<tr>
<td>Phone</td>
<td>6.1&quot;</td>
<td>170 g</td>
<td>128GB</td>
</tr>
<tr>
<td>Note</td>
<td colspan="3">Same as phone</td>
</tr>
</tbody>
</table>
````````````````````````````````

A `^^` at position (*r*, *c*) extends the cell that owns position (*r*−1, *c*). This succeeds when all of the following hold:

- that cell's origin is in column *c*, and its last row is *r*−1
- that cell's span attribute has no `r`
- that cell is not a header cell ([Section 3.5](#35-header-cells)) while row *r* is a body row

The cell's rowspan then grows by one. If the cell spans several columns, the new row is covered in all of them, so the positions to the right of *c* are already covered when their turn comes. If one of the first two conditions fails, the marker breaks rule V13; if only the third fails, it breaks rule V7.

The new positions of an extended cell are never covered yet: a cell that covered one of them would also cover the marker's own position, or a position of the extended cell.

```````````````````````````````` example
| Region | Product | Sales |
|--------|---------|-------|
| Asia   | Phone   | 1.2M  |
| ^^     | Laptop  | 0.8M  |
| Europe | Phone   | 0.9M  |
.
<table>
<thead>
<tr>
<th>Region</th>
<th>Product</th>
<th>Sales</th>
</tr>
</thead>
<tbody>
<tr>
<td rowspan="2">Asia</td>
<td>Phone</td>
<td>1.2M</td>
</tr>
<tr>
<td>Laptop</td>
<td>0.8M</td>
</tr>
<tr>
<td>Europe</td>
<td>Phone</td>
<td>0.9M</td>
</tr>
</tbody>
</table>
````````````````````````````````

A block of merged cells uses `<<` to the right of the origin in the first row, `^^` below the origin, and `<<` in the rest of the block:

```````````````````````````````` example
| Summary | <<  | Note |
| ^^      | <<  | Q4   |
|---------|-----|------|
| 1       | 2   | 3    |
.
<table>
<thead>
<tr>
<th colspan="2" rowspan="2">Summary</th>
<th>Note</th>
</tr>
<tr>
<th>Q4</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td>2</td>
<td>3</td>
</tr>
</tbody>
</table>
````````````````````````````````

The same block written with an attribute, first in grid rows and then in compact rows:

```````````````````````````````` example
| Summary {c:2,r:2} |   | Note |
|                   |   | Q4   |
|-------------------|---|------|
| 1                 | 2 | 3    |
.
<table>
<thead>
<tr>
<th colspan="2" rowspan="2">Summary</th>
<th>Note</th>
</tr>
<tr>
<th>Q4</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td>2</td>
<td>3</td>
</tr>
</tbody>
</table>
````````````````````````````````

```````````````````````````````` example
| Summary {c:2,r:2} | Note |
| Q4 |
|----|----|----|
| 1  | 2  | 3  |
.
<table>
<thead>
<tr>
<th colspan="2" rowspan="2">Summary</th>
<th>Note</th>
</tr>
<tr>
<th>Q4</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td>2</td>
<td>3</td>
</tr>
</tbody>
</table>
````````````````````````````````

A marker that cannot extend a cell is kept as literal text in a 1×1 cell (rule V13):

```````````````````````````````` example
| A | B |
|---|---|
| << | 1 |
.
<table>
<thead>
<tr>
<th>A</th>
<th>B</th>
</tr>
</thead>
<tbody>
<tr>
<td>&lt;&lt;</td>
<td>1</td>
</tr>
</tbody>
</table>
````````````````````````````````

### 3.5 Header cells

A cell whose origin is in a header row is a **header cell**. Every other cell is a **body cell**. A header cell must not span into the body rows (rule V7).

```````````````````````````````` example
| Region | Q1  |
|--------|-----|
| ^^     | 100 |
.
<table>
<thead>
<tr>
<th>Region</th>
<th>Q1</th>
</tr>
</thead>
<tbody>
<tr>
<td>^^</td>
<td>100</td>
</tr>
</tbody>
</table>
````````````````````````````````

### 3.6 Invalid tables

A renderer MUST NOT reject a table. When a rule in [Section 5](#5-validation-rules) is broken, the renderer MUST continue as follows:

| Rule | What the renderer does |
|---|---|
| V1 | A span value of 0 counts as 1. If a key appears twice, the first one counts. |
| V2, V3 | The span is cut at the right or bottom edge of the table. |
| V4 | The span is cut to the largest rectangle that overlaps no other cell, columns first and then rows. |
| V5, V6 | The placeholder's text is dropped. |
| V7 | A header cell's rowspan is cut at the last header row. A `^^` that would extend a header cell into the body is kept as literal text. |
| V13 | The marker is kept as literal text. |
| V14 | Empty cells are added at the end of the row, or cells are dropped from its end. |

Text in a covered position is dropped:

```````````````````````````````` example
| Revenue {c:2} | Q2 | Total |
|---------------|----|-------|
| 1             | 2  | 3     |
.
<table>
<thead>
<tr>
<th colspan="2">Revenue</th>
<th>Total</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td>2</td>
<td>3</td>
</tr>
</tbody>
</table>
````````````````````````````````

A span that reaches past the edge is cut:

```````````````````````````````` example
| A | B {c:3} |
|---|---------|
| 1 | 2       |
.
<table>
<thead>
<tr>
<th>A</th>
<th>B</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td>2</td>
</tr>
</tbody>
</table>
````````````````````````````````

A body row that fits neither form is padded or cut, as in GFM:

```````````````````````````````` example
| A | B | C |
|---|---|---|
| 1 | 2 |
| 1 | 2 | 3 | 4 |
.
<table>
<thead>
<tr>
<th>A</th>
<th>B</th>
<th>C</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td>2</td>
<td></td>
</tr>
<tr>
<td>1</td>
<td>2</td>
<td>3</td>
</tr>
</tbody>
</table>
````````````````````````````````

## 4. Cell content

### 4.1 Inlines

Cell text is parsed as inlines by the host Markdown processor, as in GFM. LTEM does not define emphasis, links, code, math or any other inline syntax.

```````````````````````````````` example
| **Revenue** | << |
|-------------|----|
| 100         | 120 |
.
<table>
<thead>
<tr>
<th colspan="2"><strong>Revenue</strong></th>
</tr>
</thead>
<tbody>
<tr>
<td>100</td>
<td>120</td>
</tr>
</tbody>
</table>
````````````````````````````````

### 4.2 Line breaks

Two backslashes (`\\`) in a cell mark a line break. The cell text is split at each `\\` before inline parsing, after the row has been split into cells and each `\|` has become `|` ([Section 2.1](#21-rows-and-cells)). Backslashes pair from left to right, so `a\\\b` is the line `a` followed by the line `\b`. Each part is trimmed and parsed as inlines, and the parts are joined by line breaks (`<br />` in HTML). This holds everywhere in the cell, including inside code spans and math, so version 1.0 has no way to write two backslashes in a row as text ([Appendix B](#appendix-b-not-in-version-10)).

```````````````````````````````` example
| Name  | Address                  |
|-------|--------------------------|
| Alice | 123 Main St \\ Apt 4B    |
.
<table>
<thead>
<tr>
<th>Name</th>
<th>Address</th>
</tr>
</thead>
<tbody>
<tr>
<td>Alice</td>
<td>123 Main St<br />Apt 4B</td>
</tr>
</tbody>
</table>
````````````````````````````````

The paper's lists, checkboxes and formulas inside cells are written this way. Each item is a line of the cell, and its inline text is handled by the host:

```````````````````````````````` example
| Feature | Details                          |
|---------|----------------------------------|
| Speed   | - 2x faster \\ - 50% less memory |
.
<table>
<thead>
<tr>
<th>Feature</th>
<th>Details</th>
</tr>
</thead>
<tbody>
<tr>
<td>Speed</td>
<td>- 2x faster<br />- 50% less memory</td>
</tr>
</tbody>
</table>
````````````````````````````````

### 4.3 Escapes

Besides `\|` ([Section 2.1](#21-rows-and-cells)), three escapes keep text from being read as LTEM notation. They apply to each line of a cell, that is, to each part between `\\` line breaks ([Section 4.2](#42-line-breaks)), after the part is trimmed. In a cell without line breaks, the line is the whole cell.

| Write | To get | Where |
|---|---|---|
| `\<<` | `<<` | the whole line is `\<<` |
| `\^^` | `^^` | the whole line is `\^^` |
| `\{c:2}` | `{c:2}` | the line ends in `\` followed by text in the form of a span attribute ([Section 2.6](#26-span-attributes)), and the `\` is the first character of the line or follows a space or tab |

These are ordinary CommonMark backslash escapes, so renderers without LTEM support also show them as `<<`, `^^` and `{c:2}`. As GFM does for `\|`, an LTEM parser removes their backslash before inline parsing, only in the places listed above. Everywhere else the backslash stays in the cell text; for example `a \{b}` and `x\{c:2}` keep it, and CommonMark then renders them as `a {b}` and `x{c:2}`. `<`, `^` and `{` need no escape outside these places.

```````````````````````````````` example
| Operator | Example     |
|----------|-------------|
| \<<      | x \{c:2}    |
| \^^      | a << b      |
.
<table>
<thead>
<tr>
<th>Operator</th>
<th>Example</th>
</tr>
</thead>
<tbody>
<tr>
<td>&lt;&lt;</td>
<td>x {c:2}</td>
</tr>
<tr>
<td>^^</td>
<td>a &lt;&lt; b</td>
</tr>
</tbody>
</table>
````````````````````````````````

A writer escapes every `|` in cell text as `\|`, and escapes each line of a cell that is exactly `<<` or `^^` (as `\<<`, `\^^`), or that ends in a span attribute ([Section 2.6](#26-span-attributes)), by putting `\` before its `{`. Two more escapes keep a header row from being read as something else:

- A header row that has the form of a delimiter row ([Section 2.2](#22-the-delimiter-row)) would be read as the delimiter row when the table has more than one header row. The writer puts a backslash before the first character of the row's first cell, for example `\-` or `\:--`. It does so in every such header row, also in a table with a single header row.
- A header row above the last one that has the form of a reserved identifier line ([Section 9](#9-reserved-syntax)), such as `| # x |`, would end the header rows. The writer escapes its `#`: `| \# x |`.

These two are CommonMark escapes that an LTEM parser does not remove, so the cell text keeps the backslash. It renders the same.

### 4.4 Math (informative)

Math is a feature of the host processor. Where `$` delimits inline math, the rule of Pandoc's `tex_math_dollars` extension is recommended:

- the opening `$` is followed directly by a character other than a space
- the closing `$` is preceded directly by a character other than a space, and is not followed directly by a digit

Under this rule, prices such as `$10 ~ $20` or `$5/$10` stay text without escapes.

## 5. Validation rules

A validator reports the following problems. It reports each problem with its rule and the grid position (row and column) of the cell, placeholder or marker concerned. For V14, which concerns a whole row, it reports the row only. [Section 3.6](#36-invalid-tables) says how a renderer handles each problem.

| Rule | Problem | Severity |
|---|---|---|
| V1 | A span value is zero, or a key appears more than once in an attribute ([Section 2.6](#26-span-attributes)). | error |
| V2 | A colspan reaches past the last column. | error |
| V3 | A rowspan reaches past the last row. | error |
| V4 | Two cells overlap. | error |
| V5 | In a grid row, a covered position holds a cell that is neither empty nor a marker, and the cell that covers the position has its origin in an earlier row. | error |
| V6 | In a grid row, a covered position holds a cell that is neither empty nor a marker, and the cell that covers the position has its origin in the same row. | error |
| V7 | A header cell spans into the body, or a `^^` would extend a header cell into the body. | error |
| V8–V12 | Reserved for table identifiers and references. | — |
| V13 | A marker has no cell to extend ([Section 3.4](#34-markers)). | error |
| V14 | A row fits neither as a grid row nor as a compact row. | warning |

- **Positions.** Rows and columns count from 0. Rows count header rows and body rows together: the first header row is row 0, and the first body row comes right after the last header row. A cell is reported at its origin, and a placeholder or a marker at its own position. So V4 is reported at the origin of the cell whose span is cut, and V7 at the origin of a header cell whose span is cut or at the position of the `^^`.
- **Severity.** A table is valid if it breaks no rule whose severity is error. A warning marks a row that was padded or cut as in GFM; the table is still valid.
- **Several problems.** A validator reports every problem, in no particular order. One cell can break several rules, and the same rule more than once. For example, a cell `{r:5}` in the only header row of a table of three rows breaks V3 and V7, and `{c:0,c:3}` breaks V1 twice: once for the value 0 and once for the second `c`.
- **Order of checks.** For a content cell, the checks run in the order V1, V2, V3, V7, V4, each on the span that the checks before it left. For a `^^`, V13 comes before V7 ([Section 3.4](#34-markers)), so a `^^` below a header cell that has an `r` attribute breaks V13, not V7.

A span value of 0 and a repeated key (V1):

```````````````````````````````` example
| A {c:0,c:3} | B |
|-------------|---|
| 1           | 2 |
.
<table>
<thead>
<tr>
<th>A</th>
<th>B</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td>2</td>
</tr>
</tbody>
</table>
````````````````````````````````

A rowspan past the last row (V3):

```````````````````````````````` example
| A       | B |
|---------|---|
| x {r:3} | y |
| z |
.
<table>
<thead>
<tr>
<th>A</th>
<th>B</th>
</tr>
</thead>
<tbody>
<tr>
<td rowspan="2">x</td>
<td>y</td>
</tr>
<tr>
<td>z</td>
</tr>
</tbody>
</table>
````````````````````````````````

A colspan that would overlap a cell spanning down from above (V4):

```````````````````````````````` example
| A       | B       | C |
|---------|---------|---|
| x       | y {r:2} | z |
| w {c:2} |         | v |
.
<table>
<thead>
<tr>
<th>A</th>
<th>B</th>
<th>C</th>
</tr>
</thead>
<tbody>
<tr>
<td>x</td>
<td rowspan="2">y</td>
<td>z</td>
</tr>
<tr>
<td>w</td>
<td>v</td>
</tr>
</tbody>
</table>
````````````````````````````````

Text in a grid-row position covered from an earlier row (V5):

```````````````````````````````` example
| A       | B |
|---------|---|
| x {r:2} | y |
| oops    | z |
.
<table>
<thead>
<tr>
<th>A</th>
<th>B</th>
</tr>
</thead>
<tbody>
<tr>
<td rowspan="2">x</td>
<td>y</td>
</tr>
<tr>
<td>z</td>
</tr>
</tbody>
</table>
````````````````````````````````

A header cell whose attribute reaches into the body (V7):

```````````````````````````````` example
| Region {r:2} | Q1  |
|--------------|-----|
| Asia         | 100 |
.
<table>
<thead>
<tr>
<th>Region</th>
<th>Q1</th>
</tr>
</thead>
<tbody>
<tr>
<td>Asia</td>
<td>100</td>
</tr>
</tbody>
</table>
````````````````````````````````

A `^^` below a cell whose attribute fixes its rowspan (V13):

```````````````````````````````` example
| Region {r:1} | Q1  |
|--------------|-----|
| ^^           | 100 |
.
<table>
<thead>
<tr>
<th>Region</th>
<th>Q1</th>
</tr>
</thead>
<tbody>
<tr>
<td>^^</td>
<td>100</td>
</tr>
</tbody>
</table>
````````````````````````````````

## 6. HTML output

A renderer that produces HTML MUST produce the following structure:

- a `<table>` element
- a `<thead>` holding all header rows, and a `<tbody>` holding all body rows. There is no `<tbody>` if the table has no body rows.
- one `<tr>` per row, including a row whose positions are all covered
- one element per cell, in the row of its origin and in column order: `<th>` for header cells, `<td>` for body cells
- a `colspan` or `rowspan` attribute when its value is greater than 1
- the alignment that the delimiter row sets for the cell's origin column, if any, as an `align` attribute or an equivalent `style` declaration (`text-align`). The examples use `align`, as GFM does.

```````````````````````````````` example
| Region | Revenue | <<   |
|:-------|--------:|-----:|
| Asia   | 100     | 120  |
| Total  | 220     | <<   |
.
<table>
<thead>
<tr>
<th align="left">Region</th>
<th colspan="2" align="right">Revenue</th>
</tr>
</thead>
<tbody>
<tr>
<td align="left">Asia</td>
<td align="right">100</td>
<td align="right">120</td>
</tr>
<tr>
<td align="left">Total</td>
<td colspan="2" align="right">220</td>
</tr>
</tbody>
</table>
````````````````````````````````

## 7. Table model

The result of parsing a table can be written as the language-neutral table model defined in [`../ast/`](../ast/). The model records:

- the number of columns, rows and header rows
- the alignment of each column
- for each cell: the row and column of its origin, its colspan and rowspan, and its text

Whether a cell is a header cell is not recorded separately; it follows from the number of header rows. The text is one string: the lines of the cell ([Section 4.2](#42-line-breaks)), each trimmed, joined by line feeds (U+000A). The span attribute and the spaces and tabs before it are removed, `\|` becomes `|`, and the escapes of [Section 4.3](#43-escapes) lose their backslash in the places that section lists. Everything else is kept as written, including other backslash escapes and inline syntax. The text never holds two backslashes in a row.

## 8. Canonical form

A writer SHOULD write tables in the canonical form, which gives every table exactly one text:

- every row is a grid row
- a covered position in the column of its cell's origin is written `^^`; every other covered position is written `<<`
- span attributes are not used
- escapes appear only where [Section 4.3](#43-escapes) asks writers to add them
- each line, the delimiter row included, is `|`, then each cell followed by `|`, with one space before and after the text of each cell: `| a | b |`. An empty cell is therefore two spaces, `|  |`, never `||`, which some Markdown extensions read as a column span.
- a line break in a cell is written ` \\ ` (space, two backslashes, space)
- the delimiter cells are `---`, `:---`, `---:` and `:---:` for no alignment, left, right and center
- lines are separated by a line feed (U+000A)

A writer that places a table in a document SHOULD put a blank line before and after it. Otherwise a pipe-led line directly above it becomes a header row ([Section 2.3](#23-header-rows)).

## 9. Reserved syntax

The paper also describes table identifiers and references for composing tables. Version 1.0 does not define them. It reserves the identifier line, so that a later version can add identifiers:

- A **reserved identifier line** is a line that holds, in this order: an indentation of at most three columns, a pipe, optional spaces or tabs, `#`, one or more spaces or tabs, an identifier, optional spaces or tabs, a pipe, and optional spaces or tabs. An identifier is an ASCII letter or underscore followed by ASCII letters, digits or underscores.
- A reserved identifier line directly above the header rows is not part of the table, and it ends the header rows ([Section 2.3](#23-header-rows)). It stays in the paragraph before the table, together with the lines above it.
- Directly above the delimiter row of a one-column table, the same line is the last header row, as in GFM: its single cell is a header cell. Above a delimiter row with more columns it does not fit ([Section 2.3](#23-header-rows)), and no table forms.
- `@` has no meaning in version 1.0. It is ordinary text, so a later version that gives `@id` a meaning may change how such text renders.

```````````````````````````````` example
| # orders |
| ID   | Customer |
|------|----------|
| 1001 | Alice    |
.
<p>| # orders |</p>
<table>
<thead>
<tr>
<th>ID</th>
<th>Customer</th>
</tr>
</thead>
<tbody>
<tr>
<td>1001</td>
<td>Alice</td>
</tr>
</tbody>
</table>
````````````````````````````````

The same line directly above the delimiter row is a header row:

```````````````````````````````` example
| # orders |
|----------|
| 1001     |
.
<table>
<thead>
<tr>
<th># orders</th>
</tr>
</thead>
<tbody>
<tr>
<td>1001</td>
</tr>
</tbody>
</table>
````````````````````````````````

## 10. Section rows (informative)

The paper's section stacking (feature F5) needs no extra syntax. A section label is a body row whose first cell spans all columns:

```````````````````````````````` example
| Card    | Annual Fee | Rewards |
|---------|------------|---------|
| Travel cards | <<    | <<      |
| Sapphire | $550      | 3x      |
| Cash-back cards | << | <<      |
| Freedom | $0         | 1.5%    |
.
<table>
<thead>
<tr>
<th>Card</th>
<th>Annual Fee</th>
<th>Rewards</th>
</tr>
</thead>
<tbody>
<tr>
<td colspan="3">Travel cards</td>
</tr>
<tr>
<td>Sapphire</td>
<td>$550</td>
<td>3x</td>
</tr>
<tr>
<td colspan="3">Cash-back cards</td>
</tr>
<tr>
<td>Freedom</td>
<td>$0</td>
<td>1.5%</td>
</tr>
</tbody>
</table>
````````````````````````````````

## 11. Tables without header rows (informative)

A table needs at least one header row. A table that has no header, such as a plain grid of data, is written with a single header row of empty cells, and all of its rows are body rows. Tools may read such a header row as "no header"; for example, a converter that is told a table has no header produces it.

```````````````````````````````` example
|  |  |
|--|--|
| Plan A | Expand |
| Plan B | Review |
.
<table>
<thead>
<tr>
<th></th>
<th></th>
</tr>
</thead>
<tbody>
<tr>
<td>Plan A</td>
<td>Expand</td>
</tr>
<tr>
<td>Plan B</td>
<td>Review</td>
</tr>
</tbody>
</table>
````````````````````````````````

## Appendix A. Relation to the paper

This specification follows the paper. It narrows the scope of version 1.0, fills in what the paper leaves open, and makes five choices where the paper's grammar or examples point another way or say nothing. Four of them follow GFM.

### A.1 Choices that differ from the paper

1. **Space before a span attribute.** The paper's grammar (Appendix C.3) reads `Revenue{c:2}` as a cell with a colspan. Here the attribute must be the whole cell or follow a space or tab ([Section 2.6](#26-span-attributes)). The paper's own examples write `Revenue {c:2}`. Reading an attribute that touches the text could turn text in formulas or code into a span.
2. **Outer pipes.** The paper's grammar (Appendix C.2) requires a pipe at the start and end of every row. Here they are optional, as in GFM ([Section 2.1](#21-rows-and-cells)). Rows written with outer pipes, as the paper writes them, are split the same way.
3. **Delimiter cells.** The paper's EBNF (Appendix C.2) allows cells such as `-:-` or a cell without hyphens, and at most one colon, so it cannot write center alignment (`:-:`). Its Lark grammar (Appendix C.9) uses `:?-+:?`. This specification uses the Lark form, which is also the GFM form ([Section 2.2](#22-the-delimiter-row)).
4. **Pipes in math.** The paper's grammar (Appendix C.6) reads `$|r|$` as one cell. Here a pipe that does not split cells must be written `\|`, inside math too, as in GFM ([Section 2.1](#21-rows-and-cells)). Math is handled by the host ([Section 4.4](#44-math-informative)).
5. **Attributes in grid and compact rows.** The paper shows `{c:N}` only in a compact row (Figure 1(b): `| Revenue {c:2} |` above a two-column delimiter row) and gives no example of `{r:M}`. Here both attributes may be written with placeholder cells (grid rows) or without them (compact rows) ([Section 3.2](#32-grid-rows-and-compact-rows)).

### A.2 Additions

- **Scope.** Table identifiers and references (paper Section 4.4 and Appendix C.5) are left for a later version. The identifier line is reserved; `@` stays ordinary text ([Section 9](#9-reserved-syntax)).
- **Cell content.** Cell text is parsed by the host's inline parser. Lists, checkboxes and math (paper Section 4.3) are written with `\\` line breaks and the host's own inline syntax. The paper's grammar excludes `$`, `@`, `{`, `}` and `\` from plain text. This specification does not: those characters are text unless they form LTEM notation in the positions defined above.
- **Grid and compact rows.** [Section 3.2](#32-grid-rows-and-compact-rows) says how to tell the two forms apart, and that a row may contain markers in either form.
- **Markers.** The paper describes `<<` as copying the nearest cell to the left that is not `<<` (Appendix D). [Section 3.4](#34-markers) defines exactly which cell a marker extends. Markers do not extend a cell that has a span attribute in the same direction.
- **Header rows.** Header rows above the last one must begin with a pipe. The last header row must fit the columns, and delimiter rows are tried from the top of a paragraph ([Section 2.3](#23-header-rows)).
- **Escapes.** `\<<`, `\^^` and `\{` ([Section 4.3](#43-escapes)).
- **Validation rules.** The paper's Section 4.5 says that Appendix C gives validation rules V1–V12 and JSON schemas; Appendix C gives the EBNF and Lark grammars only. Rules V1–V7 come from an earlier draft of this specification (December 2024), with one change: V5 and V6 accept either marker as a placeholder. The earlier draft accepted only `^^` (or an empty cell) in a position covered from above, and only `<<` in a position covered from the left. The canonical form needs the change: in a block such as `| ^^ | << |`, the `<<` stands in a position covered from above.

  As in the earlier draft, a header cell does not reach into the body (V7), so a `^^` directly below the header rows stays text ([Section 3.5](#35-header-cells)). V8–V12 are reserved for table references. V13, V14 and the recovery rules for renderers ([Section 3.6](#36-invalid-tables)) are new.
- **Span values.** The paper's grammar requires a positive integer without leading zeros. Here a span value is any run of digits; leading zeros are allowed, and 0 breaks rule V1 ([Section 5](#5-validation-rules)).
- **Table model.** The paper names a "TableStructure JSON" format (Section 4.5) but does not define it. [Section 7](#7-table-model) and the table model in [`ast/`](../ast/) define one, with field names from the earlier draft.
- **Tables without header rows** are written with a header row of empty cells ([Section 11](#11-tables-without-header-rows-informative)). The paper's complexity level L1 is a grid without header designation.
- **HTML output** ([Section 6](#6-html-output)) and the **canonical form** ([Section 8](#8-canonical-form)).
- **Grammar.** The grammar in the paper's Appendix C lets a row end without a line break and lets an empty cell match two rules, so it is ambiguous. In this specification, each row is one line.

## Appendix B. Not in version 1.0

The following are outside version 1.0. A later version may address the first two.

1. **Two backslashes in a row as text.** `\\` always marks a line break ([Section 4.2](#42-line-breaks)), so cell text cannot hold two backslashes in a row, for example a LaTeX formula that uses `\\`. Outside code spans and math, a converter can write such text in another way, for example with the character reference `&#92;` for the first backslash. Inside code spans and math, where CommonMark does not decode character references, there is no such way. The table model never holds `\\` ([Section 7](#7-table-model)).
2. **Row headers.** Version 1.0 has no way to mark header cells in body rows, such as a "Category" column at the left of the body. Header cells are the cells of the header rows ([Section 3.5](#35-header-cells)).
3. **Rendering without LTEM support** (informative). How to write tables that read well in renderers that know only GFM is a matter of guidance, not syntax. The [guide to writing LTEM tables](../docs/guide.md#in-renderers-without-ltem-support) covers it.
4. **Streaming** (informative). How a renderer handles a table that arrives one line at a time, as in chat interfaces, is a matter of guidance. The [guide to writing LTEM tables](../docs/guide.md#showing-ltem-as-it-streams) covers it.

Table identifiers, references, tables inside cells and styling are also outside version 1.0 ([Section 1.3](#13-scope-of-version-10)).
