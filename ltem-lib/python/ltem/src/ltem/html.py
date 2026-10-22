"""HTML output for LTEM tables (spec Section 6)."""

from __future__ import annotations

import html as _html
from collections.abc import Callable

from .model import Table

InlineRenderer = Callable[[str], str]

_ASCII_PUNCTUATION = set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")


def plain_inline(text: str) -> str:
    """Render inline text with only CommonMark backslash escapes and HTML escaping.

    Used when markdown-it-py is not installed. Emphasis, links and code are left as text.
    """
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text) and text[i + 1] in _ASCII_PUNCTUATION:
            ch = text[i + 1]
            i += 1
        out.append(_html.escape(ch, quote=True).replace("&#x27;", "'"))
        i += 1
    return "".join(out)


def default_inline() -> InlineRenderer:
    """CommonMark inline rendering via markdown-it-py if installed, else plain_inline."""
    try:
        from markdown_it import MarkdownIt
    except ImportError:
        return plain_inline
    md = MarkdownIt("commonmark")
    return md.renderInline


def render_html(table: Table, inline: InlineRenderer | None = None) -> str:
    """Render a table as HTML, in the format of the specification's examples.

    `inline` renders one line of cell text; lines of a cell are joined with <br />.
    """
    inline = inline or default_inline()
    by_row: dict[int, list] = {}
    for cell in table.cells:
        by_row.setdefault(cell.row, []).append(cell)

    def row_html(r: int) -> list[str]:
        tag = "th" if r < table.header_rows else "td"
        out = ["<tr>"]
        for cell in sorted(by_row.get(r, []), key=lambda c: c.col):
            attrs = ""
            if cell.colspan > 1:
                attrs += f' colspan="{cell.colspan}"'
            if cell.rowspan > 1:
                attrs += f' rowspan="{cell.rowspan}"'
            if table.align[cell.col]:
                attrs += f' align="{table.align[cell.col]}"'
            content = "<br />".join(inline(line) for line in cell.text.split("\n"))
            out.append(f"<{tag}{attrs}>{content}</{tag}>")
        out.append("</tr>")
        return out

    parts = ["<table>", "<thead>"]
    for r in range(table.header_rows):
        parts += row_html(r)
    parts.append("</thead>")
    if table.rows > table.header_rows:
        parts.append("<tbody>")
        for r in range(table.header_rows, table.rows):
            parts += row_html(r)
        parts.append("</tbody>")
    parts.append("</table>")
    return "\n".join(parts)
