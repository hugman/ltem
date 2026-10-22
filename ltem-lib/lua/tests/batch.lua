--- Batch interface for the differential test (tests/differential.py).
--
--     pandoc lua tests/batch.lua core   < documents.json
--     pandoc lua tests/batch.lua reader < documents.json
--
-- Reads a JSON array of Markdown documents and prints a JSON array with one
-- result per document:
--
-- * core: the core's tables, problems, row forms, plain HTML, canonical text,
--   cell sources and table lines
-- * reader: the tables of the Pandoc readers (base formats markdown and
--   commonmark_x, without the smart extension, which turns `---` in cell text
--   into a dash) as grid structures with plain cell text, and the number of
--   LTEM tables left to the base format

local here = arg[0]:match("^(.*)[/\\]") or "."
package.path = here .. "/?.lua;" .. package.path

local support = require("support")
local ltem = require("ltem")
local ltem_pandoc = require("ltem-pandoc")

local json, List = pandoc.json, pandoc.List

local function model_value(t)
  local align = List {}
  for i, a in ipairs(t.align) do
    align[i] = a or json.null
  end
  local cells = List {}
  for i, c in ipairs(t.cells) do
    cells[i] = { row = c.row, col = c.col, rowspan = c.rowspan, colspan = c.colspan, text = c.text }
  end
  return { rows = t.rows, cols = t.cols, header_rows = t.header_rows, align = align, cells = cells }
end

local function core_result(text)
  local result = {
    tables = List {}, errors = List {}, forms = List {}, html = List {}, canonical = List {},
    sources = List {}, lines = List {},
  }
  for _, r in ipairs(ltem.find_tables(text)) do
    result.tables:insert(model_value(r.table))
    for _, p in ipairs(r.problems) do
      result.errors:insert({ rule = p.rule, row = p.row, col = p.col or json.null })
    end
    result.forms:insert(List(r.forms))
    result.html:insert(ltem.render_html(r.table))
    result.canonical:insert((assert(ltem.write(r.table))))
    local sources = List {}
    for _, s in ipairs(r.sources) do
      sources:insert(List { s.row, s.col, s.rowspan, s.colspan, s.line, s.start, s.stop })
    end
    result.sources:insert(sources)
    result.lines:insert(List { r.first, r.last })
  end
  return result
end

local function reader_result(text)
  local result = {}
  for _, format in ipairs { "markdown", "commonmark_x" } do
    local tables, skipped = List {}, {}
    local ok, err = pcall(function()
      local doc, _, left = ltem_pandoc.read(text, format .. "-smart")
      skipped = left
      doc:walk {
        Table = function(t)
          tables:insert(support.grid_structure(t))
        end,
      }
    end)
    result[format] = ok and tables or ("error: " .. tostring(err))
    result[format .. "_skipped"] = #skipped
  end
  return result
end

local mode = arg[1]
local handlers = { core = core_result, reader = reader_result }
local handler = assert(handlers[mode], "usage: pandoc lua tests/batch.lua core|reader")
local documents = json.decode(io.read("a"), false)
local results = List {}
for i, text in ipairs(documents) do
  results[i] = handler(text)
end
io.write(json.encode(results))
