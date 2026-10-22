--- Tests of the Pandoc readers: the specification's examples as whole
-- documents, plain GFM tables against Pandoc's own readers, containers,
-- inline markup, escapes, captions, host blocks and incomplete input.

local support = require("support")
local ltem = require("ltem")
local ltem_pandoc = require("ltem-pandoc")
local test, eq, ok = support.test, support.eq, support.ok

local READERS = support.lua_dir .. "/pandoc/"

local function native(doc)
  return pandoc.write(doc, "native")
end

local function read(text, format)
  return (ltem_pandoc.read(text, format))
end

-- The tables of a document as grids (see support.grid_structure).
local function grids(doc)
  local result = {}
  doc:walk {
    Table = function(t)
      result[#result + 1] = support.grid_structure(t)
    end,
  }
  return result
end

local function blocks_of(doc)
  local kinds = {}
  for i, b in ipairs(doc.blocks) do
    kinds[i] = b.t
  end
  return table.concat(kinds, " ")
end

---------------------------------------------------------------------------
-- The specification's examples, as whole documents through the command line
---------------------------------------------------------------------------

-- Every example whose HTML differs from the specification's, with the
-- reason. All of them come from Pandoc's own features, not from the tables.
local REASONS = {
  math = "tex_math_dollars reads $...$ as math",
  smart = "smart turns -- and --- into dashes and \" into curly quotes",
  line_blocks = "line_blocks reads a line that starts with `| ` as a line block",
  list = "in Pandoc's Markdown a list needs a blank line before it",
  identifiers = "the heading gets an id (auto_identifiers)",
  empty_body = "a table without body rows has an empty TableBody, written <tbody></tbody>, as for a pipe table",
  empty_header = "Pandoc leaves out a header row of empty cells: the Markdown reader reads it as no header, as in "
    .. "a pipe table, and the HTML writer does not write it (spec Section 11 allows reading it as no header)",
}

local CONFIGURATIONS = {
  {
    reader = "ltem-markdown.lua",
    differ = {
      [3] = { "math" }, [4] = { "smart" }, [5] = { "line_blocks", "smart" }, [6] = { "list" },
      [8] = { "identifiers", "smart" }, [9] = { "identifiers", "smart" }, [10] = { "line_blocks", "smart" },
      [11] = { "line_blocks", "smart", "empty_body" }, [12] = { "smart", "empty_body" }, [22] = { "smart" },
      [43] = { "line_blocks" }, [46] = { "empty_header" },
    },
  },
  {
    reader = "ltem-commonmark_x.lua",
    differ = {
      [3] = { "math" }, [4] = { "smart" }, [5] = { "smart" }, [8] = { "identifiers", "smart" },
      [9] = { "identifiers", "smart" }, [10] = { "smart" }, [11] = { "smart", "empty_body" },
      [12] = { "smart", "empty_body" }, [22] = { "smart" }, [46] = { "empty_header" },
    },
  },
  {
    reader = "ltem-markdown.lua-smart-tex_math_dollars-auto_identifiers-line_blocks",
    differ = { [6] = { "list" }, [11] = { "empty_body" }, [12] = { "empty_body" }, [46] = { "empty_header" } },
  },
  {
    reader = "ltem-commonmark_x.lua-smart-tex_math_dollars-gfm_auto_identifiers",
    differ = { [11] = { "empty_body" }, [12] = { "empty_body" }, [46] = { "empty_header" } },
  },
}

local examples = support.spec_examples()

for _, config in ipairs(CONFIGURATIONS) do
  test("spec examples, pandoc -f " .. config.reader .. " -t html", function()
    local differing = {}
    for _, ex in ipairs(examples) do
      local html = support.run_pandoc({ "-f", READERS .. config.reader, "-t", "html" }, ex.ltem)
      local n = math.tointeger(ex.example)
      if not support.equal(support.normalize_html(html), support.normalize_html(ex.html)) then
        differing[#differing + 1] = n
      end
      ok(not config.differ[n] or not support.equal(support.normalize_html(html), support.normalize_html(ex.html)),
        ("example %d was expected to differ (%s) but does not"):format(n, table.concat(config.differ[n] or {}, ", ")))
    end
    local expected = {}
    for n in pairs(config.differ) do
      expected[#expected + 1] = n
      for _, reason in ipairs(config.differ[n]) do
        ok(REASONS[reason], "unknown reason " .. reason)
      end
    end
    table.sort(expected)
    eq(differing, expected, "examples whose HTML differs")
  end)
end

-- The tables themselves match the specification in every example: rows,
-- columns, header rows, alignment and spans. Every table is placed at once:
-- none is left to the base format.
for _, format in ipairs { "markdown", "commonmark_x", "gfm" } do
  test("spec examples, table structure, base format " .. format, function()
    for _, ex in ipairs(examples) do
      local doc, _, skipped = ltem_pandoc.read(ex.ltem, format)
      eq(skipped, {}, ("example %d: tables left to the base format"):format(math.tointeger(ex.example)))
      local got = grids(doc)
      local want = {}
      for i, m in ipairs(ex.tables) do
        local model = assert(ltem.read_model(m))
        local cells = {}
        for k, c in ipairs(model.cells) do
          cells[k] = { row = c.row, col = c.col, rowspan = c.rowspan, colspan = c.colspan }
        end
        local align = {}
        for c, a in ipairs(model.align) do
          align[c] = a or pandoc.json.null
        end
        want[i] = {
          rows = model.rows, cols = model.cols, header_rows = model.header_rows, align = align, cells = cells,
        }
        -- Pandoc's Markdown reads a header row of empty cells as no header.
        local empty_header = format == "markdown" and model.header_rows == 1
        for _, c in ipairs(model.cells) do
          empty_header = empty_header and (c.row > 0 or c.text == "")
        end
        if empty_header then
          local body = {}
          for _, c in ipairs(cells) do
            if c.row > 0 then
              body[#body + 1] = { row = c.row - 1, col = c.col, rowspan = c.rowspan, colspan = c.colspan }
            end
          end
          want[i].rows, want[i].header_rows, want[i].cells = model.rows - 1, 0, body
        end
      end
      for _, t in ipairs(got) do
        for _, c in ipairs(t.cells) do
          c.text = nil
        end
      end
      eq(got, want, ("example %d"):format(math.tointeger(ex.example)))
    end
  end)
end

test("a custom reader with another base format (gfm), as the README describes", function()
  pandoc.system.with_temporary_directory("ltem-test", function(dir)
    local path = pandoc.path.join { dir, "ltem-gfm.lua" }
    support.write_file(path, ([[
package.path = "%s/?.lua;%s/pandoc/?.lua;" .. package.path
Extensions, Reader = require("ltem-pandoc").reader("gfm")
]]):format(support.lua_dir, support.lua_dir))
    local differing = {}
    for _, ex in ipairs(examples) do
      local html = support.run_pandoc({ "-f", path .. "-tex_math_dollars-gfm_auto_identifiers", "-t", "html" }, ex.ltem)
      if not support.equal(support.normalize_html(html), support.normalize_html(ex.html)) then
        differing[#differing + 1] = math.tointeger(ex.example)
      end
    end
    eq(differing, { 11, 12, 46 })
  end)
end)

---------------------------------------------------------------------------
-- Plain GFM tables come out as Pandoc's own readers make them
---------------------------------------------------------------------------

local PLAIN_DOCUMENTS = {
  "| a | b |\n|---|---|\n| 1 | 2 |\n",
  "| Left | Center | Right | None |\n|:-----|:------:|------:|------|\n| 1 | 2 | 3 | 4 |\n",
  "Text\n\n| *em* | **strong** | `code` | [link](http://example.com) |\n|---|---|---|---|\n| a \\| b | x | y | z |\n",
  "| a |\n|---|\n",
  "| a | b |\n|---|---|\n|  | 2 |\n| 3 |  |\n",
  "a | b\n--|--\n1 | 2\n",
  "| 한국어 | 東京 |\n|---|---|\n| \u{3000}x | y |\n",
  "| a | b |\n|---|---|\n| 1 | 2 |\n\n| c |\n|---|\n| 3 |\n",
  "> | a | b |\n> |---|---|\n> | 1 | 2 |\n",
  "- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n- next\n",
  "| a | b |\n|---|-----------|\n| " .. ("word "):rep(16) .. "| 2 |\n",
  "| a | b |\n|:-:|-|\n| " .. ("한국어 "):rep(12) .. "| 2 |\n",
  "| $x^2$ | b |\n|---|---|\n| 1 | 2 |\n",
  "| a[^1] | b |\n|---|---|\n| 1 | 2 |\n\n[^1]: A note.\n",
  "| [x][r] | b |\n|---|---|\n| 1 | 2 |\n\n[r]: http://example.com\n",
  "| a | b |\n|---|---|\n| 1 | 2 |\n\n: A caption\n",
  "Table: A caption\n\n| a | b |\n|---|---|\n| 1 | 2 |\n",
  "| a | b |\n|---|---|\n| 1 | 2 |\n\n: A caption {#tbl-x .wide}\n",
  "  | a | b |\n  |---|---|\n  | 1 | 2 |\n",
}

local function plain_document_test(format, docs)
  return function()
    for _, doc in ipairs(docs) do
      eq(native(read(doc, format)), native(pandoc.read(doc, format)), ("document %q"):format(doc))
    end
  end
end

test("plain GFM tables like Pandoc's markdown reader", plain_document_test("markdown", PLAIN_DOCUMENTS))
test("plain GFM tables like Pandoc's commonmark_x reader", plain_document_test("commonmark_x", PLAIN_DOCUMENTS))
test("plain GFM tables like Pandoc's gfm reader", plain_document_test("gfm", PLAIN_DOCUMENTS))

-- Random plain tables: alignments, inline markup, empty cells, long and wide
-- lines (column widths), in documents with text around them.
local function random_plain_documents(seed, count)
  math.randomseed(seed)
  local texts = { "a", "Region", "**b**", "*c*", "`d`", "[e](http://e.x)", "1.5", "한국어 텍스트", "x y z", "",
    "a \\| b", "~~s~~", "$5", "<b>x</b>", "東京" }
  local docs = {}
  for n = 1, count do
    local cols = math.random(1, 5)
    local lines = {}
    local function row()
      local cells = {}
      for c = 1, cols do
        cells[c] = texts[math.random(#texts)]
        if math.random() < 0.05 then
          cells[c] = (cells[c] .. " "):rep(math.random(5, 15))
        end
      end
      return "| " .. table.concat(cells, " | ") .. " |"
    end
    lines[1] = row()
    local delimiters = {}
    for c = 1, cols do
      local d = ("-"):rep(math.random(1, 8))
      local kind = math.random(4)
      delimiters[c] = kind == 1 and ":" .. d or kind == 2 and d .. ":" or kind == 3 and ":" .. d .. ":" or d
    end
    lines[2] = "|" .. table.concat(delimiters, "|") .. "|"
    for _ = 1, math.random(0, 4) do
      lines[#lines + 1] = row()
    end
    docs[n] = "Before\n\n" .. table.concat(lines, "\n") .. "\n\nAfter\n"
  end
  return docs
end

local random_docs = random_plain_documents(7, 300)
test("random plain GFM tables like Pandoc's markdown reader", plain_document_test("markdown", random_docs))
test("random plain GFM tables like Pandoc's commonmark_x reader", plain_document_test("commonmark_x", random_docs))

test("known differences from Pandoc's markdown reader for plain tables", function()
  -- LTEM splits cells at every unescaped pipe and turns `\|` into `|`
  -- everywhere, also in code spans (spec 2.1), as GFM does; Pandoc's Markdown
  -- keeps pipes in code spans together and keeps the backslash there.
  local code = "| `a\\|b` | `c|d` |\n|---|---|---|\n| 1 | 2 | 3 |\n"
  local cells = grids(read(code, "markdown"))[1].cells
  eq({ cells[1].text, cells[2].text, cells[3].text }, { "a|b", "`c", "d`" })
  ok(native(read(code, "markdown")) ~= native(pandoc.read(code, "markdown")))
  for _, format in ipairs { "commonmark_x", "gfm" } do -- these agree with LTEM
    eq(native(read(code, format)), native(pandoc.read(code, format)))
  end
  -- Two backslashes in a cell are a line break (spec 4.2), one literal
  -- backslash in Pandoc's pipe tables.
  eq(grids(read("| a\\\\b |\n|---|\n", "markdown"))[1].cells[1].text, "a\nb")
  -- Pandoc's Markdown reads `1. | a |` above a delimiter row as a table row
  -- with the text "1."; the reader keeps the list item, as CommonMark does.
  local listed = "1. | a | b |\n   |---|---|\n   | 1 | 2 |\n"
  eq(blocks_of(read(listed, "markdown")), "OrderedList")
  eq(blocks_of(pandoc.read(listed, "markdown")), "Table")
  eq(native(read(listed, "commonmark_x")), native(pandoc.read(listed, "commonmark_x")))
  -- LTEM tables may begin inside a paragraph (spec 2.3); Pandoc's tables
  -- need a blank line before them.
  eq(blocks_of(read("Text\n| a |\n|---|\n", "markdown")), "Para Table")
  eq(blocks_of(pandoc.read("Text\n| a |\n|---|\n", "markdown")), "Para")
end)

---------------------------------------------------------------------------
-- Containers
---------------------------------------------------------------------------

local SPAN_TABLE = table.concat({
  "| Region | Revenue | <<  |",
  "| ^^     | Q1      | Q2  |",
  "|--------|---------|-----|",
  "| Asia   | 1       | 2   |",
}, "\n")

local function spans(doc)
  local t = grids(doc)[1]
  local result = {}
  for k, c in ipairs(t.cells) do
    result[k] = ("%s %dx%d"):format(c.text, c.rowspan, c.colspan)
  end
  return table.concat(result, ", ")
end

local SPANS = "Region 2x1, Revenue 1x2, Q1 1x1, Q2 1x1, Asia 1x1, 1 1x1, 2 1x1"

local function prefixed(prefix, continuation, text)
  local out = {}
  for line in (text .. "\n"):gmatch("([^\n]*)\n") do
    out[#out + 1] = (#out == 0 and prefix or continuation) .. line
  end
  return table.concat(out, "\n")
end

for _, format in ipairs { "markdown", "commonmark_x" } do
  test(format .. ": a table in a block quote", function()
    local doc = read(prefixed("> ", "> ", SPAN_TABLE), format)
    eq(blocks_of(doc), "BlockQuote")
    eq(doc.blocks[1].content[1].t, "Table")
    eq(spans(doc), SPANS)
  end)

  test(format .. ": a table in a nested block quote and in a quote in a list item", function()
    eq(spans(read(prefixed("> > ", "> > ", SPAN_TABLE), format)), SPANS)
    local doc = read(prefixed("- > ", "  > ", SPAN_TABLE), format)
    eq(blocks_of(doc), "BulletList")
    eq(doc.blocks[1].content[1][1].t, "BlockQuote")
    eq(spans(doc), SPANS)
  end)

  test(format .. ": a table as the first block of a list item keeps the list tight", function()
    local doc = read(prefixed("- ", "  ", SPAN_TABLE) .. "\n- next\n", format)
    local items = doc.blocks[1].content
    eq(items[1][1].t, "Table")
    eq(items[2][1].t, "Plain")
    eq(spans(doc), SPANS)
    -- the same as a native pipe table there
    local plain = "- | a | b |\n  |---|---|\n  | 1 | 2 |\n- next\n"
    eq(native(read(plain, format)), native(pandoc.read(plain, format)))
  end)

  test(format .. ": a table after text in a list item, as Pandoc reads a pipe table after a blank line", function()
    local doc = read("- item\n" .. prefixed("  ", "  ", SPAN_TABLE) .. "\n- next\n", format)
    eq(spans(doc), SPANS)
    local plain = "- item\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n- next\n"
    local with_blank = "- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n- next\n"
    eq(native(read(plain, format)), native(pandoc.read(with_blank, format)))
  end)

  test(format .. ": tables in ordered and nested lists", function()
    eq(spans(read(prefixed("1. ", "   ", SPAN_TABLE), format)), SPANS)
    eq(spans(read("- a\n" .. prefixed("  - ", "    ", SPAN_TABLE), format)), SPANS)
    eq(spans(read(prefixed("10) ", "    ", SPAN_TABLE), format)), SPANS)
  end)

  test(format .. ": a table in a list item indented with a tab", function()
    eq(spans(read(prefixed("-\t", "\t", SPAN_TABLE), format)), SPANS)
  end)

  test(format .. ": a line that does not continue the container is not a table row", function()
    local doc = read("> | a | b |\n> |---|---|\n| 1 | 2 |\n", format)
    eq(#grids(doc)[1].cells, 2)
    -- Pandoc's Markdown keeps the line in the block quote, as text.
    eq(blocks_of(doc), format == "markdown" and "BlockQuote" or "BlockQuote Para")
  end)
end

---------------------------------------------------------------------------
-- Cells: inline markup, escapes, line breaks, alignment
---------------------------------------------------------------------------

local function cell_html(text, format, row, col)
  local doc = read(text, format)
  local found
  doc:walk {
    Table = function(t)
      local rows = pandoc.List {}
      rows:extend(t.head.rows)
      rows:extend(t.bodies[1].body)
      found = found or rows[row].cells[col]
    end,
  }
  return pandoc.write(pandoc.Pandoc(found.contents), "html"):gsub("\n", "")
end

for _, format in ipairs { "markdown", "commonmark_x" } do
  test(format .. ": inline markup in cells", function()
    local text = "| **b** | *e* | `a\\|b` | [l](http://x.y) | x \\\\ y |\n|---|---|---|---|---|\n"
    eq(cell_html(text, format, 1, 1), "<strong>b</strong>")
    eq(cell_html(text, format, 1, 2), "<em>e</em>")
    eq(cell_html(text, format, 1, 3), "<code>a|b</code>")
    eq(cell_html(text, format, 1, 4), '<a href="http://x.y">l</a>')
    eq(cell_html(text, format, 1, 5), "x<br />y")
  end)

  test(format .. ": reference links and footnotes defined elsewhere in the document", function()
    local text = "| [x][r] | n[^1] | << |\n|---|---|---|\n\n[r]: http://e.x\n\n[^1]: The note.\n"
    eq(cell_html(text, format, 1, 1), '<a href="http://e.x">x</a>')
    local doc = read(text, format)
    local notes = 0
    doc:walk { Note = function() notes = notes + 1 end }
    eq(notes, 1)
    eq(grids(doc)[1].cells[2].colspan, 2)
  end)

  test(format .. ": LTEM escapes and literal markers render as text", function()
    local text = "| \\<< | x \\{c:2} | a \\| b |\n|---|---|---|\n| \\^^ | a << b | ^^ |\n"
    eq(cell_html(text, format, 1, 1), "&lt;&lt;")
    eq(cell_html(text, format, 1, 2), "x {c:2}")
    eq(cell_html(text, format, 1, 3), "a | b")
    eq(cell_html(text, format, 2, 1), "^^")
    eq(cell_html(text, format, 2, 2), "a &lt;&lt; b")
    eq(cell_html(text, format, 2, 3), "^^") -- V7: below the header, kept as text
  end)

  test(format .. ": ^^ never becomes a superscript", function()
    local doc = read("| A | ^^ |\n|---|---|\n| ^^ | \\^^ |\n", format)
    local superscripts = 0
    doc:walk { Superscript = function() superscripts = superscripts + 1 end }
    eq(superscripts, 0)
  end)

  test(format .. ": alignment", function()
    eq(grids(read("| a | b | c | d |\n|:--|:-:|--:|---|\n", format))[1].align,
      { "left", "center", "right", pandoc.json.null })
  end)

  test(format .. ": several tables, and text around them", function()
    local doc = read("Intro\n" .. SPAN_TABLE .. "\n- Stir well\n\n| x |\n|---|\n| 1 |\n\nEnd\n", format)
    eq(blocks_of(doc), "Para Table BulletList Table Para")
    eq(#grids(doc), 2)
  end)

  test(format .. ": a table directly below text", function()
    eq(blocks_of(read("Quarterly revenue\n" .. SPAN_TABLE, format)), "Para Table")
  end)

  test(format .. ": a delimiter row that LTEM does not use stays text", function()
    for _, text in ipairs {
      "| Region | Q1 | Q2 |\n|--------|----|\n| Asia   | 1  |\n",
      "Revenue\n===\n|---|\n| 1 |\n",
      "Size | Price\n- | -\n",
      "| a | b |\n    |---|---|\n| 1 | 2 |\n",
    } do
      eq(#grids(read(text, format)), 0, ("%q"):format(text))
    end
  end)
end

test("markdown: smart punctuation and math in cells follow the base format", function()
  eq(cell_html('| "q" -- $x$ |\n|---|\n', "markdown", 1, 1),
    '“q” – <span class="math inline"><em>x</em></span>')
  eq(cell_html('| "q" -- $x$ |\n|---|\n', "markdown-smart-tex_math_dollars", 1, 1), '"q" -- $x$')
end)

test("markdown: raw TeX at the end of a cell does not take the next cell", function()
  local doc = read("| a\\b | x |\n|---|---|\n| \\textbf | y |\n", "markdown")
  local t = grids(doc)[1]
  eq({ t.cells[2].text, t.cells[4].text }, { "x", "y" })
end)

test("markdown: an unclosed HTML comment in a cell stays in that cell", function()
  local doc = read("| a <!-- | b |\n|---|---|\n| c | --> d |\n", "markdown")
  local t = grids(doc)[1]
  eq(#t.cells, 4)
  eq(t.cells[2].text, "b")
end)

---------------------------------------------------------------------------
-- Captions and attributes (Pandoc's Markdown)
---------------------------------------------------------------------------

local function first_table(doc)
  local found
  doc:walk { Table = function(t) found = found or t end }
  return found
end

test("markdown: a caption after the table, and one before it", function()
  local after = first_table(read(SPAN_TABLE .. "\n\n: Sales by region\n", "markdown"))
  eq(pandoc.utils.stringify(after.caption.long), "Sales by region")
  local directly = first_table(read(SPAN_TABLE .. "\n: Sales by region\n", "markdown"))
  eq(pandoc.utils.stringify(directly.caption.long), "Sales by region")
  eq(#directly.bodies[1].body, 1) -- the caption is not a body row
  local before = first_table(read("Table: Sales by region\n\n" .. SPAN_TABLE, "markdown"))
  eq(pandoc.utils.stringify(before.caption.long), "Sales by region")
end)

test("markdown: table attributes in the caption", function()
  local t = first_table(read(SPAN_TABLE .. "\n\n: Sales {#tbl-sales .wide}\n", "markdown"))
  eq(t.attr.identifier, "tbl-sales")
  eq(t.attr.classes, pandoc.List { "wide" })
end)

test("commonmark_x: a caption-like line is a body row", function()
  local t = grids(read("| a |\n|---|\n: not a caption\n", "commonmark_x"))[1]
  eq(t.rows, 2)
end)

---------------------------------------------------------------------------
-- Blocks of the base format
---------------------------------------------------------------------------

for _, format in ipairs { "markdown", "commonmark_x" } do
  test(format .. ": code blocks keep LTEM-like text", function()
    local doc = read("```\n" .. SPAN_TABLE .. "\n```\n\n    | a | << |\n    |---|---|\n", format)
    eq(blocks_of(doc), "CodeBlock CodeBlock")
    eq(doc.blocks[1].text, SPAN_TABLE)
  end)

  test(format .. ": a YAML metadata block with pipes", function()
    local doc = read("---\ntitle: a | b\nnote: |\n  | x | << |\n  |---|---|\n---\n\n" .. SPAN_TABLE, format)
    eq(pandoc.utils.stringify(doc.meta.title), "a | b")
    eq(spans(pandoc.Pandoc(doc.blocks)), SPANS)
    -- A table in a metadata value is read by the base format, as Pandoc's
    -- own pipe table: the YAML is left alone.
    eq(#grids(pandoc.Pandoc(doc.meta.note)), 1)
  end)
end

test("commonmark_x: raw HTML blocks are verbatim", function()
  local doc = read("<div>\n| a | << |\n|---|---|\n</div>\n", "commonmark_x")
  eq(blocks_of(doc), "RawBlock")
  ok(doc.blocks[1].text:find("| a | << |", 1, true))
end)

test("markdown: Markdown inside an HTML block and inside a fenced div", function()
  local html = read("<div>\n" .. SPAN_TABLE .. "\n</div>\n", "markdown")
  eq(spans(html), SPANS)
  local div = read("::: note\n" .. SPAN_TABLE .. "\n:::\n", "markdown")
  eq(blocks_of(div), "Div")
  eq(spans(div), SPANS)
end)

test("markdown: a table in a footnote", function()
  local doc = read("Text.[^1]\n\n[^1]: The table:\n\n" .. prefixed("    ", "    ", SPAN_TABLE) .. "\n", "markdown")
  local in_note = 0
  doc:walk { Note = function(n) in_note = in_note + #grids(pandoc.Pandoc(n.content)) end }
  eq(in_note, 1)
  eq(spans(doc), SPANS)
end)

for _, format in ipairs { "markdown", "commonmark_x" } do
  test(format .. ": the scanner knows the blocks of the base format (no table is left to it)", function()
    for _, text in ipairs {
      "```\n" .. SPAN_TABLE .. "\n```\n\n" .. SPAN_TABLE,
      "~~~~\n" .. SPAN_TABLE .. "\n~~~\n~~~~\n",
      "    " .. SPAN_TABLE:gsub("\n", "\n    ") .. "\n",
      "<!--\n" .. SPAN_TABLE .. "\n-->\n\n" .. SPAN_TABLE,
      "<pre>\n" .. SPAN_TABLE .. "\n</pre>\n",
      "---\na: |\n  " .. SPAN_TABLE:gsub("\n", "\n  ") .. "\n---\n\n" .. SPAN_TABLE,
      "> ```\n> " .. SPAN_TABLE:gsub("\n", "\n> ") .. "\n> ```\n",
      "- a\n\n      " .. SPAN_TABLE:gsub("\n", "\n      ") .. "\n",
    } do
      local _, _, skipped = ltem_pandoc.read(text, format)
      eq(skipped, {}, ("%q"):format(text))
    end
  end)

  test(format .. ": tables in definition lists", function()
    local plain = "Term\n:   | a | b |\n    |---|---|\n    | 1 | 2 |\n\nTerm 2\n\n: | c |\n  |---|\n"
    eq(native(read(plain, format)), native(pandoc.read(plain, format)))
    local doc = read("Term\n:   " .. SPAN_TABLE:gsub("\n", "\n    ") .. "\n: second\n", format)
    eq(blocks_of(doc), "DefinitionList")
    eq(#doc.blocks[1].content[1][2], 2) -- two definitions
    eq(spans(doc), SPANS)
  end)
end

test("the reader warns about tables it leaves to the base format", function()
  pandoc.system.with_temporary_directory("ltem-log", function(dir)
    local log = pandoc.path.join { dir, "log.json" }
    -- Without markdown_in_html_blocks and native_divs, Pandoc's Markdown
    -- keeps the text of an HTML block verbatim; the scanner does not model
    -- these extensions.
    local text = "<div>\n" .. SPAN_TABLE .. "\n</div>\n"
    local extensions = "-markdown_in_html_blocks-native_divs"
    local native_html = support.run_pandoc({ "-f", READERS .. "ltem-markdown.lua" .. extensions,
      "-t", "native", "--quiet", "--log", log }, text)
    eq(native_html, support.run_pandoc({ "-f", "markdown" .. extensions, "-t", "native" }, text))
    local messages = support.read_file(log)
    ok(messages:find("line 2", 1, true), messages)
  end)
end)

test("markdown: tables in fancy and example lists", function()
  for _, marker in ipairs { "a. ", "(1) ", "iv) ", "B.  ", "#. ", "(@) ", "(@ex) " } do
    local indent = (" "):rep(#marker)
    local doc = read(prefixed(marker, indent, SPAN_TABLE) .. "\n", "markdown")
    eq(blocks_of(doc), "OrderedList", marker)
    eq(spans(doc), SPANS)
  end
  local plain = "(a) | x | y |\n    |---|---|\n    | 1 | 2 |\n"
  eq(native(read(plain, "markdown")), native(pandoc.read(plain, "markdown")))
  eq(blocks_of(read("B. Russell\n| a |\n|---|\n", "markdown")), "Para Table")
end)

test("markdown: raw TeX commands, verbatim HTML and the title block are Pandoc's own", function()
  for _, text in ipairs {
    "\\newcommand{\\x}{\n" .. SPAN_TABLE .. "\n}\n",
    "\\foo[a]{b\\{\n" .. SPAN_TABLE .. "\n}\n",
    "Text\n<pre>\n" .. SPAN_TABLE .. "\n</pre>\n",
    "Text\n<script>\n" .. SPAN_TABLE .. "\n</script>\n",
    "% Title\n  " .. SPAN_TABLE:gsub("\n", "\n  ") .. "\n\nText\n",
  } do
    local doc, tables, skipped = ltem_pandoc.read(text, "markdown")
    eq({ tables, skipped }, { 0, {} }, ("%q"):format(text))
    eq(native(doc), native(pandoc.read(text, "markdown")), ("%q"):format(text))
  end
  -- Inside a paragraph, the table interrupts it, as it would a code span:
  -- block structure comes first.
  eq(blocks_of(read("Text\n\\newcommand{\\x}{\n" .. SPAN_TABLE .. "\n}\n", "markdown")), "Para Table")
end)

test("markdown: grid tables and simple tables are Pandoc's own", function()
  local grid = "+---+---+\n| a | b |\n+===+===+\n| 1 | 2 |\n+---+---+\n"
  eq(native(read(grid, "markdown")), native(pandoc.read(grid, "markdown")))
  local simple = "  a     b\n---   ---\n  1     2\n"
  eq(native(read(simple, "markdown")), native(pandoc.read(simple, "markdown")))
end)

test("markdown: a fence without a closing fence is text, as Pandoc reads it", function()
  local doc = read("```\n\n" .. SPAN_TABLE, "markdown")
  eq(#grids(doc), 1)
  eq(#grids(read("```\n\n" .. SPAN_TABLE, "commonmark_x")), 0) -- CommonMark: code to the end
end)

---------------------------------------------------------------------------
-- Robustness
---------------------------------------------------------------------------

local STREAMED = {
  "Intro text\n\n" .. SPAN_TABLE .. "\n| Europe | 3 | << |\n\n: Caption\n\nAfter.",
  "> | A {c:2} |\n> | x | y |\n> |---|---|\n> | 1 \\\\ 2 | `c\\|d` |\n\n- | a | ^^ |\n  |:-:|--:|",
  "```ltem\n| a |\n|---|\n```\n| b [^n] | <<\n|---|---\n| x {r:9} | <!-- \n\n[^n]: note",
}

for _, format in ipairs { "markdown", "commonmark_x" } do
  test(format .. ": incomplete input never raises (every prefix, by line and by character)", function()
    for _, text in ipairs(STREAMED) do
      for i = 0, #text do
        local prefix = text:sub(1, i)
        local good, err = pcall(read, prefix, format)
        ok(good, ("prefix %q: %s"):format(prefix, tostring(err)))
      end
    end
  end)

  test(format .. ": empty and blank input, and CRLF line endings", function()
    eq(#read("", format).blocks, 0)
    eq(#read(" \n\t\n", format).blocks, 0)
    local lf = read("Intro\n\n" .. SPAN_TABLE .. "\n", format)
    local crlf = read(("Intro\n\n" .. SPAN_TABLE .. "\n"):gsub("\n", "\r\n"), format)
    eq(native(crlf), native(lf))
  end)
end

test("commonmark_x: the sourcepos extension is turned off", function()
  eq(spans(read(SPAN_TABLE, "commonmark_x+sourcepos")), SPANS)
end)

test("the reader's extensions pass through to the base format", function()
  local html = support.run_pandoc({ "-f", READERS .. "ltem-markdown.lua-smart+emoji", "-t", "html" },
    '| "q" :smile: | << |\n|---|---|\n')
  ok(html:find('"q"', 1, true) and html:find("😄", 1, true) and html:find('colspan="2"', 1, true), html)
end)
