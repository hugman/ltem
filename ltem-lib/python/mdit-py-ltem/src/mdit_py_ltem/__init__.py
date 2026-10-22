"""markdown-it-py plugin for LTEM tables.

    from markdown_it import MarkdownIt
    from mdit_py_ltem import ltem_plugin

    md = MarkdownIt("commonmark").use(ltem_plugin)
    html = md.render(text)

The plugin replaces markdown-it's GFM table rule. A table without LTEM notation renders
as before; LTEM tables get colspan, rowspan and several header rows.
"""

from __future__ import annotations

import ltem
from ltem import is_delimiter_row, is_upper_header_row
from markdown_it import MarkdownIt
from markdown_it.rules_block import StateBlock
from markdown_it.rules_core import StateCore
from markdown_it.token import Token

__version__ = "0.1.0"
__all__ = ["ltem_plugin"]

_ALT = ["paragraph", "reference"]


def ltem_plugin(md: MarkdownIt) -> None:
    """Replace the table rule of `md` with the LTEM table rule and enable it."""
    if "table" in md.block.ruler.get_all_rules():
        md.block.ruler.at("table", _table_rule, {"alt": _ALT})
    else:
        md.block.ruler.before("code", "table", _table_rule, {"alt": _ALT})
    md.enable("table")
    md.core.ruler.before("inline", "ltem_split_lines", _split_cell_lines)
    md.core.ruler.after("inline", "ltem_join_lines", _join_cell_lines)


# -- block rule --------------------------------------------------------------------

def _line(state: StateBlock, n: int) -> str:
    """Line n inside the current container, keeping its indentation relative to the container."""
    indent = max(0, state.sCount[n] - state.blkIndent)
    return " " * indent + state.src[state.bMarks[n] + state.tShift[n]:state.eMarks[n]]


def _usable(state: StateBlock, n: int, end: int) -> bool:
    """Whether line n can belong to a table: not blank and inside the current container."""
    return n < end and not state.isEmpty(n) and state.sCount[n] >= state.blkIndent


def _code_indented(state: StateBlock, n: int) -> bool:
    return state.sCount[n] - state.blkIndent >= 4


def _find_delimiter(state: StateBlock, start: int, end: int) -> int | None:
    """Index of the delimiter row if a table's header rows start at `start` (spec 2.3)."""
    n = start
    while _usable(state, n, end) and _usable(state, n + 1, end):
        if is_delimiter_row(_line(state, n + 1)):
            # Line n is the last header row: a paragraph line, as in GFM (spec 2.3).
            if _code_indented(state, n + 1) or ltem.starts_block(_line(state, n)):
                return None
            return n + 1
        if not is_upper_header_row(_line(state, n)):
            return None
        n += 1
    return None


def _ends_body(state: StateBlock, n: int, end: int, terminators: list) -> bool:
    """Whether the table body ends before line n (spec 2.4), by the core's rules or markdown-it's."""
    if not _usable(state, n, end) or _code_indented(state, n):
        return True
    if ltem.ends_table_body(_line(state, n)):
        return True
    return any(rule(state, n, end, True) for rule in terminators)


def _table_rule(state: StateBlock, start: int, end: int, silent: bool) -> bool:
    if _code_indented(state, start):
        return False
    # Called to end a paragraph at `start`: if the line above is a pipe-led line of the same
    # paragraph, it would be a header row of any table here, so no table starts at `start`.
    # Not so if `start` looks like a delimiter row: as a last header row it stands alone.
    if silent and start > 0 and is_upper_header_row(_line(state, start - 1)) \
            and not is_delimiter_row(_line(state, start)):
        return False
    delimiter = _find_delimiter(state, start, end)
    if delimiter is None:
        return False

    stop = delimiter + 1
    if not silent:
        terminators = state.md.block.ruler.getRules("blockquote")
        old_parent = state.parentType
        state.parentType = "table"
        while not _ends_body(state, stop, end, terminators):
            stop += 1
        state.parentType = old_parent

    result = ltem.parse_table([_line(state, n) for n in range(start, stop)])
    if result.table is None or result.start != 0 or result.end != stop - start:
        return False  # no table here, e.g. the last header row does not fit (spec 2.3)
    if silent:
        return True
    _emit(state, result.table, result.sources, start, delimiter, stop)
    state.line = stop
    return True


def _raw_column(state: StateBlock, n: int, offset: int) -> int:
    """Column in the raw document line n of an offset into _line(state, n)."""
    indent = max(0, state.sCount[n] - state.blkIndent)
    content = state.bMarks[n] + state.tShift[n]
    line_start = state.src.rfind("\n", 0, state.bMarks[n]) + 1
    return content + max(0, offset - indent) - line_start


def _emit(state: StateBlock, table: ltem.Table, sources: list[ltem.CellSource], start: int, delimiter: int,
          stop: int) -> None:
    old_parent = state.parentType
    state.parentType = "table"
    token = state.push("table_open", "table", 1)
    token.map = [start, stop]
    by_row: dict[int, list[tuple[ltem.Cell, ltem.CellSource]]] = {}
    for cell, source in zip(table.cells, sources):
        by_row.setdefault(cell.row, []).append((cell, source))

    def emit_row(r: int) -> None:
        tag = "th" if r < table.header_rows else "td"
        line = start + r if r < table.header_rows else start + r + 1  # skip the delimiter row
        tok = state.push("tr_open", "tr", 1)
        tok.map = [line, line + 1]
        for cell, source in sorted(by_row.get(r, []), key=lambda p: p[0].col):
            tok = state.push(f"{tag}_open", tag, 1)
            tok.map = [line, line + 1]
            # Where the cell is: document line, and columns in that raw line (code points).
            doc_line = start + source.line
            tok.meta = {"ltem": {"row": cell.row, "col": cell.col, "rowspan": cell.rowspan,
                                 "colspan": cell.colspan, "line": doc_line,
                                 "start": _raw_column(state, doc_line, source.start),
                                 "end": _raw_column(state, doc_line, source.end)}}
            attrs: dict[str, str | int | float] = {}
            if cell.colspan > 1:
                attrs["colspan"] = str(cell.colspan)
            if cell.rowspan > 1:
                attrs["rowspan"] = str(cell.rowspan)
            if table.align[cell.col]:
                attrs["style"] = "text-align:" + table.align[cell.col]
            tok.attrs = attrs
            lines = cell.text.split("\n")
            tok = state.push("inline", "", 0)
            tok.map = [line, line + 1]
            tok.content = "\\\n".join(lines)
            tok.children = []
            if len(lines) > 1:
                tok.meta = {**(tok.meta or {}), _LINES: lines}
            state.push(f"{tag}_close", tag, -1)
        state.push("tr_close", "tr", -1)

    token = state.push("thead_open", "thead", 1)
    token.map = [start, start + table.header_rows]
    for r in range(table.header_rows):
        emit_row(r)
    state.push("thead_close", "thead", -1)
    if table.rows > table.header_rows:
        token = state.push("tbody_open", "tbody", 1)
        token.map = [delimiter + 1, stop]
        for r in range(table.header_rows, table.rows):
            emit_row(r)
        state.push("tbody_close", "tbody", -1)
    state.push("table_close", "table", -1)
    state.parentType = old_parent


# -- lines of a cell (spec 4.2) ------------------------------------------------------
# A cell keeps one inline token, but each of its lines is parsed on its own: before the
# inline rule the token is split into one token per line, and afterwards the lines'
# children are joined back into the cell's token with hard breaks between them.

_LINES = "ltem_lines"
_OWNER = "ltem_owner"


def _split_cell_lines(state: StateCore) -> None:
    if not any(_LINES in (t.meta or {}) for t in state.tokens):
        return
    out: list[Token] = []
    for token in state.tokens:
        lines = (token.meta or {}).get(_LINES)
        if not lines:
            out.append(token)
            continue
        for line in lines:
            part = Token("inline", "", 0, content=line, map=token.map, level=token.level, children=[])
            part.meta = {_OWNER: token}
            out.append(part)
    state.tokens = out


def _join_cell_lines(state: StateCore) -> None:
    if not any(_OWNER in (t.meta or {}) for t in state.tokens):
        return
    out: list[Token] = []
    for token in state.tokens:
        owner = (token.meta or {}).get(_OWNER)
        if owner is None:
            out.append(token)
            continue
        if out and out[-1] is owner:
            owner.children.append(Token("hardbreak", "br", 0))
        else:
            owner.children = []
            out.append(owner)
        owner.children.extend(token.children or [])
    state.tokens = out
