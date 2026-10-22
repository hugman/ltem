"""The Python-Markdown extension against the full-document conformance cases."""

import importlib.util
import json
import pathlib

import markdown
import pytest

REPO = pathlib.Path(__file__).resolve().parents[4]
EXAMPLES = json.loads((REPO / "conformance" / "cases" / "spec-examples.json").read_text("utf-8"))["examples"]
_spec = importlib.util.spec_from_file_location("run", REPO / "conformance" / "tools" / "run.py")
_run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_run)
normalize = _run.normalize


# Where Python-Markdown itself differs from CommonMark outside tables.
HOST_DIFFERENCES = {
    "Size | Price\n- | -\n": "Python-Markdown needs a blank line before a list",
}


@pytest.mark.parametrize("extensions", [["ltem"], ["tables", "ltem"], ["ltem", "tables"]],
                         ids=["ltem", "tables+ltem", "ltem+tables"])
@pytest.mark.parametrize("ex", EXAMPLES, ids=[f"example-{e['example']}" for e in EXAMPLES])
def test_full_document(ex, extensions):
    if ex["ltem"] in HOST_DIFFERENCES:
        pytest.skip(HOST_DIFFERENCES[ex["ltem"]])
    if "tables" in extensions and not ex["tables"]:
        # With the built-in tables extension enabled too, it may still claim blocks that are
        # not LTEM tables (it is more permissive, e.g. about indentation).
        pytest.skip("LTEM finds no table here; the tables extension may")
    html = markdown.markdown(ex["ltem"], extensions=extensions)
    assert normalize(html) == normalize(ex["html"])


def test_align_attribute_option():
    src = "| a | b |\n|:--|--:|\n| 1 | 2 |"
    assert 'style="text-align: left;"' in markdown.markdown(src, extensions=["ltem"])
    html = markdown.markdown(src, extensions=["ltem"], extension_configs={"ltem": {"use_align_attribute": True}})
    assert 'align="left"' in html and "style" not in html


def test_table_between_paragraphs_and_inline_markup():
    src = "Intro *text*.\n\n| **A** | << |\n|---|---|\n| `x` | [l](u) |\n\nAfter."
    html = markdown.markdown(src, extensions=["ltem"])
    assert html.startswith("<p>Intro <em>text</em>.</p>")
    assert '<th colspan="2"><strong>A</strong></th>' in html
    assert "<td><code>x</code></td>" in html and '<a href="u">l</a>' in html
    assert html.endswith("<p>After.</p>")


def test_mkdocs_style_entry_point_name():
    from markdown_ltem import LtemExtension
    assert isinstance(markdown.Markdown(extensions=[LtemExtension()]), markdown.Markdown)
