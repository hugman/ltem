--- Shared test support: a small test runner, JSON files, the HTML
-- normalization of the conformance tests and paths in the repository.

local M = {}

local function absolute(path)
  return pandoc.path.is_absolute(path) and path or pandoc.path.join { pandoc.system.get_working_directory(), path }
end

local here = pandoc.path.directory(absolute(debug.getinfo(1, "S").source:sub(2)))
M.lua_dir = pandoc.path.normalize(pandoc.path.join { here, ".." })
M.repo_dir = pandoc.path.normalize(pandoc.path.join { M.lua_dir, "..", ".." })
M.conformance_dir = pandoc.path.join { M.repo_dir, "conformance", "cases" }
M.pandoc = os.getenv("PANDOC") or "pandoc"
package.path = table.concat({
  M.lua_dir .. "/?.lua", M.lua_dir .. "/pandoc/?.lua", here .. "/?.lua", package.path,
}, ";")

---------------------------------------------------------------------------
-- Test runner
---------------------------------------------------------------------------

local tests = {}

--- Register a test.
function M.test(name, fn)
  tests[#tests + 1] = { name = name, fn = fn }
end

--- Run the registered tests whose names contain `filter` (all if nil). Prints
-- failures and a summary line, and returns the number of failures.
function M.run(title, filter)
  local passed, failed = 0, 0
  for _, t in ipairs(tests) do
    if not filter or t.name:find(filter, 1, true) then
      local ok, err = xpcall(t.fn, debug.traceback)
      if ok then
        passed = passed + 1
      else
        failed = failed + 1
        io.write("FAIL ", t.name, "\n", tostring(err), "\n")
      end
    end
  end
  io.write(("%s: %d passed, %d failed\n"):format(title, passed, failed))
  tests = {}
  return failed
end

local function show(v)
  if type(v) == "string" then
    return ("%q"):format(v)
  elseif type(v) == "table" then
    local ok, json = pcall(pandoc.json.encode, v)
    return ok and json or tostring(v)
  end
  return tostring(v)
end
M.show = show

--- Deep equality of plain values.
function M.equal(a, b)
  if type(a) ~= type(b) then
    return false
  end
  if type(a) ~= "table" then
    return a == b
  end
  for k, v in pairs(a) do
    if not M.equal(v, b[k]) then
      return false
    end
  end
  for k in pairs(b) do
    if a[k] == nil then
      return false
    end
  end
  return true
end

function M.eq(actual, expected, message)
  if not M.equal(actual, expected) then
    error(("%s\n  expected: %s\n  actual:   %s"):format(message or "values differ", show(expected), show(actual)), 2)
  end
end

function M.ok(value, message)
  if not value then
    error(message or "expected a true value", 2)
  end
end

---------------------------------------------------------------------------
-- Files and processes
---------------------------------------------------------------------------

function M.read_file(path)
  local f = assert(io.open(path, "rb"))
  local text = f:read("a")
  f:close()
  return text
end

function M.write_file(path, text)
  local f = assert(io.open(path, "wb"))
  f:write(text)
  f:close()
end

--- Decode JSON into plain Lua values; null becomes `pandoc.json.null`.
function M.read_json(path)
  return pandoc.json.decode(M.read_file(path), false)
end

function M.spec_examples()
  return M.read_json(pandoc.path.join { M.conformance_dir, "spec-examples.json" }).examples
end

function M.canonical_cases()
  return M.read_json(pandoc.path.join { M.conformance_dir, "canonical.json" }).cases
end

--- Run Pandoc with arguments and input. Returns stdout, or raises an error
-- with stderr if it fails.
function M.run_pandoc(args, input)
  return pandoc.pipe(M.pandoc, args, input)
end

---------------------------------------------------------------------------
-- Pandoc tables as grids
---------------------------------------------------------------------------

local ALIGN = { AlignLeft = "left", AlignRight = "right", AlignCenter = "center" }

-- Plain text of cell contents: line breaks as "\n", other spaces as " ".
function M.plain(blocks)
  local parts = {}
  for _, block in ipairs(blocks) do
    for _, el in ipairs(block.content or {}) do
      if el.t == "Str" then
        parts[#parts + 1] = el.text
      elseif el.t == "LineBreak" then
        parts[#parts + 1] = "\n"
      elseif el.t == "Space" or el.t == "SoftBreak" then
        parts[#parts + 1] = " "
      else
        parts[#parts + 1] = pandoc.utils.stringify(el)
      end
    end
  end
  return table.concat(parts)
end

-- A Pandoc table as a grid: the position of each cell follows from the cells
-- before it and the row spans above, as in HTML.
function M.grid_structure(t)
  local rows = pandoc.List {}
  rows:extend(t.head.rows)
  for _, body in ipairs(t.bodies) do
    rows:extend(body.head)
    rows:extend(body.body)
  end
  local align = pandoc.List {}
  for i, spec in ipairs(t.colspecs) do
    align[i] = ALIGN[spec[1]] or pandoc.json.null
  end
  local taken, cells = {}, pandoc.List {}
  for r = 1, #rows do
    taken[r] = taken[r] or {}
    local c = 0
    for _, cell in ipairs(rows[r].cells) do
      while taken[r][c] do
        c = c + 1
      end
      cells:insert({
        row = r - 1, col = c, rowspan = cell.row_span, colspan = cell.col_span, text = M.plain(cell.contents),
      })
      for dr = 0, cell.row_span - 1 do
        taken[r + dr] = taken[r + dr] or {}
        for dc = 0, cell.col_span - 1 do
          taken[r + dr][c + dc] = true
        end
      end
      c = c + cell.col_span
    end
  end
  return { rows = #rows, cols = #t.colspecs, header_rows = #t.head.rows, align = align, cells = cells }
end

---------------------------------------------------------------------------
-- HTML normalization (conformance/README.md, "HTML is normalized")
---------------------------------------------------------------------------

local ENTITIES = { amp = "&", lt = "<", gt = ">", quot = '"', apos = "'", nbsp = "\u{A0}" }

local function decode_entities(s)
  return (s:gsub("&(#?[xX]?)(%w+);", function(kind, name)
    if kind == "" then
      return ENTITIES[name]
    end
    local code = tonumber(name, (kind == "#x" or kind == "#X") and 16 or 10)
    return code and utf8.char(code)
  end))
end

local function strip_ascii_space(s)
  return (s:gsub("^[ \t\n\r\f]+", ""):gsub("[ \t\n\r\f]+$", ""))
end

local function parse_attributes(s)
  local attrs, i = {}, 1
  while true do
    local name_start, name_end, name = s:find("([^%s=/>]+)", i)
    if not name_start then
      break
    end
    local value
    local eq = s:match("^%s*=%s*()", name_end + 1)
    if eq then
      local q = s:sub(eq, eq)
      if q == '"' or q == "'" then
        local close = s:find(q, eq + 1, true) or #s + 1
        value, i = s:sub(eq + 1, close - 1), close + 1
      else
        local stop = s:find("[%s>]", eq) or #s + 1
        value, i = s:sub(eq, stop - 1), stop
      end
      value = decode_entities(value)
    else
      i = name_end + 1
    end
    name = name:lower()
    local align = name == "style" and value and value:match("^%s*text%-align%s*:%s*(%a+)%s*;?%s*$")
    if align == "left" or align == "center" or align == "right" then
      name, value = "align", align
    end
    attrs[#attrs + 1] = name .. "=" .. tostring(value)
  end
  table.sort(attrs)
  return table.concat(attrs, " ")
end

--- The token list of an HTML fragment, compared as the conformance runner
-- compares HTML: whitespace between tags and at the edges of text is ignored,
-- runs of ASCII whitespace in text count as one space (except in <pre>),
-- character references are decoded, attributes form a set, a `text-align`
-- style counts as `align`, and <br> equals <br />.
function M.normalize_html(html)
  local tokens, pre, i = {}, 0, 1
  local function text(s)
    s = strip_ascii_space(decode_entities(s))
    if s ~= "" then
      tokens[#tokens + 1] = "text:" .. (pre > 0 and s or s:gsub("[ \t\n\r\f]+", " "))
    end
  end
  while i <= #html do
    local lt = html:find("<", i, true)
    text(html:sub(i, (lt or #html + 1) - 1))
    if not lt then
      break
    end
    if html:sub(lt, lt + 3) == "<!--" then
      i = (select(2, html:find("-->", lt + 4, true)) or #html) + 1
    else
      local gt = html:find(">", lt, true) or #html
      local inner = html:sub(lt + 1, gt - 1)
      local closing, name, rest = inner:match("^(/?)([%w]+)(.*)$")
      if name then
        name = name:lower()
        if closing == "/" then
          if name == "pre" then
            pre = math.max(0, pre - 1)
          end
          if name ~= "br" then
            tokens[#tokens + 1] = "end:" .. name
          end
        else
          if name == "pre" then
            pre = pre + 1
          end
          tokens[#tokens + 1] = "start:" .. name .. " " .. parse_attributes((rest:gsub("/%s*$", "")))
          if name == "br" then
            tokens[#tokens + 1] = "end:br"
          end
        end
      end
      i = gt + 1
    end
  end
  return tokens
end

--- The <table> elements of an HTML fragment, each normalized.
function M.normalize_tables(html)
  local result = {}
  for t in html:gmatch("<table.-</table>") do
    result[#result + 1] = M.normalize_html(t)
  end
  return result
end

return M
