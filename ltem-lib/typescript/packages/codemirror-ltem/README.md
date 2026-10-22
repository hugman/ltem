# codemirror-ltem

[LTEM](../../../../README.md) tables in [CodeMirror 6](https://codemirror.net/): Markdown pipe tables with merged cells and multi-row headers, recognized, highlighted, validated and edited as tables.

Status: version 0.2.11. For Live Preview of the whole Markdown document, with these tables, see [`codemirror-ltem-live`](../codemirror-ltem-live/). It works with LTEM 1.0 through the `ltem` package (0.1.0) and does not change the LTEM syntax.

```ts
import { EditorView, basicSetup } from "codemirror";
import { ltem } from "codemirror-ltem";

new EditorView({
  doc: "| Region | Revenue | <<  |\n| ^^     | Q1      | Q2  |\n|--------|---------|-----|\n| Asia   | 100     | 120 |\n",
  extensions: [basicSetup, ltem()],
  parent: document.body,
});
```

## What it does

- **Recognizes LTEM tables.** A Lezer Markdown extension hands each paragraph to the LTEM core, which decides where the tables are, so the editor finds exactly the tables that LTEM renderers (such as [`markdown-it-ltem`](../markdown-it-ltem/)) render. Rows, the markers `<<` and `^^`, span attributes, `\\` line breaks and inline Markdown in cells become syntax nodes, with highlighting and folding; pipes are drawn as decorations on the visible lines only. Plain text gets no nodes, so a keystroke in a table of 1,000 rows costs a few milliseconds.
- **Shows problems, with fixes.** Violations of the LTEM rules (specification Section 5) are marked on the cell concerned; a row that fits neither as a grid row nor as a compact row (V14) is a warning. Each problem offers a fix: *Fix table* writes the table so that it reads as it renders; *Keep the text* shrinks a merged cell that covers written text (V5, V6) instead of dropping the text; *Write as text* escapes a marker that has no cell to extend (V13). Messages are in English or Korean, or your own.
- **Tolerates half-written tables.** While an edit briefly breaks the table the cursor is in, its lines keep a table look; problems wait until you stop typing; nothing changes during an IME composition.
- **Edits tables.** Tab, Shift-Tab and Enter move between cells and line up the columns as they go (Tab after the last cell, or Enter below the last row, adds a row; Enter on an empty last row leaves the table). Commands insert, delete and move rows and columns, make rows header rows or body rows, merge cells to the right or down, split them, set column alignment and insert a new table. Wide characters (Hangul, CJK) count as two columns. A command changes only the parts of lines that differ, so it is one small undo step even in a large table.
- **Ranges of cells.** A selection over two or more cells of a table is a range of cells, widened over the merged cells it touches, as in a spreadsheet. Backspace and Delete empty the cells, copy and cut give tab-separated text and an HTML table, and the table menu merges them. Typing, an IME composition, Enter or a paste over a range goes into its cells, so the table keeps its shape.
- **A table menu.** A right click in a table opens a menu of table actions: insert, delete and move rows and columns, make header rows and body rows, merge cells (a range, or one cell with the cell to its right or below) and split them, column alignment, copy, cut, paste, clear, line up. Labels are in English or Korean. An application can add its own actions (`contextMenu: { extraActions }`) or show its own menu instead, from the same list of actions.
- **Header rows and body rows.** *Make header row* makes a row and the rows above it header rows; *Make body row* makes a row and the rows below it body rows. A merged cell across the new line between them is cut there, as no merged cell may cross it (rule V7). Making the first row a body row adds an empty header row above, a table with no header (specification Section 11); in such a table, a row made a header row takes the empty header row's place.
- **Pastes and copies tables.** An HTML table copied from a web page, Word or Excel becomes an LTEM table, merged cells included; so does tab-separated text from a spreadsheet. Pasted into a table, cells fill it from the cursor's cell on, the table grows as needed, and merged cells of a pasted HTML table are merged where they land. Copying a selection that holds whole tables also puts them on the clipboard as HTML tables, so they paste into a word processor with their merged cells. With ranges of cells off (`cellRanges: false`), a selection over cells is text: it is copied as the source it is, with the cells it covers as an HTML table too, and deleted and pasted over as text. A copy of the source pastes back into the source as that source.
- **Shows tables as tables, and edits them there** (optional). A table the cursor is not in is shown rendered, and edited there:
  - A click on a cell edits its text in place, as Markdown source, in a box laid over the cell (so typing does not lay out and paint the table again; a long text grows the box over the cells beside and below it): Enter keeps the text and goes on to the cell below, the caret at the end of its text; Tab and Shift-Tab go on to the next or the previous cell with its text selected, as in the source; Shift-Enter starts a new line in the cell; Escape drops the edit.
  - A drag over cells, a Shift-click or Shift and the arrow keys select a range: Delete, Ctrl-C, Ctrl-X and Ctrl-V work on it, and typing edits the active cell. A drag selects a range also while a cell is edited, and from the cell being edited: the edit is kept, as in a spreadsheet.
  - The table menu works on the shown table, which stays shown, also with a right click on the cell being edited.
  - A change of cell texts only, also one made in another editor of the same document, updates the table where it is drawn: only those cells are drawn again, and an edit or a range stays.
  - Each change is one undo step, and Korean IME input works as in the editor. Moving the cursor into the table, an Alt-click, or the handle left of the table (shown while the mouse is over the table) shows its source; while it is shown, a handle at the same place shows the table again. The handles sit in room left of the table, `--cm-ltem-gutter` wide (22 px by default; the source of a table shown gets the same room): an editor whose content has a left padding of its own can set it to `0px`.
  - A table with no header (an empty header row, specification Section 11) is drawn without that row, and keys and ranges do not go into it.
  - A large table (more than 200 body rows) is drawn in blocks of rows, only near the screen; all of the above works in it the same way.

## Setup

`ltem(config)` turns everything on. It includes Markdown language support with LTEM tables; if you configure the Markdown language yourself, use `ltemMarkdownExtensions` on top of `commonmarkLanguage` and pass `{ markdown: false }`:

```ts
import { commonmarkLanguage, markdown } from "@codemirror/lang-markdown";
import { ltem, ltemMarkdownExtensions } from "codemirror-ltem";

extensions: [markdown({ base: commonmarkLanguage, extensions: ltemMarkdownExtensions }), ltem({ markdown: false })]
```

`ltemMarkdownExtensions` are the extensions of CodeMirror's `markdownLanguage` (GFM, subscript, superscript, emoji) with LTEM tables in place of GFM tables. They cannot be added to `markdownLanguage` itself, because its GFM table rule that ends a paragraph before a delimiter row cannot be removed.

The component adds LTEM tables to CodeMirror's Markdown and changes nothing else in it: `ltemMarkdownLanguage(config)` is CodeMirror's `markdown()` with LTEM tables in place of GFM tables. For Markdown read as markdown-it reads it, and parsed quicker in a large document, use `codemirror-ltem-live`'s language.

| Option | Default | Effect |
|---|---|---|
| `markdown` | `true` | Markdown language with LTEM tables; options of `markdown()` except `base` |
| `lint` | `true` | Validation problems; `{ delay, messages }`, where `messages` is `"en"`, `"ko"` or a function of the problem |
| `paste` | `true` | HTML table and tab-separated text paste; `{ inline: "markdown" \| "plain", onWarnings, images }`. `images(src, alt)` gives an image of a pasted cell a new address (for example a file the application saves it to), or null to keep only its description; without it, embedded `data:` images are left out. HTML with text around its tables is left to the editor, and so is its plain text, even with tabs in it |
| `copy` | `true` | HTML on the clipboard for whole tables; `{ renderMarkdown, renderInline, borders }` |
| `contextMenu` | `true` | The table menu on a right click; `{ messages: "en" \| "ko" \| function, show, renderInline, readClipboard }`; `show(event, actions, target)` shows your own menu; `readClipboard()` reads the clipboard for Paste (default: the browser's) |
| `keymap` | `true` | The keys below |
| `cellRanges` | `true` | Ranges of cells: a selection over two or more cells works on cells; `false` leaves selections as text (deleted, copied and pasted as written; copied with an HTML table too) |
| `autoAlign` | `true` | Tab, Shift-Tab and Enter line up the columns, when that changes nothing but spacing |
| `monospace` | `true` | Table rows in a monospace font, so that columns line up |
| `widgets` | `false` | Tables shown as tables; `{ renderInline, editInPlace, openLink, revealSource, onCellHover, onCellClick }`: `renderInline` renders cell text, `editInPlace: false` makes a click show the source instead of editing on the table, `openLink(url)` opens a link of a cell on Ctrl-click, `revealSource: "altClick"` keeps a table shown as a table with the cursor in it (its source shows on an Alt- or Ctrl-click, until the cursor leaves it), `onCellHover(cell)` and `onCellClick(cell)` report the cell under the mouse (`{ table, row, col }`), `sourceButton: false` leaves out the handles to the source and back to the table, `messages` (`"en"`, `"ko"` or a function) gives their names and hints |

Keys, inside a table only (elsewhere other bindings apply):

| Key | Action |
|---|---|
| Tab / Shift-Tab | Next / previous cell, its text selected; Tab after the last cell adds a row |
| Enter | The cell below; below the last row, a new row; on an empty last row, leave the table |
| Shift-Enter | A line break inside the cell (`\\`) |
| Alt-ArrowUp / Alt-ArrowDown | Move the row |
| Alt-ArrowLeft / Alt-ArrowRight | Move the column |
| Alt-Shift-F | Line up the columns |
| Backspace / Delete | On a range of cells: empty the cells |

Lining up as you move changes only spaces, so it never changes how a table is written; a table whose rows have different numbers of cells (compact rows, rows with a cell too many or too few) is left alone until you line it up yourself (Alt-Shift-F), which writes it in canonical form.

## API

| Export | Purpose |
|---|---|
| `ltem(config)` | Everything above |
| `ltemMarkdown`, `ltemMarkdownExtensions`, `ltemMarkdownLanguage(options)` | The Lezer extension and language support |
| `ltemLinter(options)`, `ltemDiagnostics(state, from, to, options)` | Problems as diagnostics, with fixes |
| `fixTable(state, table)`, `keepCoveredText(state, table, row, col)` | The fixes as transaction specs |
| `editCellText(state, table, row, col, text)`, `editCellTexts(state, table, edits)` | Setting cells' texts, escaped as the LTEM writer escapes them, as a transaction spec |
| `replaceTableSpec(state, table, next, options)`, `fillCellsSpec(state, table, at, texts, options)` | Writing a changed table model back; filling cells |
| `parseTsv(text)`, `tsvTable(rows)`, `rangeTsv(table, range)`, `rangeHtml(table, range)` | Tab-separated text and HTML tables for ranges of cells |
| `ltemPaste(options)`, `pasteTables(state, { html, text }, options, target?)` | Pasting HTML tables and tab-separated text, as tables or into tables |
| `ltemCellSelection()`, `selectedCells(state)`, `mergeSelectedCells`, `clearSelectedCells` | Ranges of cells in the source |
| `ltemContextMenu(options)`, `openTableMenu(view, event, target)`, `closeTableMenu()` | The table menu |
| `ltemTableActions(target, options)`, `ltemCellTargetAt(view, pos)` | The table actions for a cell or a range (`id`, `label`, `group`, `shortcut`, `enabled`, `checked`, `run(view)`), for your own menu or toolbar |
| `ltemCopy(options)`, `copyHtml(state, from, to, options)` | Copy and cut with HTML tables |
| `ltemTableWidgets(options)` | Tables shown as tables |
| `setLtemCellMarks`, `ltemCellMarks`, `LtemCellMark` | Marks on cells of shown tables: `view.dispatch({ effects: setLtemCellMarks.of([{ table, row, col, class, title }]) })`; the widgets put them on the cells, also when a table is drawn again. `ltem()` keeps them while the table widgets are off |
| `revealTableSource`, `revealedTables` | The tables whose source an Alt-click showed (with `revealSource: "altClick"`) |
| `ltemMarkdownLanguage(config)` | CodeMirror's Markdown language with LTEM tables |
| `ltemKeymap`, `ltemAutoAlign` | Key bindings; the facet that turns lining up on Tab and Enter on or off |
| `nextCell`, `previousCell`, `enterInTable`, `insertCellLineBreak`, `formatTable`, `insertRowAbove`, `insertRowBelow`, `makeHeaderRow`, `makeBodyRow`, `deleteRowAt`, `insertColumnLeft`, `insertColumnRight`, `deleteColumnAt`, `moveRowUp`, `moveRowDown`, `moveColumnLeft`, `moveColumnRight`, `mergeRight`, `mergeDown`, `splitCellAt`, `alignLeft`, `alignCenter`, `alignRight`, `alignNone`, `insertTable(options)` | Commands (`StateCommand`) |
| `tableAt(state, pos)`, `tablesIn(state, from, to)`, `cellAt(table, pos)` | The table and cell at a position, with the table model from the LTEM core |
| `analyzeTable(lines)` | Where each written cell sits in the grid, also in compact rows |
| `writeAligned(table)`, `displayWidth(text)` | A table model written in canonical form with lined-up columns; the width of text in a monospace font |
| `insertRow`, `deleteRow`, `insertColumn`, `deleteColumn`, `makeHeaderRows`, `makeBodyRows`, `hasEmptyHeader`, `mergeCells`, `splitCell`, `uncoverCell`, `moveRow`, `moveColumn`, `alignColumn`, `emptyTable` | The same edits on a table model |
| `cellRange`, `cellsIn`, `mergeRange`, `clearRange`, `rangeTexts`, `rangeTable`, `fillCells`, `pasteTable` | Ranges of cells in a table model |
| `alignText(lines, delimiter)`, `analyzeTable`, `deriveAnalysis`, `updateAnalysis` | Lining up a table by its spaces only; reading a table, and updating that reading after a small edit |
| `lineChanges(doc, from, to, insert)` | A replacement as changes of only the parts of lines that differ |
| `changedRegions(tr)`, `selectionLines(state)` | Where block decorations may have to change after a transaction, for block decorations of your own that follow the document as the table widgets do |
| `NODE`, `ltemTags`, `ltemHighlightStyle`, `ltemTheme` | Node names, highlighting tags and styles. `ltem()` adds `ltemHighlightStyle` as a fallback, like CodeMirror's default style; an editor with its own highlight style styles the LTEM tags through their parent tags or adds `syntaxHighlighting(ltemHighlightStyle)` |

**Cell numbers.** The cells of a shown table carry `data-row` and `data-col`: the grid row and column of the cell's origin, rows counting header rows from 0. They are the same as markdown-it-ltem's `meta.ltem.row` and `.col` on the cell's token, and as the rows and columns of `LtemCellMark`, `LtemCellRef` and the table model, so an application can relate a cell of the editor to the same cell of its rendered view. This is a stable part of the component's interface.

Commands write the whole table back in canonical form (specification Section 8) with lined-up columns, so a table written with span attributes or compact rows comes back with markers in grid rows. The table is the same.

## Shadow DOM and content security policy

The component works with the editor in a Shadow DOM and under a content security policy that allows no inline styles (`style-src 'self'`): its styles are a CodeMirror theme (a constructed style sheet), it writes no `style` attributes into markup, and positions it computes (the menu, blocks of a large table) are set through the DOM's style properties, which the policy allows. The browser tests run in such a page too (`LTEM_SHADOW=1 npm run test:browser`).

## Speed

Main-thread work per action in headless Chromium (median, milliseconds; `npm run bench`): the transaction, the editor's DOM update and the browser's layout. Next to it, CodeMirror's own Markdown support with GFM tables on the same documents:

| Document | Typing in a cell | GFM tables | Moving the cursor | GFM tables | Tab, lining up |
|---|---|---|---|---|---|
| One table, 50 rows x 10 columns | 2.5 | 3.2 | 1.1 | 1.2 | 5.8 |
| One table, 200 x 30 | 5.1 | 11.2 | 0.9 | 1.3 | 14 |
| One table, 1,000 x 10 | 7.2 | 20.4 | 1.2 | 0.8 | 15 |
| 50 tables of 50 x 10 | 2.2 | 6.1 | 1.0 | 0.8 | 5.9 |
| 1 MB of text with tables | 4.7 | 5.7 | 1.5 | 0.9 | 8.4 |

The first Tab in a table that was never lined up rewrites every row: 10 to 60 ms, once. Later Tabs read the table again only where it changed. Timings of both editors vary by about a millisecond between runs. Most of the time of typing is CodeMirror's parsing of the Markdown; `codemirror-ltem-live`'s language, which does not parse code blocks with their languages inside the Markdown parse, takes 1.2 to 2.2 ms in these documents.

Tables shown as tables: a document with a 5,000-row table opens in about 180 ms with the table shown (about 80 rows of it drawn), and typing in the text above it costs about 1.2 ms per key. Typing in a cell being edited costs the browser 3.7 ms per key in a table of 200 x 30 and 1.5 ms in one of 1,000 x 10 (all main-thread work, layout and paint included). A change of cell texts made elsewhere (another editor of the same document) updates a shown table of 200 x 30 in place: about a third of the work of drawing it again.

## Tests

```
npm test             # the 46 specification examples, random documents, analyses after edits, cell positions, commands, ranges, actions, fixes, paste, copy, inline syntax of extensions in cells
npm run test:browser # Korean IME composition, tables shown as tables and edited there, ranges, the table menu, copy, cut and paste, fixes, in headless Chromium
npm run bench        # time per keystroke (Node) and work per action (Chromium) in documents with large tables
```

The specification examples and random documents check that the editor finds the same tables, at the same lines, as `markdown-it-ltem`, with the same structure as the LTEM core. The browser tests send IME composition events through the Chromium DevTools protocol, including cases reported in other editors (characters repeated in table cells, Enter during composition, characters lost at a line-wrap point).
