--- Pandoc filter: code blocks with the class `ltem` become LTEM tables.
--
--     pandoc -L ltem-filter.lua input.md -o output.html
--
-- Works with any input format whose code blocks can carry a class, for
-- example a fenced code block with the info string `ltem` in Markdown, or
-- `.. code:: ltem` in reStructuredText.
--
-- The text of the block is read as Markdown with LTEM tables, with Pandoc's
-- `markdown` format unless the metadata field `ltem-format` names another one
-- (such as `commonmark_x`). The blocks that result replace the code block. The
-- block's identifier, other classes and attributes go to the first table,
-- where the table does not set them itself. A block without an LTEM table
-- stays a code block, with a warning.
--
-- In Quarto, a caption such as `: Sales {#tbl-sales}` after the table inside
-- the block makes the table a cross-reference target.

local dir = pandoc.path.directory(PANDOC_SCRIPT_FILE)
package.path = ("%s/?.lua;%s/../?.lua;%s"):format(dir, dir, package.path)

local ltem_pandoc = require("ltem-pandoc")
local warn = ltem_pandoc.warn

-- Give the table the code block's identifier, classes and attributes.
local function merge_attributes(target, block)
  local attr = target.attr
  if attr.identifier == "" then
    attr.identifier = block.identifier
  end
  for _, class in ipairs(block.classes) do
    if class ~= "ltem" and not attr.classes:includes(class) then
      attr.classes:insert(class)
    end
  end
  for key, value in pairs(block.attributes) do
    if attr.attributes[key] == nil then
      attr.attributes[key] = value
    end
  end
  target.attr = attr
end

local function first_table(blocks)
  for _, block in ipairs(blocks) do
    if block.t == "Table" then
      return block
    end
  end
end

function Pandoc(doc)
  local spec = doc.meta["ltem-format"]
  local format = ltem_pandoc.resolve_format(spec and pandoc.utils.stringify(spec) or "markdown")
  if quarto then
    -- As Quarto's own reader does: Quarto takes `{#tbl-...}` from the caption
    -- text itself, and the table would otherwise repeat the float's id.
    format.extensions.table_attributes = false
  end
  return doc:walk {
    CodeBlock = function(block)
      if not block.classes:includes("ltem") then
        return nil
      end
      local result, tables, skipped = ltem_pandoc.read(block.text, format, PANDOC_READER_OPTIONS)
      if #skipped > 0 then
        warn(("ltem: %d LTEM table(s) in a code block are read as something other than a table"):format(#skipped))
      end
      if tables == 0 then
        warn("ltem: a code block with the class ltem holds no LTEM table; it stays a code block")
        return nil
      end
      local target = first_table(result.blocks)
      if target then
        merge_attributes(target, block)
      end
      return result.blocks
    end,
  }
end
