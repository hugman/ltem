--- Pandoc custom reader: Pandoc's Markdown with LTEM tables.
--
--     pandoc -f ltem-markdown.lua[+EXTENSION|-EXTENSION...] input.md -o output.html
--
-- It accepts the extensions of Pandoc's `markdown` format, with the same
-- defaults.

local dir = pandoc.path.directory(PANDOC_SCRIPT_FILE)
package.path = ("%s/?.lua;%s/../?.lua;%s"):format(dir, dir, package.path)

Extensions, Reader = require("ltem-pandoc").reader("markdown")
