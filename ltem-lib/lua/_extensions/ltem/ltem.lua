--- LTEM (LLM-friendly Table-Enhanced Markdown) for Lua 5.4.
--
-- Markdown pipe tables with merged cells (`<<`, `^^`, `{c:N}`, `{r:M}`), several
-- header rows and line breaks in cells (`\\`), as defined by the LTEM
-- specification, version 1.0. Pure Lua without C modules, so it runs in any
-- Lua 5.4, including the one built into Pandoc.
--
-- Conventions:
--
-- * Grid positions (`row`, `col`) count from 0, as in the specification and in
--   the table model (`ast/` in the LTEM repository).
-- * Text positions follow Lua: line numbers count from 1 and byte offsets from 1,
--   so `line:sub(source.start, source.stop)` is the source of a cell.
-- * Strings are UTF-8 and are handled as bytes. All LTEM syntax is ASCII, so a
--   multibyte character is never split or mistaken for syntax.
-- * In `align`, `false` stands for the JSON `null` of the table model: the
--   column has no alignment.
--
-- @module ltem

local M = {}

M.VERSION = "0.1.0"
M.SPEC_VERSION = "1.0"
M.MODEL_VERSION = "1.0"

local byte, find, match, sub, gsub = string.byte, string.find, string.match, string.sub, string.gsub
local concat = table.concat

local SPACE, TAB, BACKSLASH, PIPE, RBRACE = 32, 9, 92, 124, 125
local COLSPAN_MARKER, ROWSPAN_MARKER = "<<", "^^"

-- A span value larger than any table behaves like this one: the span is cut at
-- the edge. Capping keeps the arithmetic in integers.
local SPAN_LIMIT = 1 << 31

---------------------------------------------------------------------------
-- Text helpers
---------------------------------------------------------------------------

local function is_space_or_tab(b)
  return b == SPACE or b == TAB
end

-- Only spaces and tabs count as blank or are trimmed (spec 2.1); other
-- whitespace, such as U+3000, is content.
local function is_blank(s)
  return find(s, "^[ \t]*$") ~= nil
end

local function trim(s)
  local first = find(s, "[^ \t]")
  if not first then
    return ""
  end
  local last = #s
  while is_space_or_tab(byte(s, last)) do
    last = last - 1
  end
  return sub(s, first, last)
end

local function rtrim(s)
  local last = #s
  while last > 0 and is_space_or_tab(byte(s, last)) do
    last = last - 1
  end
  return sub(s, 1, last)
end

-- The rest of a line after an indentation of at most three spaces. A pattern
-- matched against the rest fails on a line indented by four or more columns,
-- because no LTEM construct starts with a space, and a leading tab always
-- reaches column 4.
local function unindented(line)
  return sub(line, match(line, "^ ? ? ?()"))
end

--- Split text into lines at "\n", "\r\n" or "\r", as CommonMark does.
function M.split_lines(text)
  local lines = {}
  for line in string.gmatch(gsub(text, "\r\n?", "\n") .. "\n", "([^\n]*)\n") do
    lines[#lines + 1] = line
  end
  return lines
end

--- Width of the leading spaces and tabs, with tab stops every 4 columns (spec 2.1).
function M.indentation(line)
  local width = 0
  for i = 1, #line do
    local b = byte(line, i)
    if b == SPACE then
      width = width + 1
    elseif b == TAB then
      width = width + 4 - width % 4
    else
      break
    end
  end
  return width
end

---------------------------------------------------------------------------
-- Rows and lines (spec Section 2)
---------------------------------------------------------------------------

-- A cell of a row: its trimmed text, with `\|` turned into `|`, and the byte
-- range of its source without the spaces and tabs around it. An empty cell has
-- `stop == start - 1`, at the end of its space between the pipes.
local function make_cell(line, start, stop)
  while start <= stop and is_space_or_tab(byte(line, start)) do
    start = start + 1
  end
  while stop >= start and is_space_or_tab(byte(line, stop)) do
    stop = stop - 1
  end
  -- Every pipe inside a cell is escaped, so this removes exactly the backslash
  -- directly before each pipe, as the left-to-right split does (spec 2.1).
  local text = gsub(sub(line, start, stop), "\\|", "|")
  return { text = text, start = start, stop = stop }
end

--- Split a row into cells, as GFM does (spec 2.1).
--
-- Returns a list of `{text, start, stop}`: `text` is trimmed of spaces and tabs
-- and has `\|` turned into `|`; `line:sub(start, stop)` is the cell's source.
function M.split_row_spans(line)
  local b, e = 1, #line
  while b <= e and is_space_or_tab(byte(line, b)) do
    b = b + 1
  end
  while e >= b and is_space_or_tab(byte(line, e)) do
    e = e - 1
  end
  if b <= e and byte(line, b) == PIPE then
    b = b + 1
  end
  if e >= b and byte(line, e) == PIPE and not (e - 1 >= b and byte(line, e - 1) == BACKSLASH) then
    e = e - 1
  end
  local cells, cell_start, i = {}, b, b
  while i <= e do
    local c = byte(line, i)
    if c == BACKSLASH and i < e and byte(line, i + 1) == PIPE then
      i = i + 2
    else
      if c == PIPE then
        cells[#cells + 1] = make_cell(line, cell_start, i - 1)
        cell_start = i + 1
      end
      i = i + 1
    end
  end
  cells[#cells + 1] = make_cell(line, cell_start, e)
  return cells
end

--- Split a row into trimmed cell texts (spec 2.1).
function M.split_row(line)
  local texts = {}
  for i, cell in ipairs(M.split_row_spans(line)) do
    texts[i] = cell.text
  end
  return texts
end

--- Whether a line has the form of a delimiter row (spec 2.2).
--
-- It has a pipe, is indented less than four columns, does not begin a list
-- item (`- | -` does), and every cell is hyphens with optional colons.
function M.is_delimiter_row(line)
  if not find(line, "|", 1, true) or M.indentation(line) >= 4 or find(line, "^ ? ? ?%-[ \t]") then
    return false
  end
  for _, cell in ipairs(M.split_row_spans(line)) do
    if not find(cell.text, "^:?%-+:?$") then
      return false
    end
  end
  return true
end

-- A reserved table-identifier line, such as `| # orders |` (spec Section 9).
local function is_identifier_line(line)
  return find(line, "^ ? ? ?|[ \t]*#[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*|[ \t]*$") ~= nil
end

--- Whether a line can be a header row above the last one (spec 2.3).
function M.is_upper_header_row(line)
  return find(line, "^ ? ? ?|") ~= nil and not is_identifier_line(line) and not M.is_delimiter_row(line)
end

-- Three or more `-`, `*` or `_` of one kind, possibly separated by spaces and
-- tabs, with nothing else (after an indentation of at most three spaces).
local function is_thematic_break(line)
  local rest = unindented(line)
  local mark = sub(rest, 1, 1)
  if mark ~= "-" and mark ~= "*" and mark ~= "_" then
    return false
  end
  local count = 0
  for i = 1, #rest do
    local c = sub(rest, i, i)
    if c == mark then
      count = count + 1
    elseif c ~= " " and c ~= "\t" then
      return false
    end
  end
  return count >= 3
end

--- Whether a line is a thematic break, such as `---` or `* * *`.
M.is_thematic_break = is_thematic_break

local function ends_with_space_or_end(s, i)
  local b = byte(s, i)
  return b == nil or is_space_or_tab(b)
end

--- Whether a line begins a block (spec 2.3): a block quote, an ATX heading, a
-- fenced code block, a thematic break or a list item. The test looks at the
-- line alone, not at its context.
function M.starts_block(line)
  local rest = unindented(line)
  local first = sub(rest, 1, 1)
  if first == ">" then
    return true
  end
  local hashes = match(rest, "^#+")
  if hashes then
    return #hashes <= 6 and ends_with_space_or_end(rest, #hashes + 1)
  end
  if find(rest, "^```") or find(rest, "^~~~") or is_thematic_break(line) then
    return true
  end
  if first == "-" or first == "+" or first == "*" then
    return ends_with_space_or_end(rest, 2)
  end
  local digits = match(rest, "^([0-9]+)[.)]")
  return digits ~= nil and #digits <= 9 and ends_with_space_or_end(rest, #digits + 2)
end

-- A line of `=` or of `-`, which turns the paragraph line above into a heading.
local function is_setext_underline(line)
  local rest = unindented(line)
  return find(rest, "^=+[ \t]*$") ~= nil or find(rest, "^%-+[ \t]*$") ~= nil
end

--- Whether a table body ends before this line (spec 2.4): the line is blank,
-- indented by four or more columns, or begins a block.
function M.ends_table_body(line)
  return is_blank(line) or M.indentation(line) >= 4 or M.starts_block(line)
end

local function alignment(cell)
  local left, right = sub(cell, 1, 1) == ":", sub(cell, -1) == ":"
  if left and right then
    return "center"
  elseif right then
    return "right"
  elseif left then
    return "left"
  end
  return false
end

---------------------------------------------------------------------------
-- Span attributes and escapes (spec 2.6 and 4.3)
---------------------------------------------------------------------------

-- The items of an attribute body such as `c:2,r:3`, or nil if it is not one.
local function attribute_items(body)
  local items = {}
  for item in string.gmatch(body .. ",", "([^,]*),") do
    local key, digits = match(item, "^([cr]):([0-9]+)$")
    if not key then
      return nil
    end
    items[#items + 1] = { key = key, digits = digits }
  end
  return items
end

-- Position of the `{` of a span attribute that ends `text`, and its items.
-- The attribute is the whole text or follows a space or tab (spec 2.6).
local function trailing_attribute(text)
  if byte(text, -1) ~= RBRACE then
    return nil
  end
  local open = match(text, ".*(){")
  if not open or (open > 1 and not is_space_or_tab(byte(text, open - 1))) then
    return nil
  end
  local items = attribute_items(sub(text, open + 1, -2))
  if not items then
    return nil
  end
  return open, items
end

-- Remove the span attribute that ends a content cell. Returns the remaining
-- text and the attribute `{colspan, rowspan, problems}`, or the text and nil.
local function split_attribute(text)
  local open, items = trailing_attribute(text)
  if not open then
    return text, nil
  end
  local attr = { problems = {} }
  for _, item in ipairs(items) do
    local n = tonumber(item.digits)
    n = math.tointeger(n > SPAN_LIMIT and SPAN_LIMIT or n)
    if n < 1 then
      attr.problems[#attr.problems + 1] = "span value must be a positive integer, got " .. item.digits
      n = 1
    end
    local field = item.key == "c" and "colspan" or "rowspan"
    if attr[field] then
      attr.problems[#attr.problems + 1] = "'" .. item.key .. "' appears more than once"
    else
      attr[field] = n
    end
  end
  return rtrim(sub(text, 1, open - 1)), attr
end

-- Remove the backslash of an LTEM escape (spec 4.3), as GFM does for `\|`.
local function unescape_line(line)
  if line == "\\<<" or line == "\\^^" then
    return sub(line, 2)
  end
  if byte(line, -1) == RBRACE then
    local open = match(line, ".*(){")
    if open and open > 1 and byte(line, open - 1) == BACKSLASH
        and (open == 2 or is_space_or_tab(byte(line, open - 2)))
        and attribute_items(sub(line, open + 1, -2)) then
      return sub(line, 1, open - 2) .. sub(line, open)
    end
  end
  return line
end

-- Split text at each `\\`, pairing backslashes from left to right (spec 4.2).
local function split_line_breaks(text)
  local parts, init = {}, 1
  while true do
    local at = find(text, "\\\\", init, true)
    if not at then
      parts[#parts + 1] = sub(text, init)
      return parts
    end
    parts[#parts + 1] = sub(text, init, at - 1)
    init = at + 2
  end
end

--- Turn the source of a cell (pipes already unescaped, attribute removed) into
-- the text of the table model (spec Section 7): split at each `\\`, trim each
-- line and remove the LTEM escapes. Lines are joined by "\n".
function M.cell_lines(source)
  local lines = split_line_breaks(source)
  for i, part in ipairs(lines) do
    lines[i] = unescape_line(trim(part))
  end
  return concat(lines, "\n")
end

--- Add the escapes that keep one line of model text from being read as LTEM
-- notation (spec 4.3): `\<<`, `\^^` and the backslash before a trailing span
-- attribute. Pipes are left alone.
--
-- These are CommonMark backslash escapes, so the result renders like the
-- model text in CommonMark. Hosts whose inline syntax gives `^` or `<` a
-- meaning (such as Pandoc's superscripts) also render it literally.
function M.escape_notation(line)
  if line == COLSPAN_MARKER or line == ROWSPAN_MARKER then
    return "\\" .. line
  end
  local open = trailing_attribute(line)
  if open then
    return sub(line, 1, open - 1) .. "\\" .. sub(line, open)
  end
  return line
end

---------------------------------------------------------------------------
-- Span resolution (spec Section 3)
---------------------------------------------------------------------------

-- Places the cells of a table row by row. `owner[r][c]` is the origin record
-- of the cell that covers a position. While a compact row is tried, every
-- change is journaled so that it can be undone (spec 3.2, rule 2).
local Grid = {}
Grid.__index = Grid

local function new_grid(cols, header_rows, rows)
  local owner = {}
  for r = 0, rows - 1 do
    owner[r] = {}
  end
  return setmetatable({
    cols = cols, header_rows = header_rows, rows = rows,
    owner = owner, origins = {}, problems = {}, journal = nil,
  }, Grid)
end

function Grid:assign(tbl, key, value)
  local journal = self.journal
  if journal then
    journal[#journal + 1] = { tbl, key, tbl[key] }
  end
  tbl[key] = value
end

function Grid:rollback()
  local journal = self.journal
  for i = #journal, 1, -1 do
    local entry = journal[i]
    entry[1][entry[2]] = entry[3]
  end
  self.journal = nil
end

-- Problems met while trying a compact row are not reported (spec 3.2).
function Grid:report(rule, row, col, message)
  if not self.journal then
    self.problems[#self.problems + 1] = {
      rule = rule, row = row, col = col, message = message,
      severity = rule == "V14" and "warning" or "error",
    }
  end
end

-- Whether rows r0..r1-1 and columns c0..c1-1, cut at the grid's edges, are free.
function Grid:is_free(r0, r1, c0, c1)
  for r = r0, math.min(r1, self.rows) - 1 do
    local row = self.owner[r]
    for c = c0, math.min(c1, self.cols) - 1 do
      if row[c] then
        return false
      end
    end
  end
  return true
end

function Grid:cover(origin, r0, r1, c0, c1)
  for r = r0, math.min(r1, self.rows) - 1 do
    local row = self.owner[r]
    for c = c0, math.min(c1, self.cols) - 1 do
      self:assign(row, c, origin)
    end
  end
end

-- `<<` at (r, c) extends the cell that owns (r, c-1) (spec 3.4).
function Grid:extend_left(r, c)
  local left = c > 0 and self.owner[r][c - 1] or nil
  if not left or left.row ~= r or left.col + left.colspan ~= c or left.fixed_cols then
    self:report("V13", r, c, "'<<' has no cell to extend")
    return false
  end
  if not self:is_free(r + 1, left.row + left.rowspan, c, c + 1) then
    self:report("V4", r, c, "'<<' would make two cells overlap")
    return false
  end
  self:assign(left, "colspan", left.colspan + 1)
  self:cover(left, left.row, left.row + left.rowspan, c, c + 1)
  return true
end

-- `^^` at (r, c) extends the cell that owns (r-1, c) (spec 3.4).
function Grid:extend_up(r, c)
  local up = r > 0 and self.owner[r - 1][c] or nil
  if not up or up.col ~= c or up.row + up.rowspan ~= r or up.fixed_rows then
    self:report("V13", r, c, "'^^' has no cell to extend")
    return false
  end
  if up.row < self.header_rows and self.header_rows <= r then
    self:report("V7", r, c, "'^^' would extend a header cell into the body")
    return false
  end
  if not self:is_free(r, r + 1, c + 1, up.col + up.colspan) then
    self:report("V4", r, c, "'^^' would make two cells overlap")
    return false
  end
  self:assign(up, "rowspan", up.rowspan + 1)
  self:cover(up, r, r + 1, up.col, up.col + up.colspan)
  return true
end

-- Place a cell at (r, c), which is not covered (spec 3.3). `source` is the
-- index of the cell in its row's text, or nil for a cell added by padding.
function Grid:place(r, c, text, source)
  if text == COLSPAN_MARKER and self:extend_left(r, c) then
    return
  end
  if text == ROWSPAN_MARKER and self:extend_up(r, c) then
    return
  end
  local colspan, rowspan, fixed_cols, fixed_rows = 1, 1, false, false
  if text ~= COLSPAN_MARKER and text ~= ROWSPAN_MARKER then -- an unusable marker stays text
    local attr
    text, attr = split_attribute(text)
    if attr then
      for _, message in ipairs(attr.problems) do
        self:report("V1", r, c, message)
      end
      colspan, fixed_cols = attr.colspan or 1, attr.colspan ~= nil
      rowspan, fixed_rows = attr.rowspan or 1, attr.rowspan ~= nil
    end
  end
  -- Checks in the order of spec Section 5: V2, V3, V7, then V4.
  if c + colspan > self.cols then
    self:report("V2", r, c, ("colspan %d reaches past the last column"):format(colspan))
    colspan = self.cols - c
  end
  if r + rowspan > self.rows then
    self:report("V3", r, c, ("rowspan %d reaches past the last row"):format(rowspan))
    rowspan = self.rows - r
  end
  if r < self.header_rows and self.header_rows < r + rowspan then
    self:report("V7", r, c, "a header cell spans into the body")
    rowspan = self.header_rows - r
  end
  -- V4: the largest rectangle that overlaps nothing, columns first, then rows.
  local k = 1
  while k < colspan and not self.owner[r][c + k] do
    k = k + 1
  end
  local j = 1
  while j < rowspan and self:is_free(r + j, r + j + 1, c, c + k) do
    j = j + 1
  end
  if k ~= colspan or j ~= rowspan then
    self:report("V4", r, c, ("span cut from %dx%d to %dx%d to avoid an overlap"):format(colspan, rowspan, k, j))
    colspan, rowspan = k, j
  end
  local origin = {
    row = r, col = c, rowspan = rowspan, colspan = colspan, text = text,
    fixed_cols = fixed_cols, fixed_rows = fixed_rows, source = source,
  }
  self:assign(self.origins, #self.origins + 1, origin)
  self:cover(origin, r, r + rowspan, c, c + colspan)
end

-- Whether a row fits as a compact row: placing its cells into the positions
-- that are not covered fills them all, and the cells left over are empty.
function Grid:compact_fits(r, texts)
  self.journal = {}
  local used, fits = 0, true
  for c = 0, self.cols - 1 do
    if not self.owner[r][c] then
      if used == #texts then
        fits = false
        break
      end
      used = used + 1
      self:place(r, c, texts[used])
    end
  end
  if fits then
    for i = used + 1, #texts do
      if texts[i] ~= "" then
        fits = false
        break
      end
    end
  end
  self:rollback()
  return fits
end

-- Place row r (spec 3.2). Returns "grid", "compact" or "padded" (V14).
function Grid:add_row(r, texts)
  local n = #texts
  if n ~= self.cols and self:compact_fits(r, texts) then
    local index = 0
    for c = 0, self.cols - 1 do
      if not self.owner[r][c] then
        index = index + 1
        self:place(r, c, texts[index], index)
      end
    end
    return "compact"
  end
  local form = "grid"
  if n ~= self.cols then
    self:report("V14", r, nil, ("row has %d cells; it fits neither as a grid row (%d cells) nor as a compact row")
      :format(n, self.cols))
    form = "padded"
  end
  for c = 0, self.cols - 1 do
    local text = texts[c + 1] or ""
    local covering = self.owner[r][c]
    if covering then
      if text ~= "" and text ~= COLSPAN_MARKER and text ~= ROWSPAN_MARKER then
        self:report(covering.row < r and "V5" or "V6", r, c,
          ("a covered position holds text %q; it is dropped"):format(text))
      end
    else
      self:place(r, c, text, c < n and c + 1 or nil)
    end
  end
  return form
end

---------------------------------------------------------------------------
-- Finding and parsing tables (spec Sections 2 and 3)
---------------------------------------------------------------------------

local function slice(list, first, last)
  return table.move(list, first, last or #list, 1, {})
end

-- The table whose delimiter row is lines[d], or nil if its last header row
-- does not fit (spec 2.3).
local function try_table(lines, d, first_line, ends_body)
  -- Header rows: the line above the delimiter row and the pipe-led lines above
  -- it. A last header row in the form of a delimiter row is the only one.
  local top = d - 1
  if not M.is_delimiter_row(lines[d - 1]) then
    while top > 1 and M.is_upper_header_row(lines[top - 1]) do
      top = top - 1
    end
  end
  local after = d + 1
  while after <= #lines and not M.ends_table_body(lines[after]) and not (ends_body and ends_body(lines[after])) do
    after = after + 1
  end

  local header_rows = d - top
  local align = {}
  for i, text in ipairs(M.split_row(lines[d])) do
    align[i] = alignment(text)
  end
  local row_lines = {} -- index in `lines` of each grid row
  for i = top, after - 1 do
    if i ~= d then
      row_lines[#row_lines + 1] = i
    end
  end
  local grid = new_grid(#align, header_rows, #row_lines)
  local spans, forms = {}, {}
  for r, i in ipairs(row_lines) do
    spans[r] = M.split_row_spans(lines[i])
    local texts = {}
    for k, cell in ipairs(spans[r]) do
      texts[k] = cell.text
    end
    forms[r] = grid:add_row(r - 1, texts)
  end
  if forms[header_rows] == "padded" then
    return nil -- the last header row must fit (spec 2.3)
  end

  local origins = grid.origins
  table.sort(origins, function(a, b)
    return a.row < b.row or (a.row == b.row and a.col < b.col)
  end)
  local cells, sources = {}, {}
  for k, o in ipairs(origins) do
    cells[k] = { row = o.row, col = o.col, rowspan = o.rowspan, colspan = o.colspan, text = M.cell_lines(o.text) }
    local i = row_lines[o.row + 1]
    local start, stop
    if o.source then
      local span = spans[o.row + 1][o.source]
      start, stop = span.start, span.stop
    else -- added by padding: an empty range at the end of the line
      start, stop = #lines[i] + 1, #lines[i]
    end
    sources[k] = {
      row = o.row, col = o.col, rowspan = o.rowspan, colspan = o.colspan,
      line = first_line + i - 1, start = start, stop = stop,
    }
  end
  return {
    table = {
      version = M.MODEL_VERSION, rows = #row_lines, cols = #align,
      header_rows = header_rows, align = align, cells = cells,
    },
    problems = grid.problems,
    forms = forms,
    sources = sources,
    before = slice(lines, 1, top - 1),
    after = slice(lines, after),
    first = first_line + top - 1,
    last = first_line + after - 2,
  }
end

--- Parse one block of consecutive non-blank lines that may contain a table.
--
-- `block` is a string (split at "\n") or a list of lines; `first_line` is the
-- line number of its first line (default 1). A table may begin on any line of
-- the block; delimiter rows are tried from the top (spec 2.3).
--
-- `options.ends_body`, if given, is a function of a line that returns true
-- where the host Markdown processor starts another block, which also ends a
-- table body (spec 2.4).
--
-- Returns a result with:
--
-- * `table`: the table model, or nil if the block holds no table
-- * `problems`: validation problems `{rule, row, col, message, severity}`;
--   `col` is nil for V14
-- * `forms`: how each row was read: "grid", "compact" or "padded" (V14)
-- * `sources`: for each cell, in the order of `table.cells`, where its source
--   is: `{row, col, rowspan, colspan, line, start, stop}`. A cell added by
--   padding has an empty range at the end of its line.
-- * `before`: lines before the table, which stay a paragraph
-- * `after`: lines from the first line after the table
-- * `first`, `last`: line numbers of the table's first and last lines
function M.parse_table(block, first_line, options)
  local lines = type(block) == "string" and M.split_lines(block) or block
  first_line = first_line or 1
  local ends_body = options and options.ends_body
  local clean = {}
  for i, line in ipairs(lines) do
    clean[i] = gsub(line, "\r+$", "")
  end
  for d = 2, #clean do
    -- The last header row is a paragraph line, as in GFM: not indented as
    -- code, not the start of another block, and not a setext heading
    -- underline below another paragraph line (spec 2.3).
    local above = clean[d - 1]
    if M.is_delimiter_row(clean[d]) and M.indentation(above) < 4 and not M.starts_block(above)
        and not (d >= 3 and is_setext_underline(above) and not M.starts_block(clean[d - 2])) then
      local result = try_table(clean, d, first_line, ends_body)
      if result then
        return result
      end
    end
  end
  return { table = nil, problems = {}, forms = {}, sources = {}, before = clean, after = {} }
end

local function fence_run(line)
  local run, rest = match(line, "^ ? ? ?(```+)(.*)$")
  if not run then
    run, rest = match(line, "^ ? ? ?(~~~+)(.*)$")
  end
  return run, rest
end

--- Find the LTEM tables in a Markdown document.
--
-- This is a light scan, not a full CommonMark parser, with the same block
-- rules as the other LTEM cores: it splits the text at blank lines and skips
-- fenced and indented code blocks. It does not look into block quotes or list
-- items. Line numbers in the results count lines of `markdown` from 1.
-- Returns a list of `parse_table` results that hold a table.
function M.find_tables(markdown)
  local results, block, block_start, fence = {}, {}, 1, nil

  local function flush()
    local pending, first = block, block_start
    block = {}
    while #pending > 0 do
      local result = M.parse_table(pending, first)
      if not result.table then
        return
      end
      results[#results + 1] = result
      pending, first = result.after, result.last + 1
    end
  end

  for i, line in ipairs(M.split_lines(markdown)) do
    if fence then
      local run, rest = fence_run(line)
      if run and sub(run, 1, 1) == sub(fence, 1, 1) and #run >= #fence and is_blank(rest) then
        fence = nil -- a closing fence (CommonMark)
      end
    else
      local run = fence_run(line)
      if run then
        flush()
        fence = run
      elseif is_blank(line) then
        flush()
      elseif #block == 0 and sub(line, 1, 4) == "    " then
        -- an indented code block
      else
        if #block == 0 then
          block_start = i
        end
        block[#block + 1] = line
      end
    end
  end
  flush()
  return results
end

---------------------------------------------------------------------------
-- The table model (ast/table-model.md)
---------------------------------------------------------------------------

local ALIGNMENTS = { left = true, center = true, right = true }

--- Check a table against the rules of the table model. Returns a list of
-- messages, empty if the table is valid.
function M.check(t)
  local problems = {}
  local function add(message)
    problems[#problems + 1] = message
  end
  if #t.align ~= t.cols then
    add(("align has %d entries, expected %d"):format(#t.align, t.cols))
  end
  if t.header_rows < 1 or t.header_rows > t.rows then
    add(("header_rows %d is outside 1..%d"):format(t.header_rows, t.rows))
  end
  local seen = {}
  for r = 0, t.rows - 1 do
    seen[r] = {}
  end
  for i = 2, #t.cells do
    local a, b = t.cells[i - 1], t.cells[i]
    if b.row < a.row or (b.row == a.row and b.col <= a.col) then
      add("cells are not sorted by row and column")
      break
    end
  end
  for _, c in ipairs(t.cells) do
    if c.rowspan < 1 or c.colspan < 1 or c.row < 0 or c.col < 0
        or c.row + c.rowspan > t.rows or c.col + c.colspan > t.cols then
      add(("cell (%d,%d) lies outside the grid"):format(c.row, c.col))
    else
      if c.row < t.header_rows and t.header_rows < c.row + c.rowspan then
        add(("header cell (%d,%d) reaches into the body"):format(c.row, c.col))
      end
      for r = c.row, c.row + c.rowspan - 1 do
        for k = c.col, c.col + c.colspan - 1 do
          if seen[r][k] then
            add(("position (%d,%d) belongs to two cells"):format(r, k))
          end
          seen[r][k] = true
        end
      end
    end
    if find(c.text, "\\\\", 1, true) then
      add(("cell (%d,%d) text has two backslashes in a row, which LTEM 1.0 reads as a line break")
        :format(c.row, c.col))
    end
  end
  local holes = 0
  for r = 0, t.rows - 1 do
    for k = 0, t.cols - 1 do
      if not seen[r][k] then
        holes = holes + 1
      end
    end
  end
  if holes > 0 then
    add(("%d positions have no cell"):format(holes))
  end
  return problems
end

local function integer_field(value, name)
  local n = math.type(value) and math.tointeger(value)
  if not n then
    error(("%s must be an integer"):format(name), 0)
  end
  return n
end

local function read_model(value)
  if type(value) ~= "table" then
    error("a table model is a JSON object", 0)
  end
  if value.version ~= M.MODEL_VERSION then
    error(("unsupported table model version: %s"):format(tostring(value.version)), 0)
  end
  if type(value.align) ~= "table" or type(value.cells) ~= "table" then
    error("align and cells must be arrays", 0)
  end
  local t = {
    version = M.MODEL_VERSION,
    rows = integer_field(value.rows, "rows"),
    cols = integer_field(value.cols, "cols"),
    header_rows = integer_field(value.header_rows, "header_rows"),
    align = {},
    cells = {},
  }
  -- JSON arrays may hold null, which a JSON library represents by nil or by
  -- a sentinel value, so count entries up to the highest index.
  local count = 0
  for i in pairs(value.align) do
    if math.type(i) == "integer" and i > count then
      count = i
    end
  end
  for i = 1, count do
    local a = value.align[i]
    if type(a) == "string" then
      if not ALIGNMENTS[a] then
        error(("unknown alignment: %s"):format(a), 0)
      end
      t.align[i] = a
    else
      t.align[i] = false
    end
  end
  for i, c in ipairs(value.cells) do
    if type(c) ~= "table" or type(c.text) ~= "string" then
      error(("cell %d must be an object with a string text"):format(i), 0)
    end
    t.cells[i] = {
      row = integer_field(c.row, "row"), col = integer_field(c.col, "col"),
      rowspan = integer_field(c.rowspan, "rowspan"), colspan = integer_field(c.colspan, "colspan"),
      text = c.text,
    }
  end
  return t
end

--- Read a table model from a decoded JSON value, such as the result of
-- `pandoc.json.decode`. Numbers may be floats with integral values; an entry
-- of `align` that is not a string (nil, false or a JSON null sentinel) means no
-- alignment. Returns the table, or nil and a message. The result may still
-- break the model rules; see `check`.
function M.read_model(value)
  local ok, result = pcall(read_model, value)
  if ok then
    return result
  end
  return nil, result
end

---------------------------------------------------------------------------
-- HTML output (spec Section 6)
---------------------------------------------------------------------------

local ASCII_PUNCTUATION = "[!\"#$%%&'()*+,%-./:;<=>?@%[\\%]^_`{|}~]"
local HTML_ESCAPES = { ["&"] = "&amp;", ["<"] = "&lt;", [">"] = "&gt;", ['"'] = "&quot;" }

local function escape_html(s)
  return (gsub(s, "[&<>\"]", HTML_ESCAPES))
end

--- Render inline text with CommonMark backslash escapes and HTML escaping only.
-- Emphasis, links and code are left as text.
function M.plain_inline(text)
  local out, i = {}, 1
  while i <= #text do
    local c = sub(text, i, i)
    if c == "\\" and find(sub(text, i + 1, i + 1), ASCII_PUNCTUATION) then
      c = sub(text, i + 1, i + 1)
      i = i + 1
    end
    out[#out + 1] = HTML_ESCAPES[c] or c
    i = i + 1
  end
  return concat(out)
end

--- Render a table as HTML, in the format of the specification's examples.
--
-- `inline` renders one line of cell text (default: `plain_inline`); the lines
-- of a cell are joined with `<br />`.
function M.render_html(t, inline)
  inline = inline or M.plain_inline
  local by_row = {}
  for _, cell in ipairs(t.cells) do
    by_row[cell.row] = by_row[cell.row] or {}
    table.insert(by_row[cell.row], cell)
  end
  local parts = {}
  local function add(s)
    parts[#parts + 1] = s
  end
  local function add_row(r)
    local tag = r < t.header_rows and "th" or "td"
    add("<tr>")
    local row = by_row[r] or {}
    table.sort(row, function(a, b) return a.col < b.col end)
    for _, cell in ipairs(row) do
      local attrs = ""
      if cell.colspan > 1 then
        attrs = attrs .. (' colspan="%d"'):format(cell.colspan)
      end
      if cell.rowspan > 1 then
        attrs = attrs .. (' rowspan="%d"'):format(cell.rowspan)
      end
      if t.align[cell.col + 1] then
        attrs = attrs .. (' align="%s"'):format(t.align[cell.col + 1])
      end
      local lines = {}
      for line in string.gmatch(cell.text .. "\n", "([^\n]*)\n") do
        lines[#lines + 1] = inline(line)
      end
      add(("<%s%s>%s</%s>"):format(tag, attrs, concat(lines, "<br />"), tag))
    end
    add("</tr>")
  end
  add("<table>")
  add("<thead>")
  for r = 0, t.header_rows - 1 do
    add_row(r)
  end
  add("</thead>")
  if t.rows > t.header_rows then
    add("<tbody>")
    for r = t.header_rows, t.rows - 1 do
      add_row(r)
    end
    add("</tbody>")
  end
  add("</table>")
  return concat(parts, "\n")
end

---------------------------------------------------------------------------
-- Canonical form (spec Section 8)
---------------------------------------------------------------------------

local DELIMITERS = { left = ":---", right = "---:", center = ":---:" }

-- Cell source for model text, with only the escapes that spec 4.3 requires.
local function cell_source(text)
  local lines = {}
  for line in string.gmatch(text .. "\n", "([^\n]*)\n") do
    lines[#lines + 1] = M.escape_notation((gsub(line, "|", "\\|")))
  end
  return concat(lines, " \\\\ ")
end

local function row_line(cells)
  return "| " .. concat(cells, " | ") .. " |"
end

--- Write a table in the canonical form (spec Section 8): every row is a grid
-- row, a covered position in its cell's origin column is `^^` and every other
-- covered position `<<`, and no span attributes are used.
--
-- Returns the text without a final line break, or nil and a message if the
-- table breaks the rules of the table model.
function M.write(t)
  local problems = M.check(t)
  if #problems > 0 then
    return nil, "invalid table model: " .. concat(problems, "; ")
  end
  local grid = {}
  for r = 0, t.rows - 1 do
    grid[r] = {}
  end
  for _, cell in ipairs(t.cells) do
    for r = cell.row, cell.row + cell.rowspan - 1 do
      for c = cell.col, cell.col + cell.colspan - 1 do
        grid[r][c] = cell
      end
    end
  end
  local rows = {}
  for r = 0, t.rows - 1 do
    local row = {}
    for c = 0, t.cols - 1 do
      local cell = grid[r][c]
      if cell.row == r and cell.col == c then
        row[c + 1] = cell_source(cell.text)
      elseif cell.col == c then
        row[c + 1] = ROWSPAN_MARKER
      else
        row[c + 1] = COLSPAN_MARKER
      end
    end
    rows[r + 1] = row
  end
  -- A header row of hyphen cells would read as the delimiter row (spec 4.3).
  for r = 1, t.header_rows do
    local all_hyphens = true
    for _, text in ipairs(rows[r]) do
      if not find(text, "^:?%-+:?$") then
        all_hyphens = false
        break
      end
    end
    if all_hyphens then
      rows[r][1] = "\\" .. rows[r][1]
    end
  end
  -- A header row above the last one in the form of a reserved identifier line
  -- would end the header rows (spec 4.3, Section 9).
  for r = 1, t.header_rows - 1 do
    if is_identifier_line(row_line(rows[r])) then
      rows[r][1] = "\\" .. rows[r][1]
    end
  end
  local delimiters = {}
  for c = 1, t.cols do
    delimiters[c] = DELIMITERS[t.align[c]] or "---"
  end
  local lines = {}
  for r = 1, t.rows do
    lines[#lines + 1] = row_line(rows[r])
    if r == t.header_rows then
      lines[#lines + 1] = row_line(delimiters)
    end
  end
  return concat(lines, "\n")
end

return M
