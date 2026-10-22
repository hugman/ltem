--- Copy the filter and the modules it needs into the Quarto extension, which
-- must be self-contained:
--
--     pandoc lua tools/sync-extension.lua
--
-- The test suite checks that the copies match their sources.

local root = (arg[0]:match("^(.*)[/\\]") or ".") .. "/.."

local FILES = {
  ["ltem.lua"] = "ltem.lua",
  ["pandoc/ltem-pandoc.lua"] = "ltem-pandoc.lua",
  ["pandoc/ltem-filter.lua"] = "ltem-filter.lua",
}

for source, target in pairs(FILES) do
  local input = assert(io.open(root .. "/" .. source, "rb"))
  local text = input:read("a")
  input:close()
  local output = assert(io.open(root .. "/_extensions/ltem/" .. target, "wb"))
  output:write(text)
  output:close()
end
