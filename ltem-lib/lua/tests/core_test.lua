--- Unit tests of the core (ltem.lua): rows, lines, cell sources, the table
-- model, the writer and the HTML renderer.

local support = require("support")
local ltem = require("ltem")
local test, eq, ok = support.test, support.eq, support.ok

---------------------------------------------------------------------------
-- Rows and lines
---------------------------------------------------------------------------

test("split_row: escaped pipes, outer pipes and trimming", function()
  eq(ltem.split_row("| a | b |"), { "a", "b" })
  eq(ltem.split_row("a | b"), { "a", "b" })
  eq(ltem.split_row("| a \\| b | c |"), { "a | b", "c" })
  eq(ltem.split_row("| a \\\\| b |"), { "a \\| b" }) -- only the backslash before the pipe counts
  eq(ltem.split_row("| a | b \\|"), { "a", "b |" }) -- an escaped last pipe is text
  eq(ltem.split_row("|\t a \t|  |"), { "a", "" })
  eq(ltem.split_row("| \u{3000}x\u{3000} |"), { "\u{3000}x\u{3000}" }) -- U+3000 is not trimmed
  eq(ltem.split_row("|"), { "" })
  eq(ltem.split_row("||"), { "" })
  eq(ltem.split_row("|||"), { "", "" })
end)

test("split_row_spans: byte positions of the cell sources", function()
  local line = "| 한국 | a \\| b |  |"
  local spans = ltem.split_row_spans(line)
  eq(#spans, 3)
  eq(line:sub(spans[1].start, spans[1].stop), "한국")
  eq(line:sub(spans[2].start, spans[2].stop), "a \\| b")
  eq(spans[3].stop, spans[3].start - 1) -- an empty cell
  eq(spans[3].start, #line) -- at the end of its space, before the last pipe
end)

test("split_lines: CommonMark line endings", function()
  eq(ltem.split_lines("a\r\nb\rc\nd"), { "a", "b", "c", "d" })
  eq(ltem.split_lines("a\n"), { "a", "" })
  eq(ltem.split_lines(""), { "" })
end)

test("indentation: tab stops every four columns", function()
  eq(ltem.indentation("   x"), 3)
  eq(ltem.indentation("\tx"), 4)
  eq(ltem.indentation("  \tx"), 4)
  eq(ltem.indentation(" \t \tx"), 8)
  eq(ltem.indentation("\u{3000}x"), 0)
end)

test("delimiter rows, blocks and thematic breaks", function()
  ok(ltem.is_delimiter_row("|---|:--|--:|:-:|"))
  ok(ltem.is_delimiter_row("--|--"))
  ok(ltem.is_delimiter_row("   |-|"))
  ok(not ltem.is_delimiter_row("    |-|"), "indented by four")
  ok(not ltem.is_delimiter_row("- | -"), "a list item")
  ok(not ltem.is_delimiter_row(":--"), "no pipe")
  ok(not ltem.is_delimiter_row("|-:-|"))
  ok(not ltem.is_delimiter_row("|---|x|"))
  for _, line in ipairs { "> q", "# h", "###### h", "#", "```", "~~~x", "***", "- - -", "_ _ _", "- x", "+",
    "1. x", "123456789) x", "   > q" } do
    ok(ltem.starts_block(line), line)
  end
  for _, line in ipairs { "####### h", "#h", "``", "**", "-x", "1234567890. x", "1.x", "    > q", "\t# h", "a" } do
    ok(not ltem.starts_block(line), line)
  end
  ok(ltem.is_thematic_break(" * * *"))
  ok(not ltem.is_thematic_break("    ***"))
  ok(not ltem.is_thematic_break("*-*"))
  ok(ltem.ends_table_body("  \t"))
  ok(not ltem.ends_table_body("\u{3000}"))
end)

test("cell_lines and escape_notation", function()
  eq(ltem.cell_lines("a \\\\ b"), "a\nb")
  eq(ltem.cell_lines("a\\\\\\b"), "a\n\\b") -- backslashes pair from the left
  eq(ltem.cell_lines("\\<< \\\\ \\^^ \\\\ x \\{c:2}"), "<<\n^^\nx {c:2}")
  eq(ltem.cell_lines("x\\{c:2}"), "x\\{c:2}") -- no space before the escape: kept
  eq(ltem.cell_lines("a \\{b}"), "a \\{b}")
  eq(ltem.escape_notation("<<"), "\\<<")
  eq(ltem.escape_notation("^^"), "\\^^")
  eq(ltem.escape_notation("x {c:2}"), "x \\{c:2}")
  eq(ltem.escape_notation("{r:1,c:2}"), "\\{r:1,c:2}")
  eq(ltem.escape_notation("x{c:2}"), "x{c:2}")
  eq(ltem.escape_notation("a << b"), "a << b")
end)

---------------------------------------------------------------------------
-- Parsing
---------------------------------------------------------------------------

test("parse_table: lines before and after, line numbers, ends_body", function()
  local r = ltem.parse_table({ "Intro", "| a |", "|---|", "| 1 |", "- item" }, 10)
  eq(r.before, { "Intro" })
  eq(r.after, { "- item" })
  eq({ r.first, r.last }, { 11, 13 })
  local hosted = ltem.parse_table("| a |\n|---|\n| 1 |\n: caption", 1, {
    ends_body = function(line) return line:sub(1, 1) == ":" end,
  })
  eq(hosted.table.rows, 2)
  eq(hosted.after, { ": caption" })
  eq(ltem.parse_table("| a |\r\n|---|\r\n").table.rows, 1)
  eq(ltem.parse_table("no table").table, nil)
end)

test("find_tables: fences, indented code, blank lines and several tables", function()
  local text = table.concat({
    "```", "| a |", "|---|", "````",        -- a fence closes with a longer fence
    "~~~", "| b |", "|---|", "```", "~~~",  -- only the same character closes it
    "",
    "    | c |", "    |---|",                  -- indented code
    " \t",
    "| d |", "|---|", "\u{3000}", "| e |",    -- U+3000 is not blank: body rows
    "",
    "| f |", "|---|", "# h", "| g |", "|---|", -- a heading ends a body; a new table starts below it
  }, "\n")
  local results = ltem.find_tables(text)
  local firsts = {}
  for i, r in ipairs(results) do
    firsts[i] = r.first .. "-" .. r.last .. ":" .. r.table.cells[1].text
  end
  eq(firsts, { "14-17:d", "19-20:f", "22-23:g" })
  eq(#ltem.find_tables("```\n| a |\n|---|\n"), 0) -- an unclosed fence runs to the end
end)

test("span values larger than any table are cut at the edge", function()
  local r = ltem.parse_table("| a {c:99999999999999999999} | b |\n|---|---|\n| 1 {r:000000000000000000002} | 2 |")
  eq(r.table.cells[1].colspan, 2)
  local rules = {}
  for _, p in ipairs(r.problems) do
    rules[#rules + 1] = p.rule
  end
  eq(rules, { "V2", "V6", "V3" }) -- b is in a position that a covers
end)

test("problems carry rule, position, message and severity", function()
  local r = ltem.parse_table("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |")
  eq(r.problems[1].rule, "V14")
  eq(r.problems[1].col, nil)
  eq(r.problems[1].severity, "warning")
  eq(r.forms, { "grid", "padded", "padded" })
  local v13 = ltem.parse_table("| a | b |\n|---|---|\n| << | 1 |").problems[1]
  eq({ v13.rule, v13.row, v13.col, v13.severity }, { "V13", 1, 0, "error" })
  ok(v13.message:find("<<", 1, true))
end)

---------------------------------------------------------------------------
-- Cell sources
---------------------------------------------------------------------------

-- The model text of a cell whose source is line:sub(start, stop), for
-- canonical text, which has no span attributes.
local function text_at(line, s)
  return ltem.cell_lines((line:sub(s.start, s.stop):gsub("\\|", "|")))
end

test("sources: compact rows, attributes, escapes and padding", function()
  local src = "intro\n| R {c:2} |\n| a   | \\| b |\n|---|---|\n| x | y |\n| z |"
  local r = ltem.parse_table(src)
  local lines = ltem.split_lines(src)
  local got = {}
  for i, s in ipairs(r.sources) do
    got[i] = { s.row, s.col, s.rowspan, s.colspan, s.line, lines[s.line]:sub(s.start, s.stop) }
  end
  eq(got, {
    { 0, 0, 1, 2, 2, "R {c:2}" }, { 1, 0, 1, 1, 3, "a" }, { 1, 1, 1, 1, 3, "\\| b" },
    { 2, 0, 1, 1, 5, "x" }, { 2, 1, 1, 1, 5, "y" }, { 3, 0, 1, 1, 6, "z" }, { 3, 1, 1, 1, 6, "" },
  })
  local padded = r.sources[#r.sources]
  eq({ padded.start, padded.stop }, { #lines[6] + 1, #lines[6] })
end)

test("sources in find_tables count document lines", function()
  local doc = "# Title\n\n| 한 | << |\n|---|---|\n| 1 | 2 |\n"
  local r = ltem.find_tables(doc)[1]
  local lines = ltem.split_lines(doc)
  local got = {}
  for i, s in ipairs(r.sources) do
    got[i] = s.line .. ":" .. lines[s.line]:sub(s.start, s.stop)
  end
  eq(got, { "3:한", "5:1", "5:2" })
end)

---------------------------------------------------------------------------
-- Random valid tables: writing, reading back and sources
---------------------------------------------------------------------------

local TEXTS = { "", "x", "Revenue", "**Q1**", "a | b", "line 1\nline 2", "\u{3000}indent", "<<", "^^", "a << b",
  "{c:2}", "x {r:3}", "$5 ~ $10", "-", "100", "한국어", "# x", ":--" }
local ALIGNS = { false, "left", "center", "right" }

-- A valid table: spans fill free rectangles and stay within header or body.
local function random_table(rows, cols, header_rows)
  local taken, cells = {}, {}
  for r = 0, rows - 1 do
    taken[r] = {}
  end
  for r = 0, rows - 1 do
    for c = 0, cols - 1 do
      if not taken[r][c] then
        local bottom = r < header_rows and header_rows or rows
        local max_cs = 1
        while c + max_cs < cols and not taken[r][c + max_cs] and max_cs < 4 do
          max_cs = max_cs + 1
        end
        local cs = math.random() < 0.3 and math.random(1, max_cs) or 1
        local rs = math.random() < 0.3 and math.random(1, math.min(3, bottom - r)) or 1
        local function blocked(n)
          for k = c, c + cs - 1 do
            if taken[r + n - 1][k] then
              return true
            end
          end
          return false
        end
        while rs > 1 and blocked(rs) do
          rs = rs - 1
        end
        for dr = 0, rs - 1 do
          for dc = 0, cs - 1 do
            taken[r + dr][c + dc] = true
          end
        end
        cells[#cells + 1] = { row = r, col = c, rowspan = rs, colspan = cs, text = TEXTS[math.random(#TEXTS)] }
      end
    end
  end
  local align = {}
  for c = 1, cols do
    align[c] = ALIGNS[math.random(#ALIGNS)]
  end
  return { version = "1.0", rows = rows, cols = cols, header_rows = header_rows, align = align, cells = cells }
end

-- The writer adds `\-` and `\#` to some header rows (spec 4.3); they stay in
-- the text when read back.
local function without_writer_escapes(t)
  for _, c in ipairs(t.cells) do
    c.text = c.text:gsub("^\\([-:#])", "%1")
  end
  return t
end

test("write then parse gives the same table, on 3000 random tables", function()
  math.randomseed(11)
  for _ = 1, 3000 do
    local rows = math.random(1, 7)
    local t = random_table(rows, math.random(1, 6), math.random(1, rows))
    local text = assert(ltem.write(t))
    local r = ltem.parse_table(text)
    eq(without_writer_escapes(r.table), t, text)
    eq(#r.problems, 0, text)
    eq(r.first, 1)
    eq(r.last, t.rows + 1)
    -- The canonical form is a fixed point.
    eq(ltem.write(r.table), text)
  end
end)

test("sources of random documents point at the cells", function()
  math.randomseed(5)
  for _ = 1, 1000 do
    local rows = math.random(1, 6)
    local t = random_table(rows, math.random(1, 5), math.random(1, rows))
    local doc = "Some text\n\n" .. assert(ltem.write(t)) .. "\n\nafter\n"
    local r = ltem.find_tables(doc)[1]
    local lines = ltem.split_lines(doc)
    for k, cell in ipairs(r.table.cells) do
      local s = r.sources[k]
      eq({ s.row, s.col, s.rowspan, s.colspan }, { cell.row, cell.col, cell.rowspan, cell.colspan })
      eq(text_at(lines[s.line], s), cell.text, doc)
    end
  end
end)

---------------------------------------------------------------------------
-- The table model
---------------------------------------------------------------------------

test("read_model: numbers as floats, null alignment, errors", function()
  local t = assert(ltem.read_model {
    version = "1.0", rows = 1.0, cols = 2, header_rows = 1, align = { pandoc.json.null, "left" },
    cells = { { row = 0, col = 0, rowspan = 1, colspan = 2.0, text = "a" } },
  })
  eq(t.align, { false, "left" })
  eq(math.type(t.cells[1].colspan), "integer")
  local sparse = assert(ltem.read_model {
    version = "1.0", rows = 1, cols = 2, header_rows = 1, align = { [2] = "right" },
    cells = { { row = 0, col = 0, rowspan = 1, colspan = 2, text = "a" } },
  })
  eq(sparse.align, { false, "right" })
  local function fails(value, pattern)
    local result, err = ltem.read_model(value)
    eq(result, nil)
    ok(err:find(pattern, 1, true), err)
  end
  fails("x", "JSON object")
  fails({ version = "2.0" }, "version")
  fails({ version = "1.0", rows = 1, cols = 1, header_rows = 1, align = { "middle" }, cells = {} }, "alignment")
  fails({ version = "1.0", rows = 1.5, cols = 1, header_rows = 1, align = {}, cells = {} }, "rows")
  fails({ version = "1.0", rows = 1, cols = 1, header_rows = 1, align = {}, cells = { { row = 0 } } }, "cell 1")
end)

test("check and write reject tables that break the model rules", function()
  local function problems(t)
    return ltem.check(t)
  end
  local base = function()
    return { version = "1.0", rows = 2, cols = 2, header_rows = 1, align = { false, false }, cells = {
      { row = 0, col = 0, rowspan = 1, colspan = 2, text = "a" },
      { row = 1, col = 0, rowspan = 1, colspan = 1, text = "b" },
      { row = 1, col = 1, rowspan = 1, colspan = 1, text = "c" },
    } }
  end
  eq(problems(base()), {})
  local t = base()
  t.cells[1].rowspan = 2
  ok(#problems(t) >= 2) -- reaches into the body and overlaps
  t = base()
  table.remove(t.cells)
  eq(problems(t), { "1 positions have no cell" })
  t = base()
  t.cells[2].text = "a\\\\b"
  ok(problems(t)[1]:find("two backslashes", 1, true))
  t = base()
  t.cells[2], t.cells[3] = t.cells[3], t.cells[2]
  eq(problems(t), { "cells are not sorted by row and column" })
  local text, err = ltem.write(t)
  eq(text, nil)
  ok(err:find("invalid table model", 1, true))
end)

---------------------------------------------------------------------------
-- HTML
---------------------------------------------------------------------------

test("plain_inline: CommonMark backslash escapes and HTML escaping", function()
  eq(ltem.plain_inline("a \\* b \\q <x> & \"y\" 'z'"), "a * b \\q &lt;x&gt; &amp; &quot;y&quot; 'z'")
  eq(ltem.plain_inline("\\\\"), "\\")
  eq(ltem.plain_inline("trailing \\"), "trailing \\")
end)

test("render_html: structure, attributes and the inline renderer", function()
  local t = ltem.parse_table("| a {c:2} |\n|:-:|--:|").table
  eq(ltem.render_html(t), '<table>\n<thead>\n<tr>\n<th colspan="2" align="center">a</th>\n</tr>\n</thead>\n</table>')
  local body = ltem.parse_table("| a |\n|---|\n| x \\\\ *y* |").table
  local html = ltem.render_html(body, function(line) return "[" .. line .. "]" end)
  ok(html:find("<td>[x]<br />[*y*]</td>", 1, true), html)
  ok(html:find("<tbody>", 1, true))
end)
