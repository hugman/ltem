"""HTML to LTEM conversion."""

import random

import pytest

import ltem
from ltem.html import default_inline

from test_writer import random_table

INLINE = default_inline()


def one(html, **kw):
    tables = ltem.from_html(html, **kw)
    assert len(tables) == 1
    return tables[0]


def comparable(table):
    """Model dict; alignment of a column without origin cells cannot survive HTML, so drop it."""
    d = table.to_dict()
    origin_cols = {c["col"] for c in d["cells"]}
    d["align"] = [a if i in origin_cols else None for i, a in enumerate(d["align"])]
    return d


def test_random_tables_survive_html_round_trip():
    rng = random.Random(7)
    for _ in range(2000):
        rows = rng.randint(1, 7)
        table = random_table(rng, rows, rng.randint(1, 6), rng.randint(1, rows))
        html = ltem.render_html(table, INLINE)
        back = one(html).table
        assert comparable(back) == comparable(table), html


def test_spans_and_thead():
    t = one("""<table><thead>
      <tr><th rowspan="2">Region</th><th colspan="2">Revenue</th></tr>
      <tr><th>Q1</th><th>Q2</th></tr></thead>
      <tbody><tr><td>Asia</td><td>100</td><td>120</td></tr></tbody></table>""")
    assert t.warnings == []
    assert ltem.write(t.table) == ("| Region | Revenue | << |\n| ^^ | Q1 | Q2 |\n| --- | --- | --- |\n"
                                  "| Asia | 100 | 120 |")


def test_header_from_leading_th_rows_and_clipped_rowspan():
    t = one("<table><tr><th rowspan=3>A</th><th>B</th></tr><tr><td>1</td></tr><tr><td>2</td></tr></table>")
    assert t.table.header_rows == 1
    assert t.table.cells[0].rowspan == 1  # a header cell may not reach into the body
    # The body cells stay where the HTML puts them, beside the cut header cell.
    assert ltem.write(t.table) == "| A | B |\n| --- | --- |\n|  | 1 |\n|  | 2 |"
    assert t.warnings == ["a rowspan in row 0 was cut at the end of the header rows; "
                          "header cells do not reach into the body"]


def test_no_header_row_uses_first_row_with_warning():
    t = one("<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>")
    assert t.table.header_rows == 1
    assert any("no header row" in w for w in t.warnings)


def test_forced_header_rows():
    t = one("<table><tr><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></table>", header_rows=2)
    assert t.table.header_rows == 2


def test_rowspan_zero_and_ragged_rows():
    t = one("<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>"
            "<tbody><tr><td rowspan=0>x</td><td>1</td></tr><tr><td>2</td><td>3</td></tr></tbody></table>")
    assert ltem.write(t.table) == "| A | B | C |\n| --- | --- | --- |\n| x | 1 |  |\n| ^^ | 2 | 3 |"


def test_overlap_is_cut_with_warning():
    t = one("<table><tr><th>A</th><th>B</th></tr>"
            "<tr><td>x</td><td rowspan=2>y</td></tr><tr><td colspan=2>z</td></tr></table>")
    assert t.table.check() == []
    assert any("cut" in w for w in t.warnings)


def test_inline_content():
    t = one("""<table><tr><th>H</th></tr><tr><td>
      <p>First <strong>bold</strong> and <em>it</em></p>
      <p>Use <code>x|y</code>, see <a href="https://e.org">site</a> <img src="a.png" alt="pic"></p>
      <ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>H<sub>2</sub>O
    </td></tr></table>""")
    assert t.table.cells[1].text == ("First **bold** and *it*\n"
                                     "Use `x|y`, see [site](https://e.org) ![pic](a.png)\n"
                                     "- one\n- two\n1. first\nH<sub>2</sub>O")
    out = ltem.write(t.table)
    assert "`x\\|y`" in out  # pipes are escaped for the table, even in code


def test_text_is_escaped_for_markdown():
    t = one(r"<table><tr><th>a*b* _c_ snake_case [x] &lt;b&gt; &amp;amp; C:\dir \* $5</th></tr></table>")
    assert t.table.cells[0].text == r"a\*b\* \_c\_ snake_case \[x\] \<b> \&amp; C:\dir &#92;\* $5"
    rendered = ltem.render_html(t.table, INLINE)
    assert "a*b* _c_ snake_case [x] &lt;b&gt; &amp;amp; C:\\dir \\* $5" in rendered


def test_nested_table_is_flattened_with_warning():
    t = one("<table><tr><th>outer</th></tr><tr><td><table><tr><td>a</td><td>b</td></tr>"
            "<tr><td>c</td><td>d</td></tr></table></td></tr></table>")
    assert t.table.cells[1].text == "a; b\nc; d"
    assert any("inside a cell" in w for w in t.warnings)


def test_multiple_tables_and_tfoot_order():
    tables = ltem.from_html("<table><tfoot><tr><td>total</td></tr></tfoot><thead><tr><th>h</th></tr></thead>"
                            "<tbody><tr><td>row</td></tr></tbody></table><p>x</p><table><tr><th>2</th></tr></table>")
    assert len(tables) == 2
    assert [c.text for c in tables[0].table.cells] == ["h", "row", "total"]


def test_html_to_ltem_and_cli(capsys):
    html = "<table><tr><th>A</th><th>B</th></tr><tr><td colspan=2>both</td></tr></table>"
    assert ltem.html_to_ltem(html) == "| A | B |\n| --- | --- |\n| both | << |"
    from ltem import cli
    import io
    import sys
    old = sys.stdin
    sys.stdin = io.StringIO(html)
    try:
        assert cli.main(["from-html"]) == 0
    finally:
        sys.stdin = old
    assert capsys.readouterr().out.strip() == "| A | B |\n| --- | --- |\n| both | << |"


@pytest.mark.parametrize("html", ["", "<p>no table</p>", "<table></table>"])
def test_no_tables(html):
    assert ltem.from_html(html) == []


# -- fixed bugs (2026-10-07) --------------------------------------------------------

def test_list_items_are_numbered_by_position():
    t = one("<table><tr><th>h</th></tr><tr><td><ol><li>a</li><li>a</li><li>b</li></ol></td></tr></table>")
    assert t.table.cells[1].text == "1. a\n2. a\n3. b"
    t = one("<table><tr><th>h</th></tr><tr><td><ol><li><b>x</b></li><li><b>x</b></li></ol></td></tr></table>")
    assert t.table.cells[1].text == "1. **x**\n2. **x**"  # equal items used to recurse forever


def test_only_the_first_thead_is_a_header_group():
    # An empty first <thead> gives no header rows; a later <thead> is an ordinary row group.
    t = one("<table><thead></thead><tbody><tr><td rowspan=2>x</td><td>1</td></tr><tr><td>2</td></tr></tbody>"
            "<thead><tr><th>h</th><th>i</th></tr></thead></table>")
    assert t.table.check() == []
    assert t.table.header_rows == 1 and any("no header row" in w for w in t.warnings)
    assert [c.text for c in t.table.cells][-2:] == ["h", "i"]


def test_row_groups_keep_document_order():
    t = one("<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody>"
            "<tr><td>b</td></tr><tbody><tr><td>c</td></tr></tbody></table>")
    assert [c.text for c in t.table.cells] == ["h", "a", "b", "c"]


def test_text_split_at_a_lone_angle_bracket_keeps_its_backslash():
    t = one(r"<table><tr><th>C:\< x</th></tr></table>")
    rendered = ltem.render_html(t.table, INLINE)
    assert "C:\\&lt; x" in rendered


@pytest.mark.parametrize("value,colspan,rowspan", [
    ("-1", 1, 1), ("1_0", 1, 1), ("\uff12", 1, 1), (" 2 ", 2, 2), ("2abc", 2, 2), ("+2", 2, 2), ("0", 1, 3), ("", 1, 1),
])
def test_span_values_follow_html_integer_rules(value, colspan, rowspan):
    t = one(f'<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead>'
            f'<tbody><tr><td colspan="{value}" rowspan="{value}">x</td></tr><tr><td>y</td></tr>'
            f'<tr><td>z</td></tr></tbody></table>')
    cell = next(c for c in t.table.cells if c.text == "x")
    assert (cell.colspan, cell.rowspan) == (colspan, rowspan)


def test_text_align_matches_ascii_only():
    t = one('<table><tr><th style="text-align: r\u0130ght">h</th><th style="TEXT-ALIGN: CENTER">i</th></tr></table>')
    assert t.table.align == [None, "center"]


# -- header_rows=0, row headers and plain text (2026-10-07) ---------------------------

def test_header_rows_zero_gives_an_empty_header_row():
    t = one("<table><tr><td>a</td><td rowspan=2>b</td></tr><tr><td>c</td></tr></table>", header_rows=0)
    assert t.warnings == []
    assert ltem.write(t.table) == "|  |  |\n| --- | --- |\n| a | b |\n| c | ^^ |"


def test_header_cells_in_body_rows_are_reported_once():
    t = one("<table><tr><th>h</th><th>i</th></tr><tr><th>r1</th><td>1</td></tr><tr><th>r2</th><td>2</td></tr></table>")
    assert t.table.header_rows == 1
    assert t.warnings == ["2 header cells (<th>) outside the header rows became ordinary cells; "
                          "LTEM 1.0 has no row headers"]


def test_plain_inline_keeps_text_only():
    html = ('<table><tr><th>a</th></tr><tr><td><b>*x*</b> <a href="u">l</a> <code>c`d</code> '
            '<img src="p.png" alt="[p]"> H<sub>2</sub>O</td></tr></table>')
    assert one(html, inline="plain").table.cells[1].text == "\\*x\\* l c\\`d \\[p\\] H2O"
    assert one(html).table.cells[1].text.startswith("**\\*x\\***")


def test_inline_mode_is_checked():
    with pytest.raises(ValueError):
        ltem.from_html("<table></table>", inline="rich")


def test_ideographic_space_is_content_not_html_whitespace():
    t = one("<table><tr><th>\u3000구분</th></tr><tr><td>\u3000\u3000소계  합</td></tr></table>")
    assert [c.text for c in t.table.cells] == ["\u3000구분", "\u3000\u3000소계 합"]
    assert one("<table><tr><th>h</th></tr><tr><td><b>\u3000x</b></td></tr></table>").table.cells[1].text == "\u3000**x**"


# -- html-profile-v0 (2026-10-12) -----------------------------------------------------

ROW_HEADER_NOTE = "header cells (<th>) outside the header rows became ordinary cells; LTEM 1.0 has no row headers"


def test_profile_title_row_counts_as_header():
    t = one('<table><tr><th colspan="3">(단위: 백만원)</th></tr><tr><th>구분</th><th>2024</th><th>2025</th></tr>'
            '<tr><th>인건비</th><td>100</td><td>120</td></tr></table>', header_rows=2, inline="plain")
    assert ltem.write(t.table) == ("| (단위: 백만원) | << | << |\n| 구분 | 2024 | 2025 |\n| --- | --- | --- |\n"
                                  "| 인건비 | 100 | 120 |")
    assert t.warnings == ["1 " + ROW_HEADER_NOTE]


def test_profile_form_table_without_header():
    t = one('<table><tr><th>성명</th><td>홍길동</td><th>생년월일</th><td>1990.1.1</td></tr>'
            '<tr><th>소속</th><td>기획과</td><th>직급</th><td>주무관</td></tr></table>', header_rows=0, inline="plain")
    assert ltem.write(t.table) == ("|  |  |  |  |\n| --- | --- | --- | --- |\n| 성명 | 홍길동 | 생년월일 | 1990.1.1 |\n"
                                  "| 소속 | 기획과 | 직급 | 주무관 |")
    assert t.warnings == ["4 " + ROW_HEADER_NOTE]


def test_profile_rows_covered_by_rowspans_are_empty_tr():
    t = one('<table><tr><th rowspan="2">구분</th><th rowspan="2">값</th></tr><tr></tr>'
            '<tr><td rowspan="2" colspan="2">합계</td></tr><tr></tr></table>', header_rows=2)
    assert t.warnings == []
    assert ltem.write(t.table) == "| 구분 | 값 |\n| ^^ | ^^ |\n| --- | --- |\n| 합계 | << |\n| ^^ | << |"


def test_header_rows_inside_thead_keep_cell_positions():
    # header_rows smaller than <thead>: a <thead> cell spanning past it is cut, and nothing moves.
    t = one("<table><thead><tr><th rowspan=2>a</th><th>b</th></tr><tr><th>c</th></tr></thead></table>",
            header_rows=1)
    assert ltem.write(t.table) == "| a | b |\n| --- | --- |\n|  | c |"
    assert t.warnings == ["a rowspan in row 0 was cut at the end of the header rows; "
                          "header cells do not reach into the body", "1 " + ROW_HEADER_NOTE]


# -- two backslashes in a row (2026-10-14) -----------------------------------------------

def test_cell_text_never_holds_two_backslashes_in_a_row():
    # LTEM reads \\ as a line break (spec 4.2), so a converter must write it another way.
    cases = {
        "<table><tr><th><code>a\\\\b</code></th></tr></table>": "a&#92;\\b",  # code span becomes text
        "<table><tr><th><code>x\\</code>\\y</th></tr></table>": "`x\\`\\y",
        "<table><tr><th><span>x\\</span>\\y</th></tr></table>": "x&#92;\\y",  # across a text boundary
        "<table><tr><th><a href=\"u\\\\v\">l</a></th></tr></table>": "[l](u&#92;&#92;v)",
        "<table><tr><th><img src=\"p\\\\q\" alt=\"i\"></th></tr></table>": "![i](p&#92;&#92;q)",
        "<table><tr><th>a\\</th></tr></table>": "a\\",  # a backslash that ends a line stays as it is
        "<table><tr><th><b>a\\</b></th></tr></table>": "**a&#92;**",
    }
    for html, text in cases.items():
        t = one(html)
        assert t.table.cells[0].text == text, html
        assert ltem.parse_table(ltem.write(t.table)).table.cells[0].text == text, html
    assert one("<table><tr><th><code>a\\\\b</code></th></tr></table>").warnings == [
        "a code span with two backslashes in a row became plain text; LTEM 1.0 cell text cannot hold \\\\"]
    plain = one("<table><tr><th><code>x\\</code>\\y</th></tr></table>", inline="plain")
    assert plain.table.cells[0].text == "x&#92;\\y"


def test_model_with_two_backslashes_in_a_row_is_invalid():
    from ltem.model import Cell, Table
    table = Table(1, 1, 1, [None], [Cell(0, 0, text="a\\\\b")])
    assert table.check() == ["cell (0,0) text has two backslashes in a row, which LTEM 1.0 reads as a line break"]
    with pytest.raises(ValueError):
        ltem.write(table)

