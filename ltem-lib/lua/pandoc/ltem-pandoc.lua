--- Pandoc integration for LTEM tables: the code behind the custom readers and
-- the filter.
--
-- How a document is read:
--
-- 1. A line scanner follows CommonMark's container rules (block quotes, list
--    items) and skips code, raw HTML and other blocks whose lines are not
--    Markdown text. In each run of paragraph lines it finds the LTEM tables
--    with the core library.
-- 2. Each table is replaced by a placeholder: a one-cell pipe table holding a
--    unique word. Pandoc reads the whole document with the base format, so
--    containers, list tightness, table captions, references and footnotes
--    follow the base format, as they would for a pipe table at that place.
-- 3. After a paragraph with a unique boundary word, the text of every cell
--    line is appended to the document as a paragraph that starts with a
--    unique word, so that Pandoc parses it as inlines in the context of the
--    document (reference links, footnotes, citations). Everything after the
--    boundary is taken out of the document again.
-- 4. Each placeholder is replaced by the real table, built from the table
--    model and the parsed cell inlines; the placeholder's caption and
--    attributes are kept. If the base format did not read a placeholder as a
--    table (for example because the lines are raw HTML to it), the document is
--    read again without that table, so that those lines read as they would
--    without LTEM.
--
-- A delimiter row that LTEM does not use gets an escaped pipe (`\|`), which
-- renders the same, so that the base format cannot make a pipe table of it:
-- LTEM takes the place of the pipe table syntax.

local ltem = require("ltem")

local M = {}

--- Write a warning to Pandoc's log.
local function warn(message)
  if pandoc.log then
    pandoc.log.warn(message)
  else
    io.stderr:write("[WARNING] ", message, "\n")
  end
end
M.warn = warn

local byte, find, match, sub, rep = string.byte, string.find, string.match, string.sub, string.rep
local SPACE, TAB, GT = 32, 9, 62

local function is_space_or_tab(b)
  return b == SPACE or b == TAB
end

local function is_blank(s)
  return find(s, "^[ \t]*$") ~= nil
end

local function unindented(s)
  return sub(s, match(s, "^ ? ? ?()"))
end

-- A run of three or more backticks or of three or more tildes that starts
-- `text`, and the text after it.
local function fence_run(text)
  local run, after = match(text, "^(```+)(.*)$")
  if not run then
    run, after = match(text, "^(~~~+)(.*)$")
  end
  return run, after
end

---------------------------------------------------------------------------
-- Formats
---------------------------------------------------------------------------

-- Readers built on Pandoc's own Markdown reader. They size the columns of a
-- pipe table by its delimiter row when a line of the table is long.
local PANDOC_MARKDOWN = {
  markdown = true, markdown_mmd = true, markdown_phpextra = true, markdown_github = true, markdown_strict = true,
}

-- The extensions that can be set for a format, with their default status.
-- (Pandoc lists some defaults that cannot be set, such as auto_identifiers
-- for gfm.)
local function settable_extensions(base)
  local defaults = pandoc.format.extensions(base)
  local extensions = {}
  for _, name in ipairs(pandoc.format.all_extensions(base)) do
    extensions[name] = defaults[name] or false
  end
  return extensions
end

--- The base format of a format spec such as "markdown+emoji-smart", as
-- `{format = name, extensions = {name = enabled, ...}}`.
function M.resolve_format(spec)
  local base = match(spec, "^[%w_]+")
  if not base then
    error("not a format: " .. spec, 0)
  end
  local extensions = settable_extensions(base)
  for sign, name in sub(spec, #base + 1):gmatch("([+-])([%w_]+)") do
    extensions[name] = sign == "+"
  end
  return { format = base, extensions = extensions }
end

local function enabled_format(base, enabled)
  local extensions = settable_extensions(base)
  for name in pairs(extensions) do
    extensions[name] = false
  end
  for _, name in ipairs(enabled) do
    extensions[name] = true
  end
  return { format = base, extensions = extensions }
end

---------------------------------------------------------------------------
-- Block rules of the base format
---------------------------------------------------------------------------

-- Tag names of CommonMark HTML blocks of type 6.
local BLOCK_TAGS = {}
for name in ([[address article aside base basefont blockquote body caption center col colgroup dd details
  dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr
  html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary
  table tbody td tfoot th thead title tr track ul]]):gmatch("%S+") do
  BLOCK_TAGS[name] = true
end

local VERBATIM_TAGS = { pre = true, script = true, style = true, textarea = true }

-- The type (1 to 7) of the CommonMark HTML block that a line starts, after its
-- indentation, and for types 1 to 5 the text that ends the block.
local function html_block_start(rest)
  if byte(rest) ~= 60 then -- "<"
    return nil
  end
  local lower = rest:lower()
  local tag, after = match(lower, "^<([a-z]+)(.?)")
  if tag and VERBATIM_TAGS[tag] and (after == "" or find(after, "^[ \t>]")) then
    return 1, "</" .. tag .. ">"
  elseif find(rest, "^<!%-%-") then
    return 2, "-->"
  elseif find(rest, "^<%?") then
    return 3, "?>"
  elseif find(rest, "^<![A-Za-z]") then
    return 4, ">"
  elseif find(rest, "^<!%[CDATA%[") then
    return 5, "]]>"
  end
  local name, rest_of_tag = match(lower, "^</?([a-z][a-z0-9]*)(.?.?)")
  if name and BLOCK_TAGS[name]
      and (rest_of_tag == "" or find(rest_of_tag, "^[ \t>]") or rest_of_tag == "/>") then
    return 6
  end
  if find(rest, "^</?[A-Za-z][A-Za-z0-9-]*[^<>]*>[ \t]*$") then
    return 7 -- a complete tag alone on its line
  end
  return nil
end

-- A Pandoc table caption: ":" not followed by punctuation, or "Table:".
local function is_caption_line(line)
  local rest = unindented(line)
  if find(rest, "^[Tt]able:") then
    return true
  end
  return find(rest, "^:") ~= nil and not find(rest, "^:[!-/:-@%[-`{-~]") and not is_blank(sub(rest, 2))
end

-- The parts of the base format's block syntax that the scanner must know.
local function host_rules(format)
  local ext = format.extensions
  local markdown = PANDOC_MARKDOWN[format.format] or false
  return {
    markdown = markdown,                    -- Pandoc's Markdown reader, not CommonMark
    sized_columns = markdown,
    backtick_fences = not markdown or ext.backtick_code_blocks,
    tilde_fences = not markdown or ext.fenced_code_blocks,
    captions = markdown and ext.table_captions,
    divs = markdown and ext.fenced_divs,
    -- a YAML metadata block: anywhere after a blank line in Pandoc's
    -- Markdown, only at the start of the document in CommonMark
    yaml = ext.yaml_metadata_block and (markdown and "anywhere" or "start"),
    grid_tables = markdown and ext.grid_tables,
    raw_tex = markdown and ext.raw_tex,
    footnotes = markdown and ext.footnotes,
    definitions = ext.definition_lists,
    raw_html = ext.raw_html,
    title_block = markdown and ext.pandoc_title_block,
    fancy_lists = markdown and ext.fancy_lists,
    example_lists = markdown and ext.example_lists,
  }
end

---------------------------------------------------------------------------
-- The line scanner
---------------------------------------------------------------------------

-- A position in a line, as in commonmark.js: the byte offset of the next
-- character and its column. A tab can be partly consumed; the offset then
-- stays on the tab while the column moves into it.
local function new_cursor(line)
  return { line = line, offset = 1, column = 0 }
end

-- Columns of indentation at the cursor, and the offset and column after it.
local function peek_indent(cur)
  local i, col, line = cur.offset, cur.column, cur.line
  while true do
    local b = byte(line, i)
    if b == SPACE then
      col = col + 1
    elseif b == TAB then
      col = col + 4 - col % 4
    else
      return col - cur.column, i, col
    end
    i = i + 1
  end
end

local function advance_columns(cur, count)
  while count > 0 do
    local b = byte(cur.line, cur.offset)
    if b == TAB then
      local to_tab_stop = 4 - cur.column % 4
      if to_tab_stop > count then
        cur.column = cur.column + count
        return
      end
      cur.column, cur.offset, count = cur.column + to_tab_stop, cur.offset + 1, count - to_tab_stop
    elseif b then
      cur.column, cur.offset, count = cur.column + 1, cur.offset + 1, count - 1
    else
      return
    end
  end
end

-- The rest of the line at the cursor, its indentation written as spaces so
-- that tab stops stay where they are in the whole line, and the offset of its
-- first character that is not a space or tab.
local function rest_of(cur)
  local indent, i = peek_indent(cur)
  return rep(" ", indent) .. sub(cur.line, i), i
end

-- A block quote marker `>` and the optional space after it.
local function take_quote_marker(cur)
  local indent, at, col = peek_indent(cur)
  if indent > 3 or byte(cur.line, at) ~= GT then
    return false
  end
  cur.offset, cur.column = at + 1, col + 1
  if is_space_or_tab(byte(cur.line, cur.offset)) then
    advance_columns(cur, 1)
  end
  return true
end

-- Whether open container `c` continues on the line at the cursor.
local function continues(c, cur)
  if c.kind == "quote" then
    return take_quote_marker(cur)
  end
  local indent, at, col = peek_indent(cur)
  if byte(cur.line, at) == nil then -- a blank line, which ends an item that is still empty
    if not c.has_content then
      return false
    end
    cur.offset, cur.column = at, col
    return true
  end
  if indent < c.width then
    return false
  end
  advance_columns(cur, c.width)
  return true
end

-- The spaces after a list marker, which is just behind the cursor: one to
-- four columns, or one if there are more (the rest is indented code) or the
-- item is empty. Returns their width.
local function take_marker_spaces(cur, empty)
  local spaces_offset, spaces_column = cur.offset, cur.column
  repeat
    advance_columns(cur, 1)
  until cur.column - spaces_column >= 5 or not is_space_or_tab(byte(cur.line, cur.offset))
  local spaces = cur.column - spaces_column
  if spaces >= 5 or spaces < 1 or empty then
    cur.offset, cur.column = spaces_offset, spaces_column
    if is_space_or_tab(byte(cur.line, cur.offset)) then
      advance_columns(cur, 1)
    end
    return 1
  end
  return spaces
end

-- The length of a list marker of Pandoc's fancy_lists and example_lists at
-- byte `at`: a number, `#`, a letter or a roman numeral, followed by `.` or
-- `)` or enclosed in parentheses, or `(@)` and `(@label)`. Nil if there is
-- none. A capital letter with a period needs two spaces after it, so that
-- "B. Russell" stays text.
local function fancy_marker(line, at, rules)
  local body, close = match(line, "^%(([^%s()]+)(%))", at)
  local len = body and #body + 2
  if not body then
    body, close = match(line, "^([^%s.()]+)([.)])", at)
    len = body and #body + 1
  end
  if not body then
    return nil
  end
  if rules.example_lists and close == ")" and line:sub(at, at) == "(" and find(body, "^@[%w_-]*$") then
    return len
  end
  if not rules.fancy_lists then
    return nil
  end
  if find(body, "^[A-Z]$") and close == "." and line:sub(at, at) ~= "(" and not find(line, "^[ \t][ \t]", at + len) then
    return nil
  end
  local numeral = (#body <= 9 and find(body, "^[0-9]+$")) or body == "#" or find(body, "^[a-zA-Z]$")
    or find(body, "^[ivxlcdm]+$") or find(body, "^[IVXLCDM]+$")
  return numeral and len or nil
end

-- A list item that starts at the cursor (CommonMark 5.2, and the markers of
-- Pandoc's fancy and example lists). Returns the container, or nil.
-- `interrupting` is true when the line would otherwise continue a paragraph;
-- then, as in CommonMark, the item must not be empty and, if ordered, must
-- start at 1.
local function take_list_item(cur, interrupting, rules)
  local indent, at, col = peek_indent(cur)
  local line = cur.line
  if indent > 3 or ltem.is_thematic_break(sub(line, at)) then
    return nil
  end
  local len, start
  if find(line, "^[-+*]", at) then
    len = 1
  else
    local digits = match(line, "^([0-9]+)[.)]", at)
    if digits and #digits <= 9 then
      len, start = #digits + 1, tonumber(digits)
    else
      len = (rules.fancy_lists or rules.example_lists) and fancy_marker(line, at, rules)
      if not len then
        return nil
      end
    end
  end
  local after = byte(line, at + len)
  if after and not is_space_or_tab(after) then
    return nil
  end
  local empty = is_blank(sub(line, at + len))
  if interrupting and (empty or (start and start ~= 1)) then
    return nil
  end
  cur.offset, cur.column = at + len, col + len
  return { kind = "item", width = indent + len + take_marker_spaces(cur, empty), has_content = not empty }
end

-- A definition (Pandoc's definition_lists): `:` or `~`, indented by at most
-- two spaces, then spaces and the definition, whose later lines are indented
-- like those of a list item.
local function take_definition(cur)
  local indent, at, col = peek_indent(cur)
  if indent > 2 or not find(cur.line, "^[:~][ \t]", at) then
    return nil
  end
  cur.offset, cur.column = at + 1, col + 1
  return { kind = "item", width = indent + 1 + take_marker_spaces(cur, false), has_content = true }
end

-- A Pandoc footnote definition, whose later blocks are indented by four columns.
local function take_footnote(cur)
  local indent, at, col = peek_indent(cur)
  local stop = indent <= 3 and select(2, find(cur.line, "^%[%^[^%]%s]+%]:", at))
  if not stop then
    return nil
  end
  cur.offset, cur.column = stop + 1, col + stop - at + 1
  return { kind = "item", width = 4, has_content = true }
end

-- For each line, the longest closing fence of each kind below it: Pandoc's
-- Markdown reads a fence without a closing fence as text. Containers are not
-- considered.
local function closing_fences(lines)
  local below, best = {}, { ["`"] = 0, ["~"] = 0 }
  for i = #lines, 1, -1 do
    below[i] = { ["`"] = best["`"], ["~"] = best["~"] }
    local run, after = fence_run(match(lines[i], "^[ \t>]*(.*)$"))
    if run and is_blank(after) then
      local char = sub(run, 1, 1)
      best[char] = math.max(best[char], #run)
    end
  end
  return below
end

-- The scanner's state between lines.
local function new_state(rules, lines)
  return {
    rules = rules,
    open = {},          -- containers: {kind = "quote" | "item", width, id, has_content}
    next_id = 0,
    leaf = nil,         -- the open leaf block: "para", "fence", "html", "indented" or "grid"
    fence = nil,        -- {char, len} of an open fenced code block
    html_end = nil,     -- the text that ends an open HTML block of type 1 to 5
    verbatim_to = nil,  -- index of the last line of a YAML block or raw TeX environment
    divs = 0,           -- depth of open Pandoc fenced divs
    term = nil,         -- index of the last line that can be the term of a definition
    last_kind = nil,    -- the kind of the previous line
    closers = rules.markdown and closing_fences(lines) or nil,
  }
end

-- A fence that opens a fenced code block on line i, or nil. In CommonMark the
-- info string of a backtick fence holds no backtick. Pandoc's Markdown needs a
-- closing fence, and a tilde fence there does not interrupt a paragraph.
local function fence_opener(state, i, text, paragraph)
  local run = fence_run(text)
  if not run then
    return nil
  end
  local char = sub(run, 1, 1)
  if char == "`" and (find(text, "`", #run + 1, true) or not state.rules.backtick_fences) then
    return nil
  elseif char == "~" and not state.rules.tilde_fences then
    return nil
  end
  if state.rules.markdown and ((paragraph and char == "~") or state.closers[i][char] < #run) then
    return nil
  end
  return run
end

local function is_div_fence(text, closing)
  if closing then
    return find(text, "^:::+[ \t]*$") ~= nil
  end
  return find(text, "^:::+[ \t]*[^ \t:]") ~= nil
end

-- Whether the line starts a block that ends a paragraph. CommonMark lets most
-- blocks interrupt a paragraph; Pandoc's Markdown wants a blank line before
-- most of them, but not before a backtick fence, an HTML block tag or the
-- closing fence of a div.
local function interrupts_paragraph(state, i, rest, cur)
  if peek_indent(cur) >= 4 then
    return false
  end
  local text = unindented(rest)
  local html_type, html_end = nil, nil
  if state.rules.raw_html then
    html_type, html_end = html_block_start(text)
  end
  if not state.rules.markdown then
    return ltem.starts_block(rest) or (html_type ~= nil and html_type <= 6)
  end
  return fence_opener(state, i, text, true) ~= nil or html_type == 6
    or (html_type == 1 and html_end ~= "</style>")
    or (state.rules.divs and state.divs > 0 and is_div_fence(text, true))
end

-- Continue a verbatim leaf (code, raw HTML) with the rest of a line whose
-- containers all continue. Returns true if the line belongs to it.
local function continue_verbatim(state, rest, cur)
  local leaf = state.leaf
  if leaf == "fence" then
    local run, after = fence_run(unindented(rest))
    if run and sub(run, 1, 1) == state.fence.char and #run >= state.fence.len and is_blank(after) then
      state.leaf = nil
    end
    return true
  elseif leaf == "html" then
    if state.html_end then
      if find(rest:lower(), state.html_end, 1, true) then
        state.leaf = nil
      end
      return true
    end
    if is_blank(rest) then
      state.leaf = nil
      return false
    end
    return true
  elseif leaf == "indented" then
    if is_blank(rest) then
      return false -- a blank line inside the code block; the block goes on
    end
    if peek_indent(cur) >= 4 then
      return true
    end
    state.leaf = nil
  elseif leaf == "grid" then
    if not is_blank(rest) then
      return true
    end
    state.leaf = nil
  end
  return false
end

-- The depth of TeX braces after `line`, starting at `depth`. Outside braces
-- only an argument opens a group: a brace right after a command (`\\name{`,
-- `\\name[...]{`) or after a closed argument (`\\newcommand{\\x}{`). Escaped
-- braces do not count.
local function tex_depth(line, depth)
  local i, argument = 1, false -- whether a brace here opens an argument
  while i <= #line do
    local c = sub(line, i, i)
    if c == "\\" then
      local name = match(line, "^%a+", i + 1)
      i = i + 1 + (name and #name or 1)
      argument = depth > 0 and argument or name ~= nil
    elseif c == "{" then
      if depth > 0 or argument then
        depth = depth + 1
      end
      i = i + 1
    elseif c == "}" then
      if depth > 0 then
        depth = depth - 1
        argument = depth == 0 or argument
      end
      i = i + 1
    else
      local option = depth == 0 and argument and c == "[" and match(line, "^%[[^%]]*%]", i)
      if depth == 0 and not option then
        argument = false
      end
      i = i + (option and #option or 1)
    end
  end
  return depth
end

-- The kind of a line that starts a new leaf block in the innermost container.
local function start_leaf(state, lines, i, rest, cur)
  local rules, paragraph = state.rules, state.leaf == "para"
  local indent = peek_indent(cur)
  local text = unindented(rest)
  if is_blank(rest) then
    if state.leaf ~= "indented" then
      state.leaf = nil
    end
    return "blank"
  end
  if indent >= 4 then
    if paragraph then
      return "para" -- an indented line continues a paragraph
    end
    state.leaf = "indented"
    return "code"
  end
  local run = fence_opener(state, i, text, paragraph)
  if run then
    state.leaf, state.fence = "fence", { char = sub(run, 1, 1), len = #run }
    return "code"
  end
  -- Raw HTML: verbatim up to its end in CommonMark. In Pandoc's Markdown an
  -- HTML block tag is a block of its own and the text inside is Markdown;
  -- <pre>, <script> and <textarea> are verbatim and interrupt a paragraph.
  local html_type, html_end = nil, nil
  if rules.raw_html then
    html_type, html_end = html_block_start(text)
  end
  local verbatim_html
  if rules.markdown then
    verbatim_html = html_type and html_type <= 5 and (not paragraph or (html_type == 1 and html_end ~= "</style>"))
  else
    verbatim_html = html_type and (html_type <= 6 or not paragraph)
  end
  if verbatim_html then
    state.leaf, state.html_end = "html", html_end
    if html_end and find(text:lower(), html_end, 2, true) then
      state.leaf = nil -- the block ends on its first line
    end
    return "code"
  end
  if rules.markdown and html_type == 6 then
    state.leaf = nil
    return "host"
  end
  if rules.divs then
    if state.divs > 0 and is_div_fence(text, true) then
      state.divs, state.leaf = state.divs - 1, nil
      return "host"
    elseif not paragraph and is_div_fence(text, false) then
      state.divs, state.leaf = state.divs + 1, nil
      return "host"
    end
  end
  if not paragraph then
    -- Pandoc's title block: lines that start with `%` at the start of the
    -- document, and the indented lines that continue them.
    if rules.title_block and i == 1 and find(text, "^%%") then
      local last = 1
      while lines[last + 1] and (find(lines[last + 1], "^%%") or find(lines[last + 1], "^[ \t]+%S")) do
        last = last + 1
      end
      state.verbatim_to, state.leaf = last > 1 and last or nil, nil
      return "code"
    end
    if rules.yaml and #state.open == 0 and find(rest, "^%-%-%-[ \t]*$")
        and (i == 1 or (rules.yaml == "anywhere" and is_blank(lines[i - 1])))
        and lines[i + 1] and not is_blank(lines[i + 1]) then
      for k = i + 1, #lines do
        if find(lines[k], "^%-%-%-[ \t]*$") or find(lines[k], "^%.%.%.[ \t]*$") then
          state.verbatim_to, state.leaf = k, nil
          return "code"
        end
      end
    end
    local env = rules.raw_tex and match(text, "^\\begin{([^}]+)}")
    if env then
      for k = i, #lines do
        if find(lines[k], "\\end{" .. env .. "}", 1, true) then
          state.verbatim_to = k > i and k or nil
          break
        end
      end
      state.leaf = nil
      return "code"
    end
    -- A LaTeX command whose braces stay open, such as a macro definition,
    -- is raw TeX up to the line that closes them.
    if rules.raw_tex and find(text, "^\\%a") then
      local depth = tex_depth(text, 0)
      for k = i + 1, depth > 0 and #lines or 0 do
        depth = tex_depth(lines[k], depth)
        if depth == 0 then
          state.verbatim_to, state.leaf = k, nil
          return "code"
        end
      end
    end
    if rules.grid_tables and find(text, "^%+[-=:]+%+[-=:+]*[ \t]*$") then
      state.leaf = "grid" -- a Pandoc grid table, up to the next blank line
      return "code"
    end
  end
  -- A heading or a thematic break is a one-line block, unless Pandoc's
  -- Markdown reads it as a line of the paragraph above. Other text starts or
  -- continues a paragraph.
  if ltem.starts_block(rest) and not (rules.markdown and paragraph) then
    state.leaf = nil
  else
    state.leaf = "para"
  end
  return "para"
end

-- Scan one line. Returns its record (see `scan`).
local function scan_line(state, lines, i)
  local line, open = lines[i], state.open
  local cur = new_cursor(line)
  local matched = 0
  for k, c in ipairs(open) do
    if not continues(c, cur) then
      break
    end
    matched = k
  end
  local all_matched = matched == #open
  local level = rest_of(cur)
  local record = { level = level }

  if state.verbatim_to then
    record.kind = "code"
    if i >= state.verbatim_to then
      state.verbatim_to = nil
    end
  elseif state.leaf and state.leaf ~= "para" then
    if all_matched and continue_verbatim(state, level, cur) then
      record.kind = "code"
    elseif not all_matched then
      state.leaf = nil -- the verbatim block ends with its container
    end
  end

  if not record.kind then
    -- Open new containers. In Pandoc's Markdown a block quote, a footnote
    -- or a list does not interrupt a paragraph, except a list in a list item.
    local in_paragraph = all_matched and state.leaf == "para"
    local markdown = state.rules.markdown
    local opened = false
    while true do
      local in_item = open[#open] and open[#open].kind == "item"
      local blocked = markdown and in_paragraph
      -- A definition follows its term (a line of text without a pipe, so not
      -- a table row or a table caption), directly or after a blank line.
      local after_term = not opened and state.term
        and (state.term == i - 1 or (state.term == i - 2 and state.last_kind == "blank"))
      local lists_allowed = not blocked or in_item
      local c
      if not blocked and take_quote_marker(cur) then
        c = { kind = "quote" }
      else
        c = (state.rules.definitions and after_term and take_definition(cur))
          or (lists_allowed and take_list_item(cur, in_paragraph and not markdown, state.rules))
          or (not blocked and state.rules.footnotes and take_footnote(cur))
      end
      if not c then
        break
      end
      if not opened then
        for k = #open, matched + 1, -1 do
          open[k] = nil
        end
        state.leaf, opened, in_paragraph = nil, true, false
      end
      state.next_id = state.next_id + 1
      c.id = state.next_id
      open[#open + 1] = c
      record.opened_item = record.opened_item or c.kind == "item"
    end

    local rest, offset = rest_of(cur)
    record.offset, record.content = offset, rest
    if not opened and not all_matched and state.leaf == "para" and not is_blank(rest)
        and not interrupts_paragraph(state, i, rest, cur) then
      record.kind = "lazy" -- a lazy continuation line: the containers stay open
    else
      if not opened and not all_matched then
        for k = #open, matched + 1, -1 do
          open[k] = nil
        end
        state.leaf = nil
      end
      local was_paragraph = state.leaf == "para"
      record.kind = start_leaf(state, lines, i, rest, cur)
      if record.kind == "para" and not was_paragraph and not find(rest, "|", 1, true) then
        state.term = i
      end
    end
  end
  if record.kind ~= "blank" and state.term ~= i then
    state.term = nil
  end
  state.last_kind = record.kind

  if record.kind ~= "blank" then
    for _, c in ipairs(open) do
      c.has_content = true
    end
  end
  local chain = {}
  for k, c in ipairs(open) do
    chain[k] = c.id
  end
  record.chain = chain
  record.offset = record.offset or 1
  record.content = record.content or level
  return record
end

-- Scan the lines of a document. Each line gets a record:
--
-- * `kind`: "blank", "para" (paragraph text, including headings and thematic
--   breaks), "lazy" (a lazy continuation line), "code" (code, raw HTML and
--   other verbatim lines) or "host" (a one-line block of the base format,
--   such as a fenced div fence or an HTML block start that Pandoc's Markdown
--   reads inside)
-- * `chain`: ids of the containers the line is in, outermost first
-- * `offset`: byte offset of the line's content after its container markers
--   and indentation
-- * `content`: the content, its indentation written as spaces
-- * `level`: the line as seen in the containers it continues, before new
--   containers open on it
local function scan(lines, rules)
  local state = new_state(rules, lines)
  local records = {}
  for i = 1, #lines do
    records[i] = scan_line(state, lines, i)
    records[i].index = i
  end
  return records
end

---------------------------------------------------------------------------
-- Finding the tables
---------------------------------------------------------------------------

local function innermost(chain)
  return chain[#chain] or 0
end

local function contains(chain, id)
  if id == 0 then
    return true
  end
  for _, c in ipairs(chain) do
    if c == id then
      return true
    end
  end
  return false
end

-- Runs of consecutive paragraph lines in one container. A lazy continuation
-- line cannot be a table line (CommonMark continues only paragraphs lazily),
-- so it ends a run.
local function paragraph_runs(records)
  local runs, current = {}, nil
  for _, r in ipairs(records) do
    if r.kind ~= "para" then
      current = nil
    else
      if not current or innermost(r.chain) ~= current.id then
        current = { id = innermost(r.chain), lines = {} }
        runs[#runs + 1] = current
      end
      current.lines[#current.lines + 1] = r.index
    end
  end
  return runs
end

-- Every LTEM table in the document, with the line indices of its first line,
-- its delimiter row and its last line.
local function find_candidates(records, rules)
  local options = rules.captions and { ends_body = is_caption_line } or nil
  local candidates = {}
  for _, run in ipairs(paragraph_runs(records)) do
    local contents = {}
    for k, i in ipairs(run.lines) do
      contents[k] = records[i].content
    end
    local pending, first = contents, 1
    while #pending > 0 do
      local result = ltem.parse_table(pending, first, options)
      if not result.table then
        break
      end
      candidates[#candidates + 1] = {
        model = result.table,
        first = run.lines[result.first],
        delimiter = run.lines[result.first + result.table.header_rows],
        last = run.lines[result.last],
        container = run.id,
      }
      pending, first = result.after, result.last + 1
    end
  end
  return candidates
end

-- Whether Pandoc could read a line as the delimiter row of a pipe table: the
-- GFM form, without the exceptions for list items and indented lines (an
-- indented line can continue a paragraph that Pandoc reads as a table).
local function looks_like_delimiter_row(text)
  if not find(text, "|", 1, true) then
    return false
  end
  for _, cell in ipairs(ltem.split_row(text)) do
    if not find(cell, "^:?%-+:?$") then
      return false
    end
  end
  return true
end

---------------------------------------------------------------------------
-- Display width, for column sizes
---------------------------------------------------------------------------

-- Code point ranges of East Asian wide and fullwidth characters and of
-- emoji, which count two columns, and of combining marks, which count none,
-- as in Pandoc's layout library.
local WIDE = {
  { 0x1100, 0x115F }, { 0x231A, 0x231B }, { 0x2329, 0x232A }, { 0x23E9, 0x23EC }, { 0x23F0, 0x23F0 },
  { 0x23F3, 0x23F3 }, { 0x25FD, 0x25FE }, { 0x2614, 0x2615 }, { 0x2648, 0x2653 }, { 0x267F, 0x267F },
  { 0x2693, 0x2693 }, { 0x26A1, 0x26A1 }, { 0x26AA, 0x26AB }, { 0x26BD, 0x26BE }, { 0x26C4, 0x26C5 },
  { 0x26CE, 0x26CE }, { 0x26D4, 0x26D4 }, { 0x26EA, 0x26EA }, { 0x26F2, 0x26F3 }, { 0x26F5, 0x26F5 },
  { 0x26FA, 0x26FA }, { 0x26FD, 0x26FD }, { 0x2705, 0x2705 }, { 0x270A, 0x270B }, { 0x2728, 0x2728 },
  { 0x274C, 0x274C }, { 0x274E, 0x274E }, { 0x2753, 0x2755 }, { 0x2757, 0x2757 }, { 0x2795, 0x2797 },
  { 0x27B0, 0x27B0 }, { 0x27BF, 0x27BF }, { 0x2B1B, 0x2B1C }, { 0x2B50, 0x2B50 }, { 0x2B55, 0x2B55 },
  { 0x2E80, 0x303E }, { 0x3041, 0x33FF }, { 0x3400, 0x4DBF }, { 0x4E00, 0x9FFF }, { 0xA000, 0xA4CF },
  { 0xA960, 0xA97F }, { 0xAC00, 0xD7A3 }, { 0xF900, 0xFAFF }, { 0xFE10, 0xFE19 }, { 0xFE30, 0xFE6F },
  { 0xFF00, 0xFF60 }, { 0xFFE0, 0xFFE6 }, { 0x16FE0, 0x16FE4 }, { 0x17000, 0x18AFF }, { 0x1B000, 0x1B2FF },
  { 0x1F004, 0x1F004 }, { 0x1F0CF, 0x1F0CF }, { 0x1F18E, 0x1F18E }, { 0x1F191, 0x1F19A },
  { 0x1F200, 0x1F251 }, { 0x1F300, 0x1F64F }, { 0x1F680, 0x1F6FF }, { 0x1F7E0, 0x1F7EB },
  { 0x1F90C, 0x1F9FF }, { 0x1FA70, 0x1FAFF }, { 0x20000, 0x3FFFD },
}
local ZERO_WIDTH = {
  { 0x0300, 0x036F }, { 0x0483, 0x0489 }, { 0x0591, 0x05BD }, { 0x0610, 0x061A }, { 0x064B, 0x065F },
  { 0x0E31, 0x0E31 }, { 0x0E34, 0x0E3A }, { 0x0E47, 0x0E4E }, { 0x1AB0, 0x1AFF }, { 0x1DC0, 0x1DFF },
  { 0x200B, 0x200F }, { 0x20D0, 0x20FF }, { 0xFE00, 0xFE0F }, { 0xFE20, 0xFE2F }, { 0xE0100, 0xE01EF },
}

local function in_ranges(ranges, cp)
  for _, range in ipairs(ranges) do
    if cp < range[1] then
      return false
    elseif cp <= range[2] then
      return true
    end
  end
  return false
end

local function display_width(s)
  local width = 0
  for _, cp in utf8.codes(s, true) do
    if cp == TAB then
      width = width + 4 - width % 4
    elseif cp >= 0x300 and in_ranges(ZERO_WIDTH, cp) then
      -- no width
    elseif cp >= 0x1100 and in_ranges(WIDE, cp) then
      width = width + 2
    else
      width = width + 1
    end
  end
  return width
end

---------------------------------------------------------------------------
-- Building Pandoc tables
---------------------------------------------------------------------------

local ALIGN = { left = "AlignLeft", right = "AlignRight", center = "AlignCenter" }

-- Column specs, sized as Pandoc's Markdown reader sizes a pipe table: by the
-- lengths of the delimiter cells when a line of the table is wider than the
-- column limit.
local function column_specs(candidate, records, sized, columns)
  local t = candidate.model
  local widths = {}
  if sized then
    local longest = 0
    for i = candidate.first, candidate.last do
      local text = records[i].content:gsub("^[ \t]+", ""):gsub("[ \t]+$", "")
      longest = math.max(longest, display_width(text))
    end
    if longest > columns then
      local lengths, total = {}, 0
      for c, cell in ipairs(ltem.split_row(records[candidate.delimiter].content)) do
        lengths[c], total = #cell, total + #cell
      end
      for c = 1, t.cols do
        widths[c] = lengths[c] / total
      end
    end
  end
  local specs = {}
  for c = 1, t.cols do
    specs[c] = { ALIGN[t.align[c]] or "AlignDefault", widths[c] or "ColWidthDefault" }
  end
  return specs
end

-- The Pandoc table for a placed candidate. `placeholder` is the table Pandoc
-- read in its place, whose caption and attributes the result keeps.
local function build_table(candidate, cell_inlines, placeholder, specs, rules)
  local t = candidate.model
  local rows = {}
  for r = 0, t.rows - 1 do
    rows[r] = {}
  end
  for k, cell in ipairs(t.cells) do
    local inlines = cell_inlines[k]
    local blocks = #inlines > 0 and { pandoc.Plain(inlines) } or {}
    table.insert(rows[cell.row], pandoc.Cell(blocks, "AlignDefault", cell.rowspan, cell.colspan))
  end
  -- Pandoc's Markdown reader reads a single header row of empty cells in a
  -- pipe table as "no header" (which the specification's Section 11 allows);
  -- its CommonMark readers keep the row.
  local headless = rules.markdown and t.header_rows == 1
  for _, cell in ipairs(t.cells) do
    if cell.row == 0 and cell.text ~= "" then
      headless = false
    end
  end
  local head, body = {}, {}
  for r = headless and 1 or 0, t.rows - 1 do
    table.insert(r < t.header_rows and head or body, pandoc.Row(rows[r]))
  end
  local bodies = { { attr = pandoc.Attr(), body = body, head = {}, row_head_columns = 0 } }
  return pandoc.Table(placeholder.caption, specs, pandoc.TableHead(head), bodies, pandoc.TableFoot(),
    placeholder.attr)
end

---------------------------------------------------------------------------
-- Reading
---------------------------------------------------------------------------

-- A prefix for the unique words: one that the document does not contain.
local function word_prefix(text)
  local prefix = "LTEMxq"
  while find(text, prefix, 1, true) do
    prefix = prefix .. "q"
  end
  return prefix
end

local function prefix_of(lines, records, i)
  return sub(lines[i], 1, records[i].offset - 1)
end

-- Plan the placeholder of each candidate: its word, its two lines and the
-- blank lines that keep it apart from the text around it.
local function plan(candidates, lines, records, prefix, rules)
  local cell_count = 0
  for n, c in ipairs(candidates) do
    c.word = prefix .. "T" .. n
    local continuation = prefix_of(lines, records, c.first + 1)
    c.head_line = prefix_of(lines, records, c.first) .. "| " .. c.word .. " |"
    -- Pandoc's Markdown reads `1. | x |` above a delimiter row as a table
    -- row, not as a list item. If the table starts on the line of its list
    -- marker, the marker can go on a line of its own instead.
    c.opens_item = records[c.first].opened_item
    c.split_lines = {
      (prefix_of(lines, records, c.first):gsub("[ \t]+$", "")),
      continuation .. "| " .. c.word .. " |",
    }
    c.delimiter_line = continuation .. "|---|"
    c.blank_line = (continuation:gsub("[ \t]+$", ""))
    -- Pandoc's tables cannot interrupt a paragraph, so text directly above the
    -- table in the same container gets a blank line, as a native pipe table
    -- needs one.
    local above = records[c.first - 1]
    c.blank_before = above ~= nil and above.kind ~= "blank" and contains(above.chain, c.container)
    -- A blank line of spaces still continues a line block in Pandoc's
    -- Markdown, so a blank line above the table is written empty.
    c.empty_above = above ~= nil and above.kind == "blank"
    -- A line below the table with a pipe would become a row of the
    -- placeholder, unless it is the table's caption.
    local below = records[c.last + 1]
    c.blank_after = below ~= nil and below.kind ~= "blank" and contains(below.chain, c.container)
      and find(below.content, "|", 1, true) ~= nil and not (rules.captions and is_caption_line(below.content))
    -- The cell lines, with the LTEM escapes put back for inline parsing: they
    -- keep `^^` from becoming a Pandoc superscript, and render the same in
    -- CommonMark.
    c.cell_lines = {}
    for k, cell in ipairs(c.model.cells) do
      local cell_lines = {}
      for line in (cell.text .. "\n"):gmatch("([^\n]*)\n") do
        local entry = { text = ltem.escape_notation(line) }
        if line ~= "" then
          cell_count = cell_count + 1
          entry.word = prefix .. "C" .. cell_count
        end
        cell_lines[#cell_lines + 1] = entry
      end
      c.cell_lines[k] = cell_lines
    end
  end
end

-- Delimiter rows that LTEM did not use, with an escaped pipe. The lines of a
-- table that ends up read by the base format are left alone, because the
-- base format may read them verbatim.
local function neutralize(lines, records, candidates)
  local in_table = {}
  for _, c in ipairs(candidates) do
    for i = c.first, c.last do
      in_table[i] = true
    end
  end
  local escaped = {}
  for i, r in ipairs(records) do
    local above = records[i - 1]
    if not in_table[i] and (r.kind == "para" or r.kind == "lazy") and above
        and (above.kind == "para" or above.kind == "lazy") and looks_like_delimiter_row(r.level) then
      local pipe = find(lines[i], "|", 1, true)
      escaped[i] = sub(lines[i], 1, pipe - 1) .. "\\" .. sub(lines[i], pipe)
    end
  end
  return escaped
end

-- The document with placeholders. With a boundary word, a paragraph holding
-- it follows, and then a paragraph for each line of cell text.
local function substitute(lines, candidates, escaped, boundary)
  local by_first = {}
  for _, c in ipairs(candidates) do
    if not c.excluded then
      by_first[c.first] = c
    end
  end
  local out = {}
  local function add(s)
    out[#out + 1] = s
  end
  local i = 1
  while i <= #lines do
    local c = by_first[i]
    if c then
      if c.empty_above then
        out[#out] = out[#out]:gsub("[ \t]+$", "")
      elseif c.blank_before then
        add(c.blank_line)
      end
      if c.split then
        add(c.split_lines[1])
        add(c.split_lines[2])
      else
        add(c.head_line)
      end
      add(c.delimiter_line)
      if c.blank_after or c.force_blank_after then
        add(c.blank_line)
      end
      i = c.last + 1
    else
      add(escaped[i] or lines[i])
      i = i + 1
    end
  end
  if boundary then
    add("")
    add(boundary)
    for _, c in ipairs(candidates) do
      if not c.excluded then
        for _, cell_lines in ipairs(c.cell_lines) do
          for _, entry in ipairs(cell_lines) do
            if entry.word then
              add("")
              add(entry.word .. " " .. entry.text)
            end
          end
        end
      end
    end
  end
  return table.concat(out, "\n")
end

-- The word of a placeholder table, and whether Pandoc added rows to it.
local function placeholder_word(t)
  if #t.colspecs ~= 1 or #t.head.rows ~= 1 or #t.head.rows[1].cells ~= 1 or #t.foot.rows ~= 0 then
    return nil
  end
  local blocks = t.head.rows[1].cells[1].contents
  if #blocks ~= 1 or blocks[1].t ~= "Plain" or #blocks[1].content ~= 1 or blocks[1].content[1].t ~= "Str" then
    return nil
  end
  local rows = 0
  for _, body in ipairs(t.bodies) do
    rows = rows + #body.body + #body.head
  end
  return blocks[1].content[1].text, rows > 0
end

-- The inlines of a cell paragraph without its word and the space after it,
-- or nil if the paragraph is not of that form.
local function cell_paragraph_inlines(inlines)
  if #inlines < 3 or inlines[2].t ~= "Space" then
    return nil
  end
  return pandoc.Inlines(table.move(inlines, 3, #inlines, 1, {}))
end

-- Whether the inlines of a cell took text from beyond their line, as an
-- unclosed raw TeX command or HTML comment can in Pandoc's Markdown: then
-- they hold a line break or a word of the reader (all of which start with
-- `prefix`).
local function reaches_beyond(inlines, prefix)
  local beyond = false
  local function check(el)
    if find(el.text, "\n", 1, true) or find(el.text, prefix, 1, true) then
      beyond = true
    end
  end
  local function line_break()
    beyond = true
  end
  inlines:walk { Str = check, Code = check, Math = check, RawInline = check, SoftBreak = line_break,
    LineBreak = line_break }
  return beyond
end

-- The inlines of the cell paragraphs blocks[from], blocks[from + 1], ..., by
-- word.
local function take_cells(blocks, from, cell_words, prefix)
  local cells, found, expected = {}, 0, 0
  for _ in pairs(cell_words) do
    expected = expected + 1
  end
  for k = from, #blocks do
    local block = blocks[k]
    local first = (block.t == "Para" or block.t == "Plain") and block.content[1]
    local word = first and first.t == "Str" and cell_words[first.text] and first.text
    local inlines = word and not cells[word] and cell_paragraph_inlines(block.content)
    if inlines then
      cells[word], found = inlines, found + 1
    end
  end
  -- Text taken from beyond a cell's line breaks the paragraph of the next
  -- cell, so the cells need checking only if one is missing.
  if found < expected or found < #blocks - from + 1 then
    for word, inlines in pairs(cells) do
      if reaches_beyond(inlines, prefix) then
        cells[word] = nil
      end
    end
  end
  return cells
end

-- Read the document once with the placeholders. Returns the document without
-- the cell section, the placeholder tables by word and the cell inlines by
-- word. Returns nil if the end of the document took in the boundary
-- paragraph, as an unclosed fenced code block or HTML block can.
local function read_once(text, format, opts, cell_words, prefix, boundary)
  local doc = pandoc.read(text, format, opts)
  local cells = {}
  if boundary then
    local blocks, at = doc.blocks, nil
    for k = #blocks, 1, -1 do
      local block = blocks[k]
      if block.t == "Para" and #block.content == 1 and block.content[1].t == "Str"
          and block.content[1].text == boundary then
        at = k
        break
      end
    end
    if not at then
      return nil
    end
    cells = take_cells(blocks, at + 1, cell_words, prefix)
    doc.blocks = pandoc.Blocks(table.move(blocks, 1, at - 1, 1, {}))
  end
  local placeholders = {}
  doc = doc:walk {
    Table = function(t)
      local word, extra_rows = placeholder_word(t)
      local found = word and placeholders[word]
      if found then
        found.count = found.count + 1
      elseif word then
        placeholders[word] = { table = t, extra_rows = extra_rows, count = 1 }
      end
    end,
  }
  return doc, placeholders, cells
end

-- Inlines of one line of cell text, read alone. Used when the cell paragraph
-- did not survive in the document.
local function standalone_inlines(entry, format, opts)
  local blocks = pandoc.read(entry.word .. " " .. entry.text, format, opts).blocks
  local block = blocks[1]
  local inlines = #blocks == 1 and (block.t == "Para" or block.t == "Plain") and cell_paragraph_inlines(block.content)
  return inlines or pandoc.Inlines { pandoc.Str(entry.text) }
end

local function cell_inlines(candidate, cells, format, opts)
  local result = {}
  for k, cell_lines in ipairs(candidate.cell_lines) do
    local inlines = pandoc.Inlines {}
    for n, entry in ipairs(cell_lines) do
      if n > 1 then
        inlines:insert(pandoc.LineBreak())
      end
      if entry.word then
        inlines:extend(cells[entry.word] or standalone_inlines(entry, format, opts))
      end
    end
    result[k] = inlines
  end
  return result
end

--- Read Markdown with LTEM tables into a Pandoc document.
--
-- `format` is the base format, as `{format = name, extensions = {...}}` or as
-- a format spec string such as "commonmark_x+emoji". `opts` are Pandoc reader
-- options (may be nil). Returns the document, the number of LTEM tables in
-- it, and the line numbers of LTEM tables that were left to the base format
-- because it reads their lines as something else (for example as raw TeX).
function M.read(text, format, opts)
  if type(format) == "string" then
    format = M.resolve_format(format)
  end
  local rules = host_rules(format)
  -- Only the extensions that differ from the defaults: Pandoc refuses some
  -- default extensions when they are set explicitly (auto_identifiers in gfm).
  local defaults = settable_extensions(format.format)
  local extensions = {}
  for name, on in pairs(format.extensions) do
    if on ~= defaults[name] then
      extensions[name] = on
    end
  end
  -- Positions would point into the rewritten text, and the wrappers hide the
  -- placeholders.
  if extensions.sourcepos then
    warn("ltem: the sourcepos extension is not supported and is turned off")
    extensions.sourcepos = nil
  end
  extensions.pipe_tables = not defaults.pipe_tables or nil -- the placeholders are pipe tables
  local base = { format = format.format, extensions = extensions }
  opts = opts or pandoc.ReaderOptions {}

  local lines = ltem.split_lines(text)
  local records = scan(lines, rules)
  local candidates = find_candidates(records, rules)
  local prefix = word_prefix(text)
  local boundary = prefix .. "B"
  plan(candidates, lines, records, prefix, rules)
  local escaped = neutralize(lines, records, candidates)

  -- Each round places every table, or moves at least one table a step on:
  -- to a blank line after it, to its list marker on a line of its own, or to
  -- giving it up. So this ends.
  while true do
    local cell_words = {}
    for _, c in ipairs(candidates) do
      for _, cell_lines in ipairs(c.cell_lines) do
        for _, entry in ipairs(cell_lines) do
          if entry.word and not c.excluded then
            cell_words[entry.word] = true
          end
        end
      end
    end
    local doc, placeholders, cells = read_once(substitute(lines, candidates, escaped, boundary), base, opts,
      cell_words, prefix, boundary)
    if not doc then
      -- The end of the document took in the cell paragraphs: read it without
      -- them, and each line of cell text on its own.
      doc, placeholders, cells = read_once(substitute(lines, candidates, escaped), base, opts, cell_words, prefix)
    end
    local retry = false
    for _, c in ipairs(candidates) do
      local found = placeholders[c.word]
      if c.excluded then
        -- read as the base format reads it
      elseif not found or found.count ~= 1 then
        if c.opens_item and not c.split then
          c.split = true
        else
          c.excluded = true
        end
        retry = true
      elseif found.extra_rows then
        if c.force_blank_after then
          c.excluded = true
        end
        c.force_blank_after, retry = true, true
      end
    end
    if not retry then
      local tables, placed = {}, 0
      for _, c in ipairs(candidates) do
        if not c.excluded then
          local placeholder = placeholders[c.word].table
          local specs = column_specs(c, records, rules.sized_columns, opts.columns or 72)
          tables[c.word] = build_table(c, cell_inlines(c, cells, base, opts), placeholder, specs, rules)
          placed = placed + 1
        end
      end
      doc = doc:walk {
        Table = function(t)
          local word = placeholder_word(t)
          return word and tables[word] or nil
        end,
      }
      local skipped = {}
      for _, c in ipairs(candidates) do
        if c.excluded then
          skipped[#skipped + 1] = c.first
        end
      end
      return doc, placed, skipped
    end
  end
end

--- An inline renderer for `ltem.render_html`: it parses one line of cell
-- text as inlines of the given format (default "commonmark") and writes them
-- as HTML.
function M.inline_renderer(format)
  format = format or "commonmark"
  return function(text)
    if text == "" then
      return ""
    end
    -- The word in front keeps the text from being read as a block, such as a
    -- list item or a heading.
    local word = word_prefix(text)
    local block = pandoc.read(word .. " " .. text, format).blocks[1]
    local inlines = cell_paragraph_inlines(block.content) or pandoc.Inlines { pandoc.Str(text) }
    return pandoc.write(pandoc.Pandoc { pandoc.Plain(inlines) }, "html", { wrap_text = "wrap-none" })
  end
end

--- Values for a custom reader with the given base format, for example
-- `Extensions, Reader = require("ltem-pandoc").reader("markdown")`.
-- The reader accepts the extensions of the base format.
function M.reader(base)
  local function read(input, opts)
    local doc, _, skipped = M.read(tostring(input), enabled_format(base, opts.extensions), opts)
    for _, line in ipairs(skipped) do
      warn(("ltem: line %d: the base format reads these lines as something other than a table, so they stay as "
        .. "it reads them"):format(line))
    end
    return doc
  end
  return settable_extensions(base), read
end

return M
