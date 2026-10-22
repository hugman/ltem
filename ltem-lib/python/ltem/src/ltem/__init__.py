"""LTEM (LLM-friendly Table-Enhanced Markdown).

Reference Python implementation of the LTEM specification, version 1.0:
Markdown pipe tables with merged cells and multi-row headers.

    >>> import ltem
    >>> result = ltem.parse_table('''
    ... | Region | Revenue | <<  |
    ... | ^^     | Q1      | Q2  |
    ... |--------|---------|-----|
    ... | Asia   | 100     | 120 |
    ... '''.strip())
    >>> [(c.text, c.rowspan, c.colspan) for c in result.table.cells][:2]
    [('Region', 2, 1), ('Revenue', 1, 2)]
"""

from ._syntax import (ends_table_body, indentation, is_delimiter_row, is_upper_header_row, split_row,
                      split_row_spans, starts_block)
from .fromhtml import HtmlTable, from_html, html_to_ltem
from .html import plain_inline, render_html
from .model import Cell, CellSource, Problem, Table
from .parser import ParseResult, find_tables, parse_table
from .writer import write, write_with_sources

__version__ = "0.1.1"
SPEC_VERSION = "1.0"

__all__ = [
    "Cell",
    "CellSource",
    "HtmlTable",
    "ParseResult",
    "Problem",
    "SPEC_VERSION",
    "Table",
    "find_tables",
    "from_html",
    "ends_table_body",
    "html_to_ltem",
    "indentation",
    "is_delimiter_row",
    "is_upper_header_row",
    "parse_table",
    "plain_inline",
    "render_html",
    "split_row",
    "split_row_spans",
    "starts_block",
    "write",
    "write_with_sources",
]
