--- Tests of the Quarto extension with the Quarto command line. Run them with
--
--     QUARTO=/path/to/quarto pandoc lua tests/run.lua quarto
--
-- Each test renders a small document in a temporary project that holds a copy
-- of _extensions/ltem.

local support = require("support")
local test, eq, ok = support.test, support.eq, support.ok

local QUARTO = os.getenv("QUARTO") or "quarto"
local EXTENSION = support.lua_dir .. "/_extensions/ltem/"

local DOCUMENT = [[
---
title: LTEM in Quarto
filters:
  - ltem
---

See @tbl-sales.

```ltem
| Region | Revenue  | <<  |
| ^^     | Q1       | Q2  |
|--------|---------:|----:|
| Asia   | **100**  | 120 |
| Europe | 90 \\ est. | 110 |

: Sales by region {#tbl-sales}
```

```{.ltem}
| A {c:2} |
|---|---|
| 1 | 2 |
```
]]

-- Render the document to a format in a temporary project and return the
-- output file's text.
local function render(document, to, output)
  return pandoc.system.with_temporary_directory("ltem-quarto", function(dir)
    pandoc.system.make_directory(pandoc.path.join { dir, "_extensions", "ltem" }, true)
    for _, name in ipairs { "_extension.yml", "ltem-filter.lua", "ltem-pandoc.lua", "ltem.lua" } do
      support.write_file(pandoc.path.join { dir, "_extensions", "ltem", name }, support.read_file(EXTENSION .. name))
    end
    support.write_file(pandoc.path.join { dir, "doc.qmd" }, document)
    pandoc.system.with_working_directory(dir, function()
      pandoc.pipe(QUARTO, { "render", "doc.qmd", "--to", to, "--quiet" }, "")
    end)
    return support.read_file(pandoc.path.join { dir, output })
  end)
end

local function count(text, pattern)
  local n = 0
  for _ in text:gmatch(pattern) do
    n = n + 1
  end
  return n
end

test("quarto render to HTML: spans, alignment, line breaks and a cross-reference", function()
  local html = render(DOCUMENT, "html", "doc.html")
  ok(html:find('<th rowspan="2">Region</th>', 1, true), "rowspan")
  ok(html:find('<th colspan="2" style="text-align: right;">Revenue</th>', 1, true), "colspan and alignment")
  ok(html:find("<strong>100</strong>", 1, true), "inline markup")
  ok(html:find("90<br />", 1, true) or html:find("90<br>", 1, true), "line break")
  ok(html:find('<th colspan="2">A</th>', 1, true), "second table")
  ok(html:find('class="quarto-xref">Table&nbsp;1</a>', 1, true), "cross-reference")
  ok(html:find("Table&nbsp;1: Sales by region", 1, true), "caption")
  eq(count(html, 'id="tbl%-sales"'), 1, "the table does not repeat the float's id")
end)

test("quarto render to LaTeX: multirow, multicolumn, label and reference", function()
  local latex = render(DOCUMENT, "latex", "doc.tex")
  ok(latex:find("\\multirow{2}{*}{Region}", 1, true), "multirow")
  ok(latex:find("\\multicolumn{2}", 1, true), "multicolumn")
  ok(latex:find("\\label{tbl-sales}", 1, true), "label")
  ok(latex:find("\\ref{tbl-sales}", 1, true), "reference")
end)

test("informative: Quarto cannot use a custom reader in `from` (Quarto 1.10)", function()
  -- Quarto always reads with its own reader and hands `from` to pandoc.read,
  -- which knows only Pandoc's built-in formats.
  local output = pandoc.system.with_temporary_directory("ltem-quarto", function(dir)
    for source, name in pairs {
      ["pandoc/ltem-markdown.lua"] = "ltem-markdown.lua", ["pandoc/ltem-pandoc.lua"] = "ltem-pandoc.lua",
      ["ltem.lua"] = "ltem.lua",
    } do
      support.write_file(pandoc.path.join { dir, name }, support.read_file(support.lua_dir .. "/" .. source))
    end
    support.write_file(pandoc.path.join { dir, "doc.qmd" },
      "---\ntitle: t\nfrom: ltem-markdown.lua\n---\n\n| a | << |\n|---|---|\n")
    local process = io.popen(("cd '%s' && '%s' render doc.qmd --to html 2>&1"):format(dir, QUARTO))
    local text = process:read("a")
    process:close()
    return text
  end)
  ok(output:find("Unknown input format", 1, true), output)
end)
