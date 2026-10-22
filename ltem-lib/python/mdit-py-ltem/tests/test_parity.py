"""The plugin finds the same tables as the core on random documents."""

import importlib.util
import pathlib
import random
import re

import ltem
from markdown_it import MarkdownIt

from mdit_py_ltem import ltem_plugin

REPO = pathlib.Path(__file__).resolve().parents[4]
_spec = importlib.util.spec_from_file_location("run", REPO / "conformance" / "tools" / "run.py")
_run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_run)

MD = MarkdownIt("commonmark").use(ltem_plugin)
INLINE = MarkdownIt("commonmark").renderInline

CELLS = ["a", "b", "**x**", "<<", "^^", "", "1", "Q1", "{c:2}", "y {r:2}", "\\<<", "p \\\\ q", "-", "　z"]
LINES = [
    lambda r: "| " + " | ".join(r.choice(CELLS) for _ in range(r.randint(1, 4))) + " |",
    # A row without pipes at its ends; it must not start like a list item ("- ").
    lambda r: " | ".join([r.choice([c for c in CELLS if c not in ("", "-")])]
                         + [r.choice(CELLS) or "x" for _ in range(r.randint(1, 2))]),
    lambda r: "|" + "|".join(r.choice(["---", ":--", "--:", ":-:", "-"]) for _ in range(r.randint(1, 4))) + "|",
    lambda r: r.choice(["-|-", "--- | ---", "    |---|---|", "  |---|"]),
    lambda r: r.choice(["Some text", "text with $5", "| # id |", "　", "***", "# Heading", "    indented"]),
]

# List items open containers whose lazy continuation lines the core's light scan does not
# model, so they appear only as the last line of a document, right after a table body.
LIST_ITEMS = ["- item", "1. item", "+ item", "- | -"]


def random_document(r):
    blocks = []
    for _ in range(r.randint(1, 4)):
        lines = [r.choice(LINES)(r) for _ in range(r.randint(1, 7))]
        blocks.append("\n".join(lines))
    if r.random() < 0.3:
        blocks[-1] += "\n" + r.choice(LIST_ITEMS)
    return "\n\n".join(blocks) + "\n"


def tables_from_plugin(doc):
    return [_run.normalize(t) for t in re.findall(r"<table>.*?</table>", MD.render(doc), re.S)]


def tables_from_core(doc):
    return [_run.normalize(ltem.render_html(r.table, INLINE)) for r in ltem.find_tables(doc)]


def test_plugin_matches_core_on_random_documents():
    r = random.Random(20261002)
    for _ in range(4000):
        doc = random_document(r)
        assert tables_from_plugin(doc) == tables_from_core(doc), doc
