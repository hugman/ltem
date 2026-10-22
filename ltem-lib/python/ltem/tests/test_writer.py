"""The canonical writer: round trips and edge cases."""

import random

import pytest

import ltem
from ltem import Cell, Table

from conftest import load_examples

EXAMPLE_TABLES = [Table.from_dict(t) for ex in load_examples() for t in ex["tables"]]


def reparse(table):
    result = ltem.parse_table(ltem.write(table))
    assert result.problems == [], result.problems
    assert result.forms and all(f == "grid" for f in result.forms)
    return result.table


@pytest.mark.parametrize("table", EXAMPLE_TABLES)
def test_example_tables_round_trip(table):
    assert normalized(reparse(table).to_dict()) == table.to_dict()


def random_table(rng, rows, cols, header_rows):
    """A random valid table: spans fill free rectangles and stay within header or body."""
    taken = [[False] * cols for _ in range(rows)]
    cells = []
    for r in range(rows):
        for c in range(cols):
            if taken[r][c]:
                continue
            bottom = header_rows if r < header_rows else rows
            max_cs = 1
            while c + max_cs < cols and not taken[r][c + max_cs] and max_cs < 4:
                max_cs += 1
            cs = rng.randint(1, max_cs) if rng.random() < 0.3 else 1
            rs = rng.randint(1, min(3, bottom - r)) if rng.random() < 0.3 else 1
            while rs > 1 and any(taken[r + rs - 1][c:c + cs]):
                rs -= 1
            for dr in range(rs):
                for dc in range(cs):
                    taken[r + dr][c + dc] = True
            # Model text: what a parser produces, so LTEM escapes are already removed.
            text = rng.choice(["", "x", "Revenue", "**Q1**", "a | b", "line 1\nline 2", "\u3000indent",
                               "<<", "^^", "a << b", "{c:2}", "x {r:3}", "$5 ~ $10", "-", "100"])
            cells.append(Cell(r, c, rs, cs, text))
    align = [rng.choice([None, "left", "center", "right"]) for _ in range(cols)]
    return Table(rows, cols, header_rows, align, cells)


def normalized(d):
    """Model dict with the CommonMark escapes the writer may add (\\-, \\#) removed.

    The writer escapes a header row made only of hyphen cells, and a first row that would
    read as a reserved identifier line. Those escapes are ordinary CommonMark escapes,
    so they stay in the text; they do not change how it renders.
    """
    for c in d["cells"]:
        if c["text"].startswith(("\\-", "\\:", "\\#")):
            c["text"] = c["text"][1:]
    return d


def test_random_tables_round_trip():
    rng = random.Random(20261002)
    for _ in range(2000):
        rows = rng.randint(1, 7)
        header_rows = rng.randint(1, rows)
        table = random_table(rng, rows, rng.randint(1, 6), header_rows)
        assert table.check() == []
        assert normalized(reparse(table).to_dict()) == table.to_dict()


def test_write_is_idempotent():
    source = "| A {c:2} |\n|---|---|\n| 1 | 2 |"
    once = ltem.write(ltem.parse_table(source).table)
    twice = ltem.write(ltem.parse_table(once).table)
    assert once == twice == "| A | << |\n| --- | --- |\n| 1 | 2 |"


def test_writer_escapes_only_where_needed():
    table = Table(2, 2, 1, [None, None], [
        Cell(0, 0, text="-"), Cell(0, 1, text="-"),
        Cell(1, 0, text="<<"), Cell(1, 1, text="x {c:2}"),
    ])
    assert ltem.write(table) == "| \\- | - |\n| --- | --- |\n| \\<< | x \\{c:2} |"


def test_writer_avoids_reserved_identifier_line():
    # The last header row is read as a header row even in this form, so it needs no escape.
    table = Table(2, 1, 1, [None], [Cell(0, 0, text="# orders"), Cell(1, 0, text="1")])
    assert ltem.write(table) == "| # orders |\n| --- |\n| 1 |"
    assert reparse(table).to_dict() == table.to_dict()
    # A header row above the last one would end the header rows (spec Section 9).
    table = Table(4, 1, 3, [None], [Cell(0, 0, text="a"), Cell(1, 0, text="# x"), Cell(2, 0, text="b"),
                                    Cell(3, 0, text="1")])
    assert ltem.write(table) == "| a |\n| \\# x |\n| b |\n| --- |\n| 1 |"
    assert normalized(reparse(table).to_dict()) == table.to_dict()


def test_writer_rejects_invalid_model():
    table = Table(1, 2, 1, [None, None], [Cell(0, 0, colspan=1, text="a")])
    with pytest.raises(ValueError):
        ltem.write(table)
