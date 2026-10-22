--- Tests of the filter (pandoc/ltem-filter.lua), of Pandoc's writers on LTEM
-- tables, and of the files of the Quarto extension.

local support = require("support")
local test, eq, ok = support.test, support.eq, support.ok

local FILTER = support.lua_dir .. "/pandoc/ltem-filter.lua"
local READER = support.lua_dir .. "/pandoc/ltem-markdown.lua"

local SPAN_TABLE = table.concat({
  "| Region | Revenue | <<  |",
  "| ^^     | Q1      | Q2  |",
  "|--------|---------|-----|",
  "| Asia   | 1       | 2   |",
}, "\n")

local function filtered(input, args)
  local all = { "-L", FILTER, "-t", "json" }
  for _, a in ipairs(args or {}) do
    all[#all + 1] = a
  end
  return pandoc.read(support.run_pandoc(all, input), "json")
end

local function tables(doc)
  local found = {}
  doc:walk { Table = function(t) found[#found + 1] = t end }
  return found
end

local function span_summary(t)
  local s = support.grid_structure(t)
  local parts = {}
  for k, c in ipairs(s.cells) do
    parts[k] = ("%s %dx%d"):format(c.text, c.rowspan, c.colspan)
  end
  return table.concat(parts, ", ")
end

local SPANS = "Region 2x1, Revenue 1x2, Q1 1x1, Q2 1x1, Asia 1x1, 1 1x1, 2 1x1"

test("a fenced code block with the class ltem becomes the table", function()
  local doc = filtered("Text\n\n```ltem\n" .. SPAN_TABLE .. "\n```\n\nAfter\n")
  eq(#doc.blocks, 3)
  eq(doc.blocks[2].t, "Table")
  eq(span_summary(doc.blocks[2]), SPANS)
end)

test("the block's identifier, classes and attributes go to the table", function()
  local doc = filtered("```{.ltem #tbl-sales .wide data-x=1}\n" .. SPAN_TABLE .. "\n```\n")
  local t = doc.blocks[1]
  eq(t.attr.identifier, "tbl-sales")
  eq(t.attr.classes, pandoc.List { "wide" })
  eq(t.attr.attributes["data-x"], "1")
end)

test("a caption inside the block, with attributes", function()
  local doc = filtered("```ltem\n" .. SPAN_TABLE .. "\n\n: Sales {#tbl-a}\n```\n")
  local t = doc.blocks[1]
  eq(pandoc.utils.stringify(t.caption.long), "Sales")
  eq(t.attr.identifier, "tbl-a")
end)

test("other code blocks stay; a block without a table stays a code block, with a warning", function()
  pandoc.system.with_temporary_directory("ltem-log", function(dir)
    local log = pandoc.path.join { dir, "log.json" }
    local doc = filtered("```python\nprint(1)\n```\n\n```ltem\nno table here\n```\n", { "--quiet", "--log", log })
    eq(doc.blocks[1].t, "CodeBlock")
    eq(doc.blocks[2].t, "CodeBlock")
    eq(doc.blocks[2].text, "no table here")
    ok(support.read_file(log):find("holds no LTEM table", 1, true))
  end)
end)

test("several tables and text in one block", function()
  local doc = filtered("```ltem\nIntro\n" .. SPAN_TABLE .. "\n\n| x |\n|---|\n| 1 |\n```\n")
  eq(#tables(doc), 2)
  eq(doc.blocks[1].t, "Para")
end)

test("the format of the block's text comes from the metadata field ltem-format", function()
  local input = "```ltem\n| a |\n|---|\n| 1 |\n: caption\n```\n"
  eq(pandoc.utils.stringify(tables(filtered(input))[1].caption.long), "caption")
  local cm = filtered("---\nltem-format: commonmark_x\n---\n\n" .. input)
  eq(#cm.blocks[1].bodies[1].body, 2) -- in CommonMark the line is a body row
end)

test("any reader: reStructuredText, HTML and CommonMark input", function()
  local rst = filtered(".. code:: ltem\n\n   " .. SPAN_TABLE:gsub("\n", "\n   ") .. "\n", { "-f", "rst" })
  eq(span_summary(tables(rst)[1]), SPANS)
  local html = filtered('<pre class="ltem"><code>' .. SPAN_TABLE:gsub("<", "&lt;") .. "</code></pre>", { "-f", "html" })
  eq(span_summary(tables(html)[1]), SPANS)
  local cm = filtered("```ltem\n" .. SPAN_TABLE .. "\n```\n", { "-f", "commonmark" })
  eq(span_summary(tables(cm)[1]), SPANS)
end)

test("the filter runs after the reader without changing its tables", function()
  local direct = support.run_pandoc({ "-f", READER, "-t", "native" }, SPAN_TABLE .. "\n")
  local both = support.run_pandoc({ "-f", READER, "-L", FILTER, "-t", "native" }, SPAN_TABLE .. "\n")
  eq(both, direct)
end)

---------------------------------------------------------------------------
-- Pandoc's writers
---------------------------------------------------------------------------

test("Pandoc's writers write merged cells: LaTeX, Typst, Word and ODT", function()
  local input = "Text\n\n" .. SPAN_TABLE .. "\n| Total | 3 | << |\n\n: Caption\n"
  local latex = support.run_pandoc({ "-f", READER, "-t", "latex" }, input)
  ok(latex:find("\\multirow{2}", 1, true) and latex:find("\\multicolumn{2}", 1, true), latex)
  local typst = support.run_pandoc({ "-f", READER, "-t", "typst" }, input)
  ok(typst:find("rowspan: 2", 1, true) and typst:find("colspan: 2", 1, true), typst)
  -- An entry of a zip file (docx, odt) that Pandoc writes.
  local function entry(writer, name)
    return pandoc.system.with_temporary_directory("ltem-writer", function(dir)
      local path = pandoc.path.join { dir, "out." .. writer }
      support.run_pandoc({ "-f", READER, "-o", path }, input)
      for _, e in ipairs(pandoc.zip.Archive(support.read_file(path)).entries) do
        if e.path == name then
          return e:contents()
        end
      end
    end)
  end
  local docx = entry("docx", "word/document.xml")
  ok(docx:find('<w:gridSpan w:val="2"', 1, true) and docx:find('<w:vMerge w:val="restart"', 1, true), "docx")
  local odt = entry("odt", "content.xml")
  ok(odt:find('number-columns-spanned="2"', 1, true) and odt:find('number-rows-spanned="2"', 1, true), "odt")
  for _, writer in ipairs { "html", "markdown", "gfm", "rst", "asciidoc", "jats", "context" } do
    support.run_pandoc({ "-f", READER, "-t", writer }, input) -- raises an error if Pandoc fails
  end
end)

---------------------------------------------------------------------------
-- The Quarto extension
---------------------------------------------------------------------------

test("the Quarto extension holds current copies of the filter and its modules", function()
  local extension = support.lua_dir .. "/_extensions/ltem/"
  for source, copy in pairs {
    ["ltem.lua"] = "ltem.lua",
    ["pandoc/ltem-pandoc.lua"] = "ltem-pandoc.lua",
    ["pandoc/ltem-filter.lua"] = "ltem-filter.lua",
  } do
    ok(support.read_file(support.lua_dir .. "/" .. source) == support.read_file(extension .. copy),
      copy .. " differs from " .. source .. "; run: pandoc lua tools/sync-extension.lua")
  end
  local yml = support.read_file(extension .. "_extension.yml")
  ok(yml:find("path: ltem-filter.lua", 1, true) and yml:find("version: 0.1.0", 1, true), yml)
end)

test("the extension's filter works from its own folder", function()
  local filter = support.lua_dir .. "/_extensions/ltem/ltem-filter.lua"
  local doc = pandoc.read(support.run_pandoc({ "-L", filter, "-t", "json" },
    "```ltem\n" .. SPAN_TABLE .. "\n```\n"), "json")
  eq(span_summary(tables(doc)[1]), SPANS)
end)
