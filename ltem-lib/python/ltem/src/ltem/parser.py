"""Finding and parsing LTEM tables (spec Sections 2 and 3)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ._grid import GridBuilder
from ._syntax import (alignment, cell_lines, ends_table_body, indentation, is_delimiter_row,
                      is_setext_underline, is_upper_header_row, split_row, split_row_spans, starts_block)
from .model import Cell, CellSource, Problem, Table

_LINE_ENDING = re.compile(r"\r\n|\r|\n")  # CommonMark line endings
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")


@dataclass
class ParseResult:
    """The result of parsing one block of lines."""

    table: Table | None
    """The table, or None if the block holds no table."""
    problems: list[Problem] = field(default_factory=list)
    before: list[str] = field(default_factory=list)
    """Lines before the table that stay a paragraph (spec 2.3, Section 9)."""
    after: list[str] = field(default_factory=list)
    """Lines after the table that start another block (spec 2.4)."""
    forms: list[str] = field(default_factory=list)
    """How each row was read: "grid", "compact" or "padded"."""
    start: int = 0
    """Index of the table's first line (its first header row) in the parsed text."""
    end: int = 0
    """Index just past the table's last line in the parsed text."""
    sources: list[CellSource] = field(default_factory=list)
    """Where each cell of the table is in the parsed text, in the order of table.cells."""


def parse_table(block: str | list[str], offset: int = 0) -> ParseResult:
    """Parse one block of consecutive non-blank lines that may contain a table.

    A table may begin on any line of the block, as a GFM table may begin inside a
    paragraph. Delimiter rows are tried in order; the first one whose header rows fit
    makes the table (spec 2.3). Lines above the header rows are returned in `before`;
    lines from the first line that starts another block after the table are returned in
    `after`. `start` and `end` give the table's lines, counted from `offset`.
    """
    lines = block.split("\n") if isinstance(block, str) else list(block)
    lines = [line.rstrip("\r") for line in lines]
    for d in range(1, len(lines)):
        # The last header row is a paragraph line, as in GFM: not indented as code, not the
        # start of another block such as a list item or heading, and not a setext heading
        # underline below another paragraph line (spec 2.3).
        if not is_delimiter_row(lines[d]) or indentation(lines[d - 1]) >= 4 or starts_block(lines[d - 1]):
            continue
        if d >= 2 and is_setext_underline(lines[d - 1]) and not starts_block(lines[d - 2]):
            continue
        result = _try_table(lines, d, offset)
        if result is not None:
            return result
    return ParseResult(None, before=lines)


def _try_table(lines: list[str], d: int, offset: int) -> ParseResult | None:
    """The table whose delimiter row is lines[d], or None if its last header row does not fit."""
    # Header rows: the line above the delimiter, plus pipe-led lines above it (spec 2.3).
    # A last header row that looks like a delimiter row is the only header row.
    top = d - 1
    while top > 0 and not is_delimiter_row(lines[d - 1]) and is_upper_header_row(lines[top - 1]):
        top -= 1
    end = d + 1
    while end < len(lines) and not ends_table_body(lines[end]):
        end += 1

    header = lines[top:d]
    body = lines[d + 1:end]
    align = [alignment(c) for c in split_row(lines[d])]
    spans = [split_row_spans(line) for line in header + body]
    rows = [[text for text, _, _ in row] for row in spans]
    builder = GridBuilder(len(align), len(header), len(rows))
    forms = [builder.add_row(r, texts) for r, texts in enumerate(rows)]
    if forms[len(header) - 1] == "padded":
        return None  # the last header row must fit exactly (spec 2.3)

    origins = sorted(builder.origins, key=lambda o: (o.row, o.col))
    cells = [Cell(o.row, o.col, o.rowspan, o.colspan, cell_lines(o.text)) for o in origins]
    sources = []
    for o in origins:
        line = top + o.row + (1 if o.row >= len(header) else 0)  # body rows follow the delimiter
        if o.source is not None:
            _, start, stop = spans[o.row][o.source]
        else:
            start = stop = len(lines[line])
        sources.append(CellSource(o.row, o.col, o.rowspan, o.colspan, offset + line, start, stop))
    table = Table(len(rows), len(align), len(header), align, cells)
    return ParseResult(table, builder.problems, lines[:top], lines[end:], forms, offset + top, offset + end,
                       sources)


def find_tables(markdown: str) -> list[ParseResult]:
    """Find the LTEM tables in a Markdown document.

    This is a light scan, not a full CommonMark parser: it splits the text at blank
    lines and skips fenced and indented code blocks. Lines end at "\\n", "\\r\\n" or "\\r",
    as in CommonMark. `start` and `end` of each result are line indices in `markdown`. To render whole documents, use LTEM through a
    Markdown parser plugin instead.
    """
    results: list[ParseResult] = []
    block: list[str] = []
    block_start = 0
    fence: str | None = None

    def flush() -> None:
        pending, offset = block[:], block_start
        block.clear()
        while pending:
            result = parse_table(pending, offset)
            if result.table is None:
                return
            results.append(result)
            offset, pending = result.end, result.after

    for i, line in enumerate(_LINE_ENDING.split(markdown)):
        if fence is not None:
            m = _FENCE.match(line)
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) \
                    and not line[m.end():].strip(" \t"):
                fence = None  # a closing fence (CommonMark)
            continue
        m = _FENCE.match(line)
        if m:
            flush()
            fence = m.group(1)
            continue
        if not line.strip(" \t"):  # a blank line has only spaces and tabs (CommonMark)
            flush()
        elif not block and line.startswith("    "):
            continue  # indented code block
        else:
            if not block:
                block_start = i
            block.append(line)
    flush()
    return results
