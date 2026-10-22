"""The markdown-it-py plugin against the full-document conformance cases."""

import importlib.util
import json
import pathlib

import pytest
from markdown_it import MarkdownIt

from mdit_py_ltem import ltem_plugin

REPO = pathlib.Path(__file__).resolve().parents[4]
EXAMPLES = json.loads((REPO / "conformance" / "cases" / "spec-examples.json").read_text("utf-8"))["examples"]
_spec = importlib.util.spec_from_file_location("run", REPO / "conformance" / "tools" / "run.py")
_run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_run)
normalize = _run.normalize


@pytest.mark.parametrize("preset", ["commonmark", "gfm-like"])
@pytest.mark.parametrize("ex", EXAMPLES, ids=[f"example-{e['example']}" for e in EXAMPLES])
def test_full_document(ex, preset):
    md = MarkdownIt(preset, {"linkify": False}).use(ltem_plugin)
    assert normalize(md.render(ex["ltem"])) == normalize(ex["html"])


GFM_TABLES = [
    "| a | b |\n|---|:-:|\n| 1 | 2 |\n",
    "a | b\n--- | ---\nx | y\n",
    "| abc | def |\n| --- | --- |\n| bar |\n| bar | baz | boo |\n",
    "| abc | def |\n| --- | --- |\n",
    "| f\\|oo  |\n| ------ |\n| b `\\|` az |\n",
    "| abc | def |\n| --- | --- |\n| bar | baz |\n> quote\n",
    "text before\n| a |\n| - |\n| 1 |\n",
]


@pytest.mark.parametrize("source", GFM_TABLES)
def test_plain_gfm_tables_render_as_before(source):
    gfm = MarkdownIt("gfm-like", {"linkify": False})
    ours = MarkdownIt("gfm-like", {"linkify": False}).use(ltem_plugin)
    assert normalize(ours.render(source)) == normalize(gfm.render(source))


def test_token_maps_cover_the_table():
    md = MarkdownIt("commonmark").use(ltem_plugin)
    tokens = md.parse("intro\n\n| R | << |\n| ^^ | Q |\n|---|---|\n| 1 | 2 |\n\nafter\n")
    table = next(t for t in tokens if t.type == "table_open")
    assert table.map == [2, 6]
    trs = [t.map for t in tokens if t.type == "tr_open"]
    assert trs == [[2, 3], [3, 4], [5, 6]]


def test_tables_inside_containers():
    md = MarkdownIt("commonmark").use(ltem_plugin)
    html = md.render("> | A | << |\n> |---|---|\n> | 1 | 2 |\n\n- | x |\n  |---|\n  | y |\n")
    assert '<blockquote>\n<table>' in html and 'colspan="2"' in html
    assert "<li>\n<table>" in html


def test_one_inline_token_per_cell_and_lines_parsed_separately():
    md = MarkdownIt("commonmark").use(ltem_plugin)
    tokens = md.parse("| H |\n|---|\n| **a \\\\ b** |\n| C:\\ \\\\ d |\n")
    inlines = [t for t in tokens if t.type == "inline"]
    assert len(inlines) == 3  # header cell + two body cells
    html = md.render("| H |\n|---|\n| **a \\\\ b** |\n")
    assert "<strong>" not in html  # emphasis does not run across the line break
    html = md.render("| H |\n|---|\n| C:\\ \\\\ d |\n")
    assert "C:\\<br />" in html.replace("\n", "")  # a line ending in a backslash keeps its break


def test_body_ends_at_list_item_and_thematic_break():
    md = MarkdownIt("commonmark").use(ltem_plugin)
    html = md.render("| a |\n|---|\n| 1 |\n- item\n")
    assert html.count("<tr>") == 2 and "<ul>\n<li>item</li>" in html
    html = md.render("| a |\n|---|\n| 1 |\n***\n")
    assert html.count("<tr>") == 2 and "<hr />" in html


@pytest.mark.parametrize("source", [
    "a | b\n|---|\n| c |\n|:-:|\n",
    "| a |\n    |---|\n| 1 |\n",
    "| # id |\n| a | << |\n|---|---|\n| 1 | 2 |\n",
    "text\n| a | b {c:2} |\n| c |\n|---|---|---|\n| 1 | 2 | 3 |\n",
])
def test_plugin_finds_the_same_tables_as_the_core(source):
    import ltem
    md = MarkdownIt("commonmark").use(ltem_plugin)
    tokens = md.parse(source)
    found = sum(1 for t in tokens if t.type == "table_open")
    assert found == len(ltem.find_tables(source))


def test_cell_tokens_carry_lines_and_columns():
    md = MarkdownIt("commonmark").use(ltem_plugin)
    src = "intro\n\n| R {c:2} | << |\n| a | \\| b |\n|---|---|\n| x | y |\n\n> | q | w |\n> |---|---|\n> | 1 | 2 |\n"
    lines = src.split("\n")
    cells = [t for t in md.parse(src) if t.type in ("th_open", "td_open")]
    got = [(t.meta["ltem"]["line"], t.map, lines[t.meta["ltem"]["line"]][t.meta["ltem"]["start"]:t.meta["ltem"]["end"]])
           for t in cells]
    assert got == [(2, [2, 3], "R {c:2}"), (3, [3, 4], "a"), (3, [3, 4], "\\| b"),
                   (5, [5, 6], "x"), (5, [5, 6], "y"),
                   (7, [7, 8], "q"), (7, [7, 8], "w"), (9, [9, 10], "1"), (9, [9, 10], "2")]
    assert cells[0].meta["ltem"]["colspan"] == 2
