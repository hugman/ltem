--- The conformance cases (conformance/cases/*.json), read directly: the core's
-- parse, validate, render and write results.

local support = require("support")
local ltem = require("ltem")
local inline = require("ltem-pandoc").inline_renderer("commonmark")
local test, eq = support.test, support.eq

-- An expected table model in the core's form: integers, and false for null.
local function expected_model(value)
  return assert(ltem.read_model(value))
end

-- Errors as a sorted list of "rule row col", so that order does not matter
-- and repetitions do.
local function error_keys(errors)
  local keys = {}
  for i, e in ipairs(errors) do
    local col = type(e.col) == "number" and math.tointeger(e.col) or "null"
    keys[i] = ("%s %d %s"):format(e.rule, math.tointeger(e.row), col)
  end
  table.sort(keys)
  return keys
end

for _, case in ipairs(support.spec_examples()) do
  local label = ("example %d (%s)"):format(math.tointeger(case.example), case.section)
  local results = ltem.find_tables(case.ltem)

  test(label .. ": parse", function()
    local expected = {}
    for i, m in ipairs(case.tables) do
      expected[i] = expected_model(m)
    end
    local actual = {}
    for i, r in ipairs(results) do
      actual[i] = r.table
    end
    eq(actual, expected)
  end)

  test(label .. ": validate", function()
    local problems = {}
    for _, r in ipairs(results) do
      for _, p in ipairs(r.problems) do
        problems[#problems + 1] = p
      end
    end
    eq(error_keys(problems), error_keys(case.errors))
  end)

  test(label .. ": render", function()
    local html = {}
    for i, r in ipairs(results) do
      html[i] = ltem.render_html(r.table, inline)
    end
    eq(support.normalize_tables(table.concat(html, "\n")), support.normalize_tables(case.html))
  end)
end

for _, case in ipairs(support.canonical_cases()) do
  test(("canonical case %d (%s)"):format(math.tointeger(case.case), case.name), function()
    local text, err = ltem.write(expected_model(case.table))
    eq(err, nil)
    eq(text, case.ltem)
  end)
end
