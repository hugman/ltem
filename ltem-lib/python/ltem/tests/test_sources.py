"""Where cells are in the source: ParseResult.sources and write_with_sources."""

import random

import ltem
from ltem._syntax import cell_lines, split_attribute

from test_writer import normalized, random_table


def text_at(line: str, source) -> str:
    """The model text of the cell whose source is line[start:end]."""
    piece = line[source.start:source.end].replace("\\|", "|")
    return cell_lines(split_attribute(piece)[0])


def test_parse_sources_compact_attribute_escape_and_padding():
    src = "intro\n| R {c:2} |\n| a   | \\| b |\n|---|---|\n| x | y |\n| z |"
    r = ltem.parse_table(src)
    lines = src.split("\n")
    got = [(s.row, s.col, s.rowspan, s.colspan, s.line, lines[s.line][s.start:s.end]) for s in r.sources]
    assert got == [(0, 0, 1, 2, 1, "R {c:2}"), (1, 0, 1, 1, 2, "a"), (1, 1, 1, 1, 2, "\\| b"),
                   (2, 0, 1, 1, 4, "x"), (2, 1, 1, 1, 4, "y"), (3, 0, 1, 1, 5, "z"), (3, 1, 1, 1, 5, "")]
    padded = r.sources[-1]
    assert padded.start == padded.end == len(lines[5])


def test_find_tables_sources_use_document_lines():
    doc = "# Title\n\n| a | << |\n|---|---|\n| 1 | 2 |\n"
    (r,) = ltem.find_tables(doc)
    lines = doc.split("\n")
    assert [(s.line, lines[s.line][s.start:s.end]) for s in r.sources] == [(2, "a"), (4, "1"), (4, "2")]


def test_write_with_sources_on_random_tables():
    rng = random.Random(11)
    for _ in range(2000):
        rows = rng.randint(1, 7)
        table = random_table(rng, rows, rng.randint(1, 6), rng.randint(1, rows))
        text, sources = ltem.write_with_sources(table)
        lines = text.split("\n")
        assert [(s.row, s.col, s.rowspan, s.colspan) for s in sources] == \
               [(c.row, c.col, c.rowspan, c.colspan) for c in table.cells]
        rebuilt = [text_at(lines[s.line], s) for s in sources]
        expected = normalized({"cells": [{"text": t} for t in rebuilt]})["cells"]
        assert [c["text"] for c in expected] == [c.text for c in table.cells]


def test_sources_of_parsed_random_documents_point_at_the_cells():
    rng = random.Random(5)
    for _ in range(1000):
        rows = rng.randint(1, 6)
        table = random_table(rng, rows, rng.randint(1, 5), rng.randint(1, rows))
        doc = "Some text\n\n" + ltem.write(table) + "\n\nafter\n"
        (r,) = ltem.find_tables(doc)
        lines = doc.split("\n")
        for cell, s in zip(r.table.cells, r.sources):
            assert text_at(lines[s.line], s) == cell.text
