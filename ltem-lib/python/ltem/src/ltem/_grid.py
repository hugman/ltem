"""Span resolution (spec Section 3): grid rows, compact rows, markers and recovery."""

from __future__ import annotations

import copy
from dataclasses import dataclass

from ._syntax import COLSPAN_MARKER, ROWSPAN_MARKER, split_attribute
from .model import Problem


@dataclass
class _Origin:
    row: int
    col: int
    rowspan: int
    colspan: int
    text: str
    fixed_cols: bool  # colspan came from an attribute: markers may not extend it
    fixed_rows: bool  # rowspan came from an attribute
    source: int | None = None  # index of the cell in its source row; None if added by padding


class GridBuilder:
    """Places the cells of a table row by row, as spec Section 3 describes."""

    def __init__(self, cols: int, header_rows: int, rows: int) -> None:
        self.cols, self.header_rows, self.rows = cols, header_rows, rows
        self.owner: list[list[_Origin | None]] = [[None] * cols for _ in range(rows)]
        self.origins: list[_Origin] = []
        self.problems: list[Problem] = []

    # -- helpers ---------------------------------------------------------------

    def _report(self, rule: str, row: int, col: int | None, message: str) -> None:
        self.problems.append(Problem(rule, row, col, message))

    def _free(self, r0: int, r1: int, c0: int, c1: int) -> bool:
        return all(self.owner[r][c] is None
                   for r in range(r0, min(r1, self.rows)) for c in range(c0, min(c1, self.cols)))

    def _cover(self, origin: _Origin, r0: int, r1: int, c0: int, c1: int) -> None:
        for r in range(r0, min(r1, self.rows)):
            for c in range(c0, min(c1, self.cols)):
                self.owner[r][c] = origin

    # -- placing (spec 3.3, 3.4) -------------------------------------------------

    def _extend_left(self, r: int, c: int) -> bool:
        left = self.owner[r][c - 1] if c > 0 else None
        if left is None or left.row != r or left.col + left.colspan != c or left.fixed_cols:
            self._report("V13", r, c, "'<<' has no cell to extend")
            return False
        if not self._free(r + 1, left.row + left.rowspan, c, c + 1):
            self._report("V4", r, c, "'<<' would make two cells overlap")
            return False
        left.colspan += 1
        self._cover(left, left.row, left.row + left.rowspan, c, c + 1)
        return True

    def _extend_up(self, r: int, c: int) -> bool:
        up = self.owner[r - 1][c] if r > 0 else None
        if up is None or up.col != c or up.row + up.rowspan != r or up.fixed_rows:
            self._report("V13", r, c, "'^^' has no cell to extend")
            return False
        if up.row < self.header_rows <= r:
            self._report("V7", r, c, "'^^' would extend a header cell into the body")
            return False
        if not self._free(r, r + 1, c + 1, up.col + up.colspan):
            self._report("V4", r, c, "'^^' would make two cells overlap")
            return False
        up.rowspan += 1
        self._cover(up, r, r + 1, up.col, up.col + up.colspan)
        return True

    def _place(self, r: int, c: int, text: str, source: int | None = None) -> None:
        """Place a cell at the position (r, c), which is not covered."""
        if text == COLSPAN_MARKER and self._extend_left(r, c):
            return
        if text == ROWSPAN_MARKER and self._extend_up(r, c):
            return
        colspan = rowspan = 1
        fixed_cols = fixed_rows = False
        if text not in (COLSPAN_MARKER, ROWSPAN_MARKER):  # an unusable marker stays literal text
            text, attr = split_attribute(text)
            if attr:
                for message in attr.problems:
                    self._report("V1", r, c, message)
                colspan, fixed_cols = attr.colspan or 1, attr.colspan is not None
                rowspan, fixed_rows = attr.rowspan or 1, attr.rowspan is not None
        if c + colspan > self.cols:
            self._report("V2", r, c, f"colspan {colspan} reaches past the last column")
            colspan = self.cols - c
        if r + rowspan > self.rows:
            self._report("V3", r, c, f"rowspan {rowspan} reaches past the last row")
            rowspan = self.rows - r
        if r < self.header_rows < r + rowspan:
            self._report("V7", r, c, "a header cell spans into the body")
            rowspan = self.header_rows - r
        # V4: cut to the largest rectangle that overlaps nothing, columns first, then rows.
        k = 1
        while k < colspan and self.owner[r][c + k] is None:
            k += 1
        j = 1
        while j < rowspan and self._free(r + j, r + j + 1, c, c + k):
            j += 1
        if (k, j) != (colspan, rowspan):
            self._report("V4", r, c, f"span cut from {colspan}x{rowspan} to {k}x{j} to avoid an overlap")
            colspan, rowspan = k, j
        origin = _Origin(r, c, rowspan, colspan, text, fixed_cols, fixed_rows, source)
        self.origins.append(origin)
        self._cover(origin, r, r + rowspan, c, c + colspan)

    # -- rows (spec 3.2) ---------------------------------------------------------

    def _compact_fits(self, r: int, texts: list[str]) -> bool:
        trial = copy.deepcopy(self)
        used = 0
        for c in range(self.cols):
            if trial.owner[r][c] is None:
                if used == len(texts):
                    return False
                trial._place(r, c, texts[used])
                used += 1
        return all(t == "" for t in texts[used:])

    def add_row(self, r: int, texts: list[str]) -> str:
        """Place row r. Returns "grid", "compact" or "padded" (the row did not fit: V14)."""
        n = len(texts)
        if n != self.cols and self._compact_fits(r, texts):
            remaining = iter(enumerate(texts))
            for c in range(self.cols):
                if self.owner[r][c] is None:
                    index, text = next(remaining)
                    self._place(r, c, text, index)
            return "compact"
        form = "grid"
        if n != self.cols:
            self._report("V14", r, None, f"row has {n} cells; it fits neither as a grid row "
                                         f"({self.cols} cells) nor as a compact row")
            texts = (texts + [""] * self.cols)[: self.cols]
            form = "padded"
        for c, text in enumerate(texts):
            covering = self.owner[r][c]
            if covering is not None:
                if text not in ("", COLSPAN_MARKER, ROWSPAN_MARKER):
                    rule = "V5" if covering.row < r else "V6"
                    self._report(rule, r, c, f"a covered position holds text {text!r}; it is dropped")
                continue
            self._place(r, c, text, c if c < n else None)
        return form
