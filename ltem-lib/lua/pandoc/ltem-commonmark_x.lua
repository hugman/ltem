--- Pandoc custom reader: CommonMark with Pandoc's extensions (`commonmark_x`)
-- and LTEM tables.
--
--     pandoc -f ltem-commonmark_x.lua[+EXTENSION|-EXTENSION...] input.md -o output.html
--
-- It accepts the extensions of Pandoc's `commonmark_x` format, with the same
-- defaults.

local dir = pandoc.path.directory(PANDOC_SCRIPT_FILE)
package.path = ("%s/?.lua;%s/../?.lua;%s"):format(dir, dir, package.path)

Extensions, Reader = require("ltem-pandoc").reader("commonmark_x")
