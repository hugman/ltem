"""The LTEM table model (see ast/table-model.md in the LTEM repository)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

MODEL_VERSION = "1.0"


@dataclass
class Cell:
    """A cell of a table. Its origin is its top-left grid position."""

    row: int
    col: int
    rowspan: int = 1
    colspan: int = 1
    text: str = ""
    """Inline Markdown source. Lines are separated by "\\n"."""

    def to_dict(self) -> dict[str, Any]:
        return {"row": self.row, "col": self.col, "rowspan": self.rowspan,
                "colspan": self.colspan, "text": self.text}


@dataclass
class Table:
    """A resolved LTEM table."""

    rows: int
    cols: int
    header_rows: int
    align: list[str | None]
    cells: list[Cell] = field(default_factory=list)

    def is_header(self, cell: Cell) -> bool:
        return cell.row < self.header_rows

    def owner_grid(self) -> list[list[Cell | None]]:
        """Return a rows x cols grid holding the cell that owns each position."""
        grid: list[list[Cell | None]] = [[None] * self.cols for _ in range(self.rows)]
        for cell in self.cells:
            for r in range(cell.row, min(cell.row + cell.rowspan, self.rows)):
                for c in range(cell.col, min(cell.col + cell.colspan, self.cols)):
                    grid[r][c] = cell
        return grid

    def check(self) -> list[str]:
        """Return the violations of the model rules in ast/table-model.md (empty if valid)."""
        problems = []
        if len(self.align) != self.cols:
            problems.append(f"align has {len(self.align)} entries, expected {self.cols}")
        if not 1 <= self.header_rows <= self.rows:
            problems.append(f"header_rows {self.header_rows} is outside 1..{self.rows}")
        keys = [(c.row, c.col) for c in self.cells]
        if keys != sorted(keys):
            problems.append("cells are not sorted by row and column")
        seen: list[list[bool]] = [[False] * self.cols for _ in range(self.rows)]
        for c in self.cells:
            if c.rowspan < 1 or c.colspan < 1 or c.row < 0 or c.col < 0 \
                    or c.row + c.rowspan > self.rows or c.col + c.colspan > self.cols:
                problems.append(f"cell ({c.row},{c.col}) lies outside the grid")
                continue
            if c.row < self.header_rows < c.row + c.rowspan:
                problems.append(f"header cell ({c.row},{c.col}) reaches into the body")
            for r in range(c.row, c.row + c.rowspan):
                for k in range(c.col, c.col + c.colspan):
                    if seen[r][k]:
                        problems.append(f"position ({r},{k}) belongs to two cells")
                    seen[r][k] = True
        holes = [(r, k) for r in range(self.rows) for k in range(self.cols) if not seen[r][k]]
        if holes:
            problems.append(f"positions without a cell: {holes[:5]}")
        for c in self.cells:
            if "\\\\" in c.text:
                problems.append(f"cell ({c.row},{c.col}) text has two backslashes in a row, "
                                "which LTEM 1.0 reads as a line break")
        return problems

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": MODEL_VERSION,
            "rows": self.rows,
            "cols": self.cols,
            "header_rows": self.header_rows,
            "align": list(self.align),
            "cells": [c.to_dict() for c in sorted(self.cells, key=lambda c: (c.row, c.col))],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Table:
        if d.get("version") != MODEL_VERSION:
            raise ValueError(f"unsupported table model version: {d.get('version')!r}")
        return cls(
            rows=d["rows"], cols=d["cols"], header_rows=d["header_rows"], align=list(d["align"]),
            cells=[Cell(c["row"], c["col"], c["rowspan"], c["colspan"], c["text"]) for c in d["cells"]],
        )


@dataclass(frozen=True)
class Problem:
    """A validation problem (specification Section 5)."""

    rule: str
    row: int
    col: int | None
    message: str

    @property
    def severity(self) -> str:
        """"warning" for V14, which leaves the table valid; "error" for every other rule."""
        return "warning" if self.rule == "V14" else "error"

    def to_dict(self) -> dict[str, Any]:
        return {"rule": self.rule, "row": self.row, "col": self.col}

    def __str__(self) -> str:
        where = f"row {self.row}" if self.col is None else f"({self.row},{self.col})"
        return f"{self.rule} at {where}: {self.message}"


@dataclass(frozen=True)
class CellSource:
    """Where a cell is in the LTEM source.

    `line` counts lines of the parsed text from 0. `start` and `end` index that line in
    Python string units (code points) and cover the cell's source without the spaces and
    tabs around it, including any span attribute. A cell added by padding (rule V14) has
    no source; it gets start == end == the length of its row's line.
    """

    row: int
    col: int
    rowspan: int
    colspan: int
    line: int
    start: int
    end: int

    def to_dict(self) -> dict[str, Any]:
        return {"row": self.row, "col": self.col, "rowspan": self.rowspan, "colspan": self.colspan,
                "line": self.line, "start": self.start, "end": self.end}
