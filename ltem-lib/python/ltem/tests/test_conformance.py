"""Run the conformance cases extracted from the specification."""

import re

import pytest

import ltem
from ltem.html import default_inline

from conftest import load_examples, normalize

EXAMPLES = load_examples()
INLINE = default_inline()


def tables_only(html):
    return re.findall(r"<table>.*?</table>", html, re.S)


def ids(examples):
    return [f"example-{e['example']}" for e in examples]


@pytest.mark.parametrize("ex", EXAMPLES, ids=ids(EXAMPLES))
def test_parse(ex):
    results = ltem.find_tables(ex["ltem"])
    assert [r.table.to_dict() for r in results] == ex["tables"]


@pytest.mark.parametrize("ex", EXAMPLES, ids=ids(EXAMPLES))
def test_validate(ex):
    results = ltem.find_tables(ex["ltem"])
    got = sorted((p.rule, p.row, p.col if p.col is not None else -1) for r in results for p in r.problems)
    want = sorted((e["rule"], e["row"], e["col"] if e["col"] is not None else -1) for e in ex["errors"])
    assert got == want


@pytest.mark.parametrize("ex", EXAMPLES, ids=ids(EXAMPLES))
def test_render_tables(ex):
    results = ltem.find_tables(ex["ltem"])
    got = [normalize(ltem.render_html(r.table, INLINE)) for r in results]
    want = [normalize(t) for t in tables_only(ex["html"])]
    assert got == want
