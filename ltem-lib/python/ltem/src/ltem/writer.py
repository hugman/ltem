"""Writing tables in the canonical form (spec Section 8)."""

from __future__ import annotations

from ._syntax import (COLSPAN_MARKER, DELIMITER_CELL, IDENTIFIER_ROW, ROWSPAN_MARKER,
                      SPAN_ATTRIBUTE)
from .model import CellSource, Table

_DELIMITER = {None: "---", "left": ":---", "right": "---:", "center": ":---:"}


def _escape(text: str) -> str:
    """Turn model text into cell source, adding only the escapes spec 4.3 requires."""
    lines = []
    for line in text.split("\n"):
        line = line.replace("|", "\\|")
        if line in (COLSPAN_MARKER, ROWSPAN_MARKER):
            line = "\\" + line
        m = SPAN_ATTRIBUTE.search(line)
        if m:
            line = line[: m.start()] + "\\" + line[m.start():]
        lines.append(line)
    return " \\\\ ".join(lines)


def write(table: Table) -> str:
    """Write a table in the canonical form.

    Every row is a grid row. A covered position in the column of its cell's origin is
    written '^^' and every other covered position '<<'. No span attributes are used.
    """
    problems = table.check()
    if problems:
        raise ValueError("invalid table model: " + "; ".join(problems))
    grid = table.owner_grid()
    rows: list[list[str]] = []
    for r in range(table.rows):
        row = []
        for c in range(table.cols):
            cell = grid[r][c]
            assert cell is not None
            if (cell.row, cell.col) == (r, c):
                row.append(_escape(cell.text))
            elif c == cell.col:
                row.append(ROWSPAN_MARKER)
            else:
                row.append(COLSPAN_MARKER)
        rows.append(row)

    # A header row made only of hyphen cells would read as the delimiter row (spec 4.3).
    for r in range(table.header_rows):
        if all(DELIMITER_CELL.fullmatch(t) for t in rows[r]):
            rows[r][0] = "\\" + rows[r][0]
    # A header row above the last one must not look like a reserved identifier line,
    # which would end the header rows (spec 4.3, Section 9).
    for r in range(table.header_rows - 1):
        if IDENTIFIER_ROW.match("| " + " | ".join(rows[r]) + " |"):
            rows[r][0] = "\\" + rows[r][0]
    lines = ["| " + " | ".join(row) + " |" for row in rows]
    delimiter = "| " + " | ".join(_DELIMITER[a] for a in table.align) + " |"
    return "\n".join(lines[: table.header_rows] + [delimiter] + lines[table.header_rows:])


def write_with_sources(table: Table) -> tuple[str, list[CellSource]]:
    """Write a table in the canonical form, with where each cell is in the output.

    Lines count from the table's first line (0). See CellSource for the units.
    """
    from .parser import parse_table

    text = write(table)
    return text, parse_table(text).sources
