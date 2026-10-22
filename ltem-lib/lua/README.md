# LTEM for Lua, Pandoc and Quarto

[LTEM](https://hugman.github.io/ltem/) (LLM-friendly Table-Enhanced Markdown) tables in Lua: Markdown pipe tables with merged cells (`<<`, `^^`, `{c:N}`, `{r:M}`, `{c:N,r:M}`), several header rows above the delimiter row, and line breaks in cells (`\\`), as version 1.0 of the [specification](https://github.com/hugman/ltem/blob/main/spec/ltem-spec.md) defines them.

```
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
```

This is a table whose "Region" cell spans two rows and whose "Revenue" cell spans two columns. The workspace holds:

| File | What it is |
|---|---|
| [`ltem.lua`](https://github.com/hugman/ltem/blob/main/ltem-lib/lua/ltem.lua) | The core: a pure Lua 5.4 module without C code. It finds and parses tables, validates them, renders HTML and writes canonical LTEM. It runs in any Lua 5.4, including Pandoc's. |
| [`cli.lua`](https://github.com/hugman/ltem/blob/main/ltem-lib/lua/cli.lua) | A command line for `pandoc lua`, with the protocol of the [conformance tests](https://github.com/hugman/ltem/tree/main/conformance) |
| [`pandoc/ltem-markdown.lua`](https://github.com/hugman/ltem/blob/main/ltem-lib/lua/pandoc/ltem-markdown.lua) | A Pandoc custom reader: Pandoc's Markdown with LTEM tables |
| [`pandoc/ltem-commonmark_x.lua`](https://github.com/hugman/ltem/blob/main/ltem-lib/lua/pandoc/ltem-commonmark_x.lua) | A Pandoc custom reader: `commonmark_x` with LTEM tables |
| [`pandoc/ltem-filter.lua`](https://github.com/hugman/ltem/blob/main/ltem-lib/lua/pandoc/ltem-filter.lua) | A Pandoc filter that turns code blocks with the class `ltem` into tables, for any input format |
| [`pandoc/ltem-pandoc.lua`](https://github.com/hugman/ltem/blob/main/ltem-lib/lua/pandoc/ltem-pandoc.lua) | The module behind the readers and the filter |
| [`_extensions/ltem/`](https://github.com/hugman/ltem/tree/main/ltem-lib/lua/_extensions/ltem) | A Quarto extension with the filter |

Status: version 0.1.0, the first release, for LTEM 1.0. It is not published yet (no LuaRocks package, no Quarto extension registry entry). The API may change before version 1.0.0.

## Requirements

- The core needs Lua 5.4 and nothing else.
- The command line, the readers and the filter need Pandoc 3 with its built-in Lua 5.4. They are tested with Pandoc 3.9, and with Pandoc 3.10 inside Quarto 1.10.19. Earlier Pandoc 3 releases may work but are not tested.
- The Quarto extension is tested with Quarto 1.10.19.

## The core

```lua
local ltem = require("ltem")

for _, result in ipairs(ltem.find_tables(text)) do
  local t = result.table              -- the table model
  for _, p in ipairs(result.problems) do
    print(p.rule, p.row, p.col, p.message)  -- for example: V13  1  0  '<<' has no cell to extend
  end
  print(ltem.render_html(t))          -- HTML with colspan and rowspan
  print(ltem.write(t))                -- canonical LTEM
end
```

| Function | Result |
|---|---|
| `find_tables(markdown)` | The tables of a document: a list of parse results. Like the other LTEM cores, it is a light scan: it splits the text into lines (at `\n`, `\r\n` or `\r`) and blocks, and skips fenced and indented code. It does not look into block quotes or list items; the Pandoc readers do. |
| `parse_table(block, first_line, options)` | The first table in one block of non-blank lines (a string or a list of lines), or a result with `table = nil`. `first_line` is the line number of the block's first line (default 1). `options.ends_body` is a function of a line that returns true where the host Markdown processor starts another block, which ends a table body too. |
| `render_html(table, inline)` | HTML in the form of the specification's examples. `inline` renders one line of cell text; the default `plain_inline` applies CommonMark backslash escapes and HTML escaping only. |
| `write(table)` | The canonical LTEM of a table model, without a final line break, or `nil` and a message if the model breaks the rules of [`ast/table-model.md`](https://github.com/hugman/ltem/blob/main/ast/table-model.md) |
| `check(table)` | The violations of the model rules, as a list of messages |
| `read_model(value)` | A table model from a decoded JSON value, or `nil` and a message. Numbers may be floats with integral values; an `align` entry that is not a string (`nil`, `false` or a JSON null sentinel) means no alignment. |

A parse result has:

- `table`: the table model, as plain Lua tables with the fields of [`ast/table.schema.json`](https://github.com/hugman/ltem/blob/main/ast/table.schema.json): `version`, `rows`, `cols`, `header_rows`, `align` and `cells` (`row`, `col`, `rowspan`, `colspan`, `text`). In `align`, `false` stands for JSON `null` (no alignment).
- `problems`: the validation problems (rules V1–V7, V13, V14), each `{rule, row, col, message, severity}`. `col` is `nil` for V14, which concerns a whole row; `severity` is `"warning"` for V14 and `"error"` otherwise.
- `forms`: how each row was read: `"grid"`, `"compact"` or `"padded"` (V14)
- `sources`: where each cell's source is, in the order of `table.cells`: `{row, col, rowspan, colspan, line, start, stop}`
- `before` and `after`: the lines before the table, which stay a paragraph, and the lines from the first line after it
- `first` and `last`: the line numbers of the table's first and last lines

Grid positions (`row`, `col`) count from 0, as in the specification and the table model. Text positions follow Lua: lines count from 1, and `start` and `stop` are **byte** offsets from 1, so `line:sub(source.start, source.stop)` is the cell's source, without the spaces and tabs around it but with any span attribute and escapes. An empty cell has `stop == start - 1`, at the end of its space between the pipes; a cell added by padding has an empty range at the end of its line. (The Rust core counts the same bytes from 0; the Python core counts code points.)

Strings are UTF-8 and are handled as bytes. All LTEM syntax is ASCII, so a multibyte character is never split or taken for syntax. Only spaces and tabs are trimmed or count as blank; other whitespace, such as the ideographic space (U+3000), is content. Tabs in indentation advance to the next multiple of four columns.

The line helpers `split_lines`, `split_row`, `split_row_spans`, `indentation`, `is_delimiter_row`, `is_upper_header_row`, `starts_block`, `is_thematic_break` and `ends_table_body` are exported for code that finds tables itself. `cell_lines(source)` turns a cell's source into model text, and `escape_notation(line)` adds the escapes `\<<`, `\^^` and `\{` that keep one line of model text from being read as LTEM notation. `VERSION` is `"0.1.0"`, `SPEC_VERSION` and `MODEL_VERSION` are `"1.0"`.

## The command line

```
pandoc lua cli.lua parse    [FILE]           table models of all tables, as JSON
pandoc lua cli.lua render   [FILE]           HTML of all tables
pandoc lua cli.lua validate [FILE] [--json]  validation problems; exit status 1 on errors
pandoc lua cli.lua write    [FILE]           canonical LTEM of table models given as JSON
```

Input is read from FILE, or from standard input. `write` takes one table model or `{"tables": [...]}`. `render` parses cell text as CommonMark inlines with Pandoc's `commonmark` reader.

## The Pandoc readers

```
pandoc -f ltem-lib/lua/pandoc/ltem-markdown.lua input.md -o output.html
pandoc -f ltem-lib/lua/pandoc/ltem-commonmark_x.lua input.md -o output.docx
```

`ltem-markdown.lua` reads Pandoc's Markdown, and `ltem-commonmark_x.lua` reads `commonmark_x`, each with LTEM tables in the place of pipe tables. They accept the extensions of their base format, with the same defaults: `-f ltem-markdown.lua-smart+emoji` works as `-f markdown-smart+emoji` does. The reader files find `ltem.lua` and `ltem-pandoc.lua` next to themselves or one folder up.

For another base format, write a reader file of two lines:

```lua
package.path = "/path/to/ltem-lib/lua/?.lua;/path/to/ltem-lib/lua/pandoc/?.lua;" .. package.path
Extensions, Reader = require("ltem-pandoc").reader("gfm")
```

From Lua code that runs in Pandoc (a filter or another reader), the module `ltem-pandoc` offers the same: `read(text, format, opts)` returns the document, the number of LTEM tables in it and the line numbers of tables left to the base format (see below); `format` is a format spec such as `"commonmark_x+emoji"`. `reader(base)` returns the `Extensions` and `Reader` values of a custom reader, and `inline_renderer(format)` returns an inline renderer for `ltem.render_html` that parses cell text with Pandoc.

What the readers produce:

- **Tables.** A Pandoc `Table` with every header row in the table head, the body rows in one table body, `RowSpan` and `ColSpan` on spanning cells, and the column alignment of the delimiter row. Pandoc's writers then produce real merged cells: `rowspan` and `colspan` in HTML, `\multirow` and `\multicolumn` in LaTeX, and merged cells in Typst, Word and ODT (the tests check these five).
- **Cell text** is parsed with the base format, as inlines, in the context of the whole document: reference links and footnotes defined elsewhere, citations, math and raw TeX work in cells as in Pandoc's own pipe tables. A `\\` line break becomes a `LineBreak`. The LTEM escapes are kept for this parse (a marker kept as text is parsed as `\^^`), so that `^^` never becomes a Pandoc superscript; in CommonMark they render the same.
- **Plain GFM tables** come out as Pandoc's own reader makes them, including column widths: like Pandoc's Markdown reader, `ltem-markdown.lua` gives relative widths from the delimiter row when a line of the table is wider than `--columns` (counting East Asian wide characters as two columns).
- **Captions and attributes.** With Pandoc's Markdown, `: Caption` or `Table: Caption` before or after a table is its caption, as for a pipe table, and `{#id .class}` at the end of the caption sets the table's attributes. A caption line directly below the table ends the table body.
- **Containers.** Tables in block quotes, list items (also Pandoc's fancy and example lists), definition lists and footnotes are found and placed where the base format puts the container's blocks.
- **Delimiter rows that LTEM does not use** (for example below a header row that does not fit, spec Section 2.3) get an escaped pipe (`\|`), which renders the same, so that Pandoc does not make a pipe table of them where LTEM sees none.

### How the readers work

A line scanner follows the container rules of the base format (block quotes, list items, definitions, footnotes) and skips the lines that the base format reads verbatim: fenced and indented code, raw HTML, YAML metadata, Pandoc's title block, raw TeX and Pandoc's grid tables. In each run of paragraph lines it finds the LTEM tables with the core. Each table is then replaced by a placeholder, a one-cell pipe table holding a unique word, and the cell texts are added at the end as paragraphs that start with a unique word. Pandoc reads the whole document once with the base format, and the reader swaps each placeholder for the real table. So everything around the tables, including list tightness and captions, is exactly what the base format makes of a pipe table at that place.

If the base format does not read a placeholder as a table, because it reads those lines as something the scanner does not know, the reader reads the document again with the original lines in place and warns: `ltem: line N: the base format reads these lines as something other than a table`. If a cell's parse reaches beyond its line (an unclosed raw TeX command or HTML comment can), that cell is parsed on its own. If the end of the document takes in the cell section (an unclosed fenced code block or HTML block, or an empty footnote definition at the very end), the document is read again without it and every cell is parsed on its own. A cell parsed on its own does not see the document's reference links and footnotes.

## The filter

```
pandoc -L ltem-lib/lua/pandoc/ltem-filter.lua input.md -o output.html
```

The filter turns code blocks with the class `ltem` into tables, so it works with any reader whose code blocks carry classes, and in Quarto:

````markdown
```{.ltem #tbl-sales}
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|--------:|----:|
| Asia   | 100     | 120 |

: Sales by region
```
````

In reStructuredText, `.. code:: ltem` works the same way. The text of the block is read like the readers read a document, with Pandoc's `markdown` format, or with the format that the metadata field `ltem-format` names (for example `ltem-format: commonmark_x`). The blocks that result replace the code block: usually one table, with its caption. The block's identifier, its other classes and its attributes go to the first table, unless the table sets them itself. A block without an LTEM table stays a code block, with a warning.

## The Quarto extension

Copy the folder `_extensions/ltem` into the `_extensions` folder of a Quarto project (the extension is not in any registry yet), and add the filter to the document or project:

```yaml
filters:
  - ltem
```

Write the tables in code blocks with the class `ltem`, as for the filter. The extension runs the filter at the `pre-ast` entry point, before Quarto's own processing, so a caption with a `tbl-` identifier makes the table a cross-reference target:

````markdown
See @tbl-sales.

```ltem
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|--------:|----:|
| Asia   | 100     | 120 |

: Sales by region {#tbl-sales}
```
````

Inside Quarto the filter reads the block without Pandoc's `table_attributes` extension, as Quarto's own reader does, so that Quarto takes the identifier from the caption.

Quarto cannot use the custom readers (checked with Quarto 1.10.19). An extension's `_extension.yml` can contribute shortcodes, filters, formats, project types, metadata, Reveal.js plugins and engines, but not readers. And Quarto always reads a document with its own Lua reader, `qmd-reader.lua`: it passes the document's `from` option to `pandoc.read`, which knows only Pandoc's built-in formats, so `from: ltem-markdown.lua` fails with "Unknown input format". In Quarto, LTEM tables outside `ltem` code blocks are therefore read by Quarto's Markdown reader, which knows no LTEM.

## Known differences

### The specification's examples

The tests convert all 46 examples of the specification with `pandoc -f <reader> -t html` and compare the result with the expected HTML after the normalization of the conformance tests. The tables match the specification's in every example: the same rows, header rows, spans and alignment. These examples still differ, all because of Pandoc's own features:

| Example | `ltem-markdown.lua` | `ltem-commonmark_x.lua` |
|---|---|---|
| 3 (`$\|r\| < 1$`) | math (`tex_math_dollars`) | math |
| 4 (`:--`) | `smart` makes `--` a dash | the same |
| 5 (an indented delimiter row) | `line_blocks` reads `\| a \| b \|` as a line block; `smart` | `smart` |
| 6 (`Size \| Price` above `- \| -`) | a list needs a blank line before it in Pandoc's Markdown | matches |
| 8, 9 (headings) | the heading gets an `id` (`auto_identifiers`); `smart` | the same (`gfm_auto_identifiers`) |
| 10 (a header row that does not fit) | `line_blocks`; `smart` | `smart` |
| 11, 12 (tables without body rows) | `line_blocks` (11); `smart` makes the header cell `---` a dash (12); the table has an empty table body, which the HTML writer writes as `<tbody></tbody>`, as for Pandoc's own pipe tables | `smart`; the empty `<tbody></tbody>` |
| 22 (`6.1"`) | `smart` makes curly quotes | the same |
| 43 (`\| # orders \|` above a table) | `line_blocks` | matches |
| 46 (a header row of empty cells) | read as no header, as Pandoc's Markdown reads such a pipe table (the specification's Section 11 allows it), so there is no `<thead>` | Pandoc's HTML writer leaves out a header whose cells are all empty |

Without those extensions (`-f ltem-markdown.lua-smart-tex_math_dollars-auto_identifiers-line_blocks` and `-f ltem-commonmark_x.lua-smart-tex_math_dollars-gfm_auto_identifiers`), only examples 6 (markdown), 11, 12 and 46 differ.

### Pandoc's own readers and plain GFM tables

A GFM table without LTEM notation comes out as Pandoc's own reader makes it, with these exceptions, where LTEM follows the specification (and GFM):

- **Pipes in code spans.** LTEM splits cells at every pipe that is not escaped and turns `\|` into `|` everywhere, also in code spans (spec Section 2.1). Pandoc's Markdown keeps a pipe inside a code span in the cell, and keeps the backslash of `\|` there. (`commonmark_x` and `gfm` agree with LTEM.)
- **`\\` is a line break** in an LTEM cell (spec Section 4.2); in Pandoc's pipe tables it is one backslash.
- **A table may begin inside a paragraph** (spec Section 2.3). Pandoc's pipe tables need a blank line before them. The reader reads the document as if each LTEM table were separated from text above it by a blank line, so in a list item, text directly above a table makes the list loose, as a pipe table with the blank line that Pandoc requires would.
- **`1. | a | b |`** above a delimiter row is a list item holding a table, as in CommonMark. Pandoc's Markdown reads such a line as a table row with the text `1.` (also for `a.` and `#.`).
- A header row that LTEM does not fit (spec Section 2.3), such as three cells above two delimiter cells, is text in LTEM; Pandoc's Markdown may make a table of it.

### Limitations

- In Quarto, only the filter can be used (see above).
- Tables inside YAML metadata values are read by the base format, as Pandoc's own pipe tables: the reader leaves YAML alone.
- With the filter, reference links and footnotes defined outside the code block are not available in its cells.
- The scanner models the block rules of CommonMark, and of Pandoc's Markdown where they differ: blank lines before block quotes and lists, fences that need a closing fence, tilde fences that do not interrupt a paragraph, verbatim HTML (`<pre>`, `<script>`, `<textarea>`), line blocks, fenced divs, footnotes, definition lists, fancy and example lists, the title block, YAML metadata, raw TeX (environments, and commands whose braces span lines) and grid tables. Where the base format still reads table lines differently, the table is left to it, with a warning. One such case: with both `markdown_in_html_blocks` and `native_divs` turned off, Pandoc's Markdown keeps the text of HTML blocks verbatim, which the scanner does not model.
- The `sourcepos` extension is turned off, with a warning: positions would point into the rewritten text.
- Column widths for `ltem-markdown.lua` count East Asian wide characters with a list of Unicode ranges that approximates the one Pandoc uses, so a table whose longest line is right at the column limit and holds rare wide or combining characters can get default widths where Pandoc's own reader gives relative ones, or the reverse.

## Development and tests

From the repository root, with Pandoc on the `PATH` (or `PANDOC=/path/to/pandoc`):

```
python3 conformance/tools/run.py --impl "pandoc lua ltem-lib/lua/cli.lua"
pandoc lua ltem-lib/lua/tests/run.lua
QUARTO=/path/to/quarto pandoc lua ltem-lib/lua/tests/run.lua quarto
uv run --directory ltem-lib/python python ../lua/tests/differential.py
```

- `run.py` runs the conformance cases through the command line.
- `tests/run.lua` runs the Lua suites `core`, `conformance`, `reader` and `filter` (or the ones named on the command line; `--filter TEXT` selects tests by name). `conformance` reads `conformance/cases/*.json` directly. `reader` converts the specification's examples with both readers and with a `gfm` reader made as described above, checks the expected differences listed here, compares plain GFM tables (curated and random) with Pandoc's own readers, and tests containers, cell markup, escapes, captions, blocks of the base format and every prefix of incomplete documents. `filter` tests the filter with several input formats and Pandoc's writers, and checks that the Quarto extension's copies are current.
- `quarto` renders a document with the extension to HTML and LaTeX.
- `differential.py` generates random documents with a fixed seed (default 3000 per family) and compares the Lua core with the Python core in-process (table models, problems, row forms, plain HTML, canonical text, cell sources and table lines) and with the Rust command line if it is built, and the readers' tables with the Python core, for documents at the top level, in a block quote and in a list item. It needs the Python workspace in `ltem-lib/python`.

The Quarto extension must be self-contained, so it holds copies of `ltem.lua`, `pandoc/ltem-pandoc.lua` and `pandoc/ltem-filter.lua`. After changing them, run `pandoc lua ltem-lib/lua/tools/sync-extension.lua`.

## License

MIT ([`LICENSE`](https://github.com/hugman/ltem/blob/main/ltem-lib/lua/LICENSE)).
