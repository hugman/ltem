// Example documents of the site's playground. All tables are valid LTEM, except in "Problems".

export interface Example {
  id: string
  title: string
  text: string
}

export const EXAMPLES: Example[] = [
  {
    id: 'merged',
    title: 'Merged cells',
    text: `# LTEM tables

LTEM extends Markdown pipe tables with merged cells and several header rows.
\`<<\` merges a cell with the cell to its left, \`^^\` with the cell above.

| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
| Europe | 90      | 110 |

Put the cursor in a table and use the table tools above. **Tab**, **Shift+Tab** and
**Enter** move between cells and line up the columns; **Alt+arrow keys** move rows
and columns. Right-click a table for its menu; drag over cells to select a range.
In **Live preview** (or Ctrl+E), click a cell to edit it in place.

Paste a table copied from a web page, Word or Excel: it becomes an LTEM table,
merged cells included. Copy a whole table and paste it into a word processor: it
stays a table.
`,
  },
  {
    id: 'budget',
    title: 'Budget report',
    text: `## Budget

| (in millions) | <<      | <<    | <<     |
| Category      | 2024    | 2025  | Change |
|---------------|--------:|------:|-------:|
| Staff         | 1,200   | 1,350 | 150    |
| Operations    | 800     | 760   | -40    |
| Projects      | Ongoing | <<    | <<     |
| ^^            | 2,100   | 2,400 | 300    |
| Total         | 4,100   | 4,510 | 410    |

The unit spans the whole first header row, "Projects" covers two rows, and
"Ongoing" is a section label across three columns.
`,
  },
  {
    id: 'notation',
    title: 'All notation',
    text: `## Span attributes and compact rows

The same merged cell written with markers, with an attribute and placeholders,
and with an attribute in a compact row:

| Summary | << | Note |
| ^^      | << | Q4   |
|---------|----|------|
| 1       | 2  | 3    |

| Summary {c:2,r:2} |   | Note |
|                   |   | Q4   |
|-------------------|---|------|
| 1                 | 2 | 3    |

| Summary {c:2,r:2} | Note |
| Q4 |
|----|----|----|
| 1  | 2  | 3  |

## Line breaks, inline Markdown and escapes

| Feature | Details                              |
|---------|--------------------------------------|
| Speed   | - 2x faster \\\\ - **50%** less memory |
| Escape  | \\<< and \\^^ are text here, so is x \\{c:2} |
| Pipe    | a \\| b                               |
`,
  },
  {
    id: 'problems',
    title: 'Problems',
    text: `## Validation

The editor marks problems with the table rules. Hover over a marked cell.

| A | B |
|---|---|
| << | 1 |
| x {r:5} | 2 |
| 1 | 2 | 3 |
| 4 |
`,
  },
  {
    id: 'live',
    title: 'A whole document',
    text: `# Live preview

Choose **Live preview** (or press *Ctrl+E*): Markdown marks show only where the
cursor is, and the rest of the document looks as it will be rendered.
==Highlights== and the other features can be switched under Settings.

## Lists and tasks

- Plain items, and items with \`code\` or [links](https://example.com)
- [x] Tasks: click the box to tick it
- [ ] Ctrl-click a link to open it

> Block quotes keep their bar, and
> their marks show on the line you edit.
> > A nested quote has a bar for each level.

A line can end with a line break
made with two spaces, shown as a small mark. Footnotes are numbered as in
the preview[^lp] and can be written inline too^[like this one].

\`\`\`js
const table = parseTable(lines);
\`\`\`

---

| Item       | 2024  | <<    |
| ^^         | H1    | H2    |
|------------|------:|------:|
| Staff      | 1,200 | 1,350 |
| Operations | 800   | 760   |

Tables are LTEM tables: click a cell to edit it, drag over cells to select them,
right-click for the table menu.

[^lp]: Ctrl-click a footnote to go to its definition, and back.
`,
  },
]
