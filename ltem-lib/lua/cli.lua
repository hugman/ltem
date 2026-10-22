--- Command-line interface for LTEM tables. Run it with Pandoc's Lua:
--
--     pandoc lua cli.lua parse    [FILE]           table models of all tables, as JSON
--     pandoc lua cli.lua render   [FILE]           HTML of all tables
--     pandoc lua cli.lua validate [FILE] [--json]  validation problems; exit status 1 on errors
--     pandoc lua cli.lua write    [FILE]           canonical LTEM of table models given as JSON
--
-- Input is read from FILE, or from standard input if FILE is missing or "-".
-- The modes follow the command-line protocol of the LTEM conformance tests.
-- `render` parses cell text as CommonMark inlines with Pandoc.

local script_dir = (arg and arg[0] or ""):match("^(.*)[/\\]") or "."
package.path = ("%s/?.lua;%s/pandoc/?.lua;%s"):format(script_dir, script_dir, package.path)

local ltem = require("ltem")
local commonmark_inline = require("ltem-pandoc").inline_renderer("commonmark")

local json, List = pandoc.json, pandoc.List

local USAGE = [[
usage: pandoc lua cli.lua <parse|render|validate|write> [FILE] [--json]
]]

local function fail(code, message)
  io.stderr:write("ltem: ", message, "\n")
  os.exit(code)
end

local function read_input(path)
  if not path or path == "-" then
    return io.read("a")
  end
  local file, err = io.open(path, "rb")
  if not file then
    fail(2, err)
  end
  local text = file:read("a")
  file:close()
  return text
end

-- The table model as a JSON value: arrays as lists, so that empty ones stay
-- arrays, and no alignment as null.
local function model_value(t)
  local align = List {}
  for i, a in ipairs(t.align) do
    align[i] = a or json.null
  end
  local cells = List {}
  for i, c in ipairs(t.cells) do
    cells[i] = { row = c.row, col = c.col, rowspan = c.rowspan, colspan = c.colspan, text = c.text }
  end
  return {
    version = t.version, rows = t.rows, cols = t.cols,
    header_rows = t.header_rows, align = align, cells = cells,
  }
end

local function parse(text)
  local tables = List {}
  for _, result in ipairs(ltem.find_tables(text)) do
    tables:insert(model_value(result.table))
  end
  io.write(json.encode({ tables = tables }), "\n")
end

local function render(text)
  local parts = {}
  for _, result in ipairs(ltem.find_tables(text)) do
    parts[#parts + 1] = ltem.render_html(result.table, commonmark_inline)
  end
  io.write(table.concat(parts, "\n"), "\n")
end

local function validate(text, as_json)
  local results = ltem.find_tables(text)
  local errors, lines, has_error = List {}, {}, false
  for n, result in ipairs(results) do
    for _, p in ipairs(result.problems) do
      has_error = has_error or p.severity == "error"
      errors:insert({ rule = p.rule, row = p.row, col = p.col or json.null, severity = p.severity })
      local where = p.col and ("(%d,%d)"):format(p.row, p.col) or ("row %d"):format(p.row)
      lines[#lines + 1] = ("table %d: %s at %s: %s"):format(n, p.rule, where, p.message)
    end
  end
  if as_json then
    io.write(json.encode({ errors = errors }), "\n")
  elseif #lines > 0 then
    io.write(table.concat(lines, "\n"), "\n")
  end
  os.exit(has_error and 1 or 0)
end

-- Print the canonical form of one table model or of {"tables": [...]}.
local function write(text)
  local ok, data = pcall(json.decode, text, false)
  if not ok or type(data) ~= "table" then
    fail(2, "not a table model: the input is not a JSON object")
  end
  local items = (data.tables and not data.version) and data.tables or { data }
  local outputs = {}
  for n, item in ipairs(items) do
    local t, err = ltem.read_model(item)
    if not t then
      fail(2, ("table %d: not a table model: %s"):format(n, err))
    end
    local out, problem = ltem.write(t)
    if not out then
      fail(1, ("table %d: %s"):format(n, problem))
    end
    outputs[n] = out
  end
  io.write(table.concat(outputs, "\n\n"), "\n")
end

local mode, path, as_json = nil, nil, false
for _, a in ipairs(arg or {}) do
  if a == "--json" then
    as_json = true
  elseif not mode then
    mode = a
  elseif not path then
    path = a
  else
    fail(2, "too many arguments\n" .. USAGE)
  end
end

local commands = { parse = parse, render = render, write = write }
if mode == "validate" then
  validate(read_input(path), as_json)
elseif commands[mode] then
  commands[mode](read_input(path))
else
  io.stderr:write(USAGE)
  os.exit(2)
end
