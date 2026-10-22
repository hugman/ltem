--- Run the Lua test suites:
--
--     pandoc lua tests/run.lua [SUITE...] [--filter TEXT]
--
-- Suites: core, conformance, reader, filter (default: these four) and quarto
-- (run it explicitly; it needs Quarto). `--filter` runs only the tests whose
-- names contain TEXT. Set PANDOC to the Pandoc executable that the reader and
-- filter tests run (default: "pandoc") and QUARTO to the Quarto executable.

local here = arg[0]:match("^(.*)[/\\]") or "."
package.path = here .. "/?.lua;" .. package.path
local support = require("support")

local suites, filter = {}, nil
local i = 1
while arg[i] do
  if arg[i] == "--filter" then
    filter, i = arg[i + 1], i + 1
  else
    suites[#suites + 1] = arg[i]
  end
  i = i + 1
end
if #suites == 0 then
  suites = { "core", "conformance", "reader", "filter" }
end

-- Any assignment to an undeclared global is a mistake in the code under test.
setmetatable(_G, {
  __newindex = function(_, name)
    error("assignment to undeclared global '" .. tostring(name) .. "'", 2)
  end,
})

local failed = 0
for _, name in ipairs(suites) do
  dofile(("%s/%s_test.lua"):format(here, name))
  failed = failed + support.run(name, filter)
end
os.exit(failed == 0 and 0 or 1)
