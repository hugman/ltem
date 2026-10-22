"""Table model validity and the command-line interface."""

import io
import json
import sys

import jsonschema
import pytest

import ltem
from ltem import cli

from conftest import load_examples

DOC = """# Report

Some text with a price of $5.

| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |

```
| not | a | table |
|-----|---|-------|
```

| A {c:2} |
|---|---|
| 1 | 2 |
"""


def test_parsed_models_satisfy_schema_and_rules(schema):
    validator = jsonschema.Draft202012Validator(schema)
    for ex in load_examples():
        for result in ltem.find_tables(ex["ltem"]):
            d = result.table.to_dict()
            assert list(validator.iter_errors(d)) == []
            assert result.table.check() == []


def test_find_tables_skips_code_blocks_and_reports_lines():
    results = ltem.find_tables(DOC)
    assert len(results) == 2
    lines = DOC.split("\n")
    assert lines[results[0].start].startswith("| Region")
    assert lines[results[1].start].startswith("| A {c:2}")
    assert results[1].end == results[1].start + 3


def run(argv, stdin):
    old_in, old_out = sys.stdin, sys.stdout
    sys.stdin, sys.stdout = io.StringIO(stdin), io.StringIO()
    try:
        code = cli.main(argv)
        return code, sys.stdout.getvalue()
    finally:
        sys.stdin, sys.stdout = old_in, old_out


def test_cli_parse_and_render():
    code, out = run(["parse"], DOC)
    assert code == 0
    assert len(json.loads(out)["tables"]) == 2
    code, out = run(["render"], DOC)
    assert out.count("<table>") == 2 and 'colspan="2"' in out


def test_cli_validate():
    code, out = run(["validate", "--json"], "| A | B |\n|---|---|\n| << | 1 |\n")
    assert code == 1
    assert json.loads(out) == {"errors": [{"rule": "V13", "row": 1, "col": 0, "severity": "error"}]}
    # Warnings (V14) leave the table valid: exit status 0.
    code, out = run(["validate", "--json"], "| A | B |\n|---|---|\n| 1 |\n")
    assert code == 0
    assert json.loads(out) == {"errors": [{"rule": "V14", "row": 1, "col": None, "severity": "warning"}]}


MODEL = '{"version": "1.0", "rows": 2, "cols": 1, "header_rows": 1, "align": [null], "cells": [{"row": 0, "col": 0, "rowspan": 1, "colspan": 1, "text": "a | b"}, {"row": 1, "col": 0, "rowspan": 1, "colspan": 1, "text": "<<"}]}'


def test_cli_write():
    code, out = run(["write"], MODEL)
    assert (code, out) == (0, "| a \\| b |\n| --- |\n| \\<< |\n")
    code, out = run(["write"], '{"tables": [' + MODEL + ", " + MODEL + "]}")
    assert code == 0 and out.count("| --- |") == 2
    assert run(["write"], "not json")[0] == 2
    assert run(["write"], MODEL.replace('"rows": 2', '"rows": 3'))[0] == 1


def test_cli_fmt_keeps_the_indentation_of_a_table():
    code, out = run(["fmt"], "- item\n\n  | a | b |\n  |-|-|\n  | 1 | 2 |\n")
    assert (code, out) == (0, "- item\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n")


def test_cli_fmt_rewrites_tables_only():
    code, out = run(["fmt"], DOC)
    assert code == 0
    assert "Some text with a price of $5." in out
    assert "| not | a | table |" in out  # code block untouched
    assert "| A | << |\n| --- | --- |\n| 1 | 2 |" in out
    assert "| Region | Revenue | << |\n| ^^ | Q1 | Q2 |" in out


@pytest.mark.parametrize("text", ["", "no table here", "| a |\n| b |"])
def test_no_table(text):
    assert ltem.find_tables(text) == []


@pytest.mark.parametrize("eol", ["\r\n", "\r"])
def test_find_tables_accepts_commonmark_line_endings(eol):
    doc = eol.join(["```", "| a |", "|---|", "```", "", "| b |", "|---|", "| 1 |", ""])
    results = ltem.find_tables(doc)
    assert len(results) == 1 and [c.text for c in results[0].table.cells] == ["b", "1"]
    assert (results[0].start, results[0].end) == (5, 8)


def test_cli_translates_line_endings_on_stdin():
    code, out = run(["fmt"], "```\r\n| a |\r\n```\r\n\r\n| b {c:2} |\r\n|---|---|\r\n")
    assert code == 0
    assert out == "```\n| a |\n```\n\n| b | << |\n| --- | --- |\n"
