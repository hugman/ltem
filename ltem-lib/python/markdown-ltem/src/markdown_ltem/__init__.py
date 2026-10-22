"""Python-Markdown extension for LTEM tables.

    import markdown
    html = markdown.markdown(text, extensions=["ltem"])

In MkDocs, add `ltem` under `markdown_extensions`. The extension handles plain GFM
tables too, so the built-in `tables` extension is not needed; if both are enabled,
LTEM tables are tried first.
"""

from __future__ import annotations

import xml.etree.ElementTree as etree
from typing import Any

import ltem
from markdown import Extension
from markdown.blockprocessors import BlockProcessor

__version__ = "0.1.0"
__all__ = ["LtemExtension", "makeExtension"]


class LtemTableProcessor(BlockProcessor):
    """Turns a block that holds an LTEM table into a <table> element."""

    def __init__(self, parser: Any, use_align_attribute: bool) -> None:
        super().__init__(parser)
        self.use_align_attribute = use_align_attribute

    def test(self, parent: etree.Element, block: str) -> bool:
        return ltem.parse_table(block.split("\n")).table is not None

    def run(self, parent: etree.Element, blocks: list[str]) -> None:
        result = ltem.parse_table(blocks.pop(0).split("\n"))
        table = result.table
        assert table is not None
        if result.after:
            blocks.insert(0, "\n".join(result.after))
        if result.before:
            # Lines above the header rows stay a paragraph (spec 2.3 and Section 9).
            self.parser.parseBlocks(parent, ["\n".join(result.before)])

        el = etree.SubElement(parent, "table")
        by_row: dict[int, list[ltem.Cell]] = {}
        for cell in table.cells:
            by_row.setdefault(cell.row, []).append(cell)

        def add_row(section: etree.Element, r: int) -> None:
            tag = "th" if r < table.header_rows else "td"
            tr = etree.SubElement(section, "tr")
            for cell in sorted(by_row.get(r, []), key=lambda c: c.col):
                c = etree.SubElement(tr, tag)
                if cell.colspan > 1:
                    c.set("colspan", str(cell.colspan))
                if cell.rowspan > 1:
                    c.set("rowspan", str(cell.rowspan))
                align = table.align[cell.col]
                if align:
                    if self.use_align_attribute:
                        c.set("align", align)
                    else:
                        c.set("style", f"text-align: {align};")
                lines = cell.text.split("\n")
                c.text = lines[0]
                for line in lines[1:]:  # spec 4.2: lines of a cell
                    br = etree.SubElement(c, "br")
                    br.tail = line

        thead = etree.SubElement(el, "thead")
        for r in range(table.header_rows):
            add_row(thead, r)
        if table.rows > table.header_rows:
            tbody = etree.SubElement(el, "tbody")
            for r in range(table.header_rows, table.rows):
                add_row(tbody, r)


class LtemExtension(Extension):
    """Adds LTEM tables to Python-Markdown."""

    def __init__(self, **kwargs: Any) -> None:
        self.config = {
            "use_align_attribute": [False, "True to use the align attribute instead of style."],
        }
        super().__init__(**kwargs)

    def extendMarkdown(self, md: Any) -> None:
        processor = LtemTableProcessor(md.parser, self.getConfig("use_align_attribute"))
        # Priority 76 puts it just before the built-in tables extension (75).
        md.parser.blockprocessors.register(processor, "ltem_table", 76)


def makeExtension(**kwargs: Any) -> LtemExtension:
    return LtemExtension(**kwargs)
