//! HTML to LTEM conversion.

mod common;

use ltem::{
    from_html, from_html_with, html_to_ltem, FromHtmlOptions, HtmlTable, InlineFormat, Table,
};

const CUT_AT_HEADER: &str =
    "a rowspan in row 0 was cut at the end of the header rows; header cells do not reach into the body";
const ROW_HEADER_NOTE: &str =
    "header cells (<th>) outside the header rows became ordinary cells; LTEM 1.0 has no row headers";

fn one(html: &str, header_rows: Option<usize>) -> HtmlTable {
    let mut tables = from_html(html, header_rows);
    assert_eq!(tables.len(), 1, "{html}");
    tables.remove(0)
}

fn write(table: &Table) -> String {
    ltem::write(table).unwrap()
}

/// The model; the alignment of a column without origin cells cannot survive HTML, so
/// it is dropped.
#[cfg(feature = "commonmark-inline")]
fn comparable(mut table: Table) -> Table {
    for c in 0..table.cols {
        if !table.cells.iter().any(|cell| cell.col == c) {
            table.align[c] = None;
        }
    }
    table
}

#[cfg(feature = "commonmark-inline")]
#[test]
fn random_tables_survive_html_round_trip() {
    use common::{random_table, Rng};
    let mut rng = Rng::new(7);
    for _ in 0..2000 {
        let rows = rng.randint(1, 7);
        let cols = rng.randint(1, 6);
        let header_rows = rng.randint(1, rows);
        let table = random_table(&mut rng, rows, cols, header_rows);
        let html = ltem::render_html(&table, Some(&ltem::commonmark_inline));
        let back = one(&html, None).table;
        assert_eq!(comparable(back), comparable(table), "{html}");
    }
}

#[test]
fn spans_and_thead() {
    let t = one(
        r#"<table><thead>
      <tr><th rowspan="2">Region</th><th colspan="2">Revenue</th></tr>
      <tr><th>Q1</th><th>Q2</th></tr></thead>
      <tbody><tr><td>Asia</td><td>100</td><td>120</td></tr></tbody></table>"#,
        None,
    );
    assert!(t.warnings.is_empty());
    assert_eq!(
        write(&t.table),
        "| Region | Revenue | << |\n| ^^ | Q1 | Q2 |\n| --- | --- | --- |\n| Asia | 100 | 120 |"
    );
}

#[test]
fn header_from_leading_th_rows_and_clipped_rowspan() {
    let t = one("<table><tr><th rowspan=3>A</th><th>B</th></tr><tr><td>1</td></tr><tr><td>2</td></tr></table>", None);
    assert_eq!(t.table.header_rows, 1);
    assert_eq!(t.table.cells[0].rowspan, 1); // a header cell may not reach into the body
                                             // The body cells stay where the HTML puts them, beside the cut header cell.
    assert_eq!(
        write(&t.table),
        "| A | B |\n| --- | --- |\n|  | 1 |\n|  | 2 |"
    );
    assert_eq!(t.warnings, [CUT_AT_HEADER]);
}

#[test]
fn no_header_row_uses_first_row_with_warning() {
    let t = one(
        "<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>",
        None,
    );
    assert_eq!(t.table.header_rows, 1);
    assert!(t.warnings.iter().any(|w| w.contains("no header row")));
}

#[test]
fn forced_header_rows() {
    let html = "<table><tr><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></table>";
    assert_eq!(one(html, Some(2)).table.header_rows, 2);
    assert_eq!(one(html, Some(9)).table.header_rows, 3);
}

#[test]
fn rowspan_zero_and_ragged_rows() {
    let t = one(
        "<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>\
         <tbody><tr><td rowspan=0>x</td><td>1</td></tr><tr><td>2</td><td>3</td></tr></tbody></table>",
        None,
    );
    assert_eq!(
        write(&t.table),
        "| A | B | C |\n| --- | --- | --- |\n| x | 1 |  |\n| ^^ | 2 | 3 |"
    );
}

#[test]
fn overlap_is_cut_with_warning() {
    let t = one(
        "<table><tr><th>A</th><th>B</th></tr><tr><td>x</td><td rowspan=2>y</td></tr><tr><td colspan=2>z</td></tr></table>",
        None,
    );
    assert_eq!(t.table.check(), Vec::<String>::new());
    assert!(t.warnings.iter().any(|w| w.contains("cut")));
}

#[test]
fn inline_content() {
    let t = one(
        r#"<table><tr><th>H</th></tr><tr><td>
      <p>First <strong>bold</strong> and <em>it</em></p>
      <p>Use <code>x|y</code>, see <a href="https://e.org">site</a> <img src="a.png" alt="pic"></p>
      <ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>H<sub>2</sub>O
    </td></tr></table>"#,
        None,
    );
    assert_eq!(
        t.table.cells[1].text,
        "First **bold** and *it*\nUse `x|y`, see [site](https://e.org) ![pic](a.png)\n- one\n- two\n1. first\nH<sub>2</sub>O"
    );
    assert!(write(&t.table).contains("`x\\|y`")); // pipes are escaped for the table, even in code
}

#[test]
fn plain_inline_format_drops_formatting() {
    let html = r#"<table><tr><th>H</th></tr><tr><td><b>bold</b> <a href="x">link</a> <img alt="pic*" src="a.png"> <code>a*b</code><br>2<sup>x</sup></td></tr></table>"#;
    let options = FromHtmlOptions {
        inline: InlineFormat::Plain,
        ..FromHtmlOptions::default()
    };
    let t = from_html_with(html, &options).remove(0);
    assert_eq!(t.table.cells[1].text, "bold link pic\\* a\\*b\n2x");
}

#[test]
fn text_is_escaped_for_markdown() {
    let t = one(
        r"<table><tr><th>a*b* _c_ snake_case [x] &lt;b&gt; &amp;amp; C:\dir \* $5</th></tr></table>",
        None,
    );
    assert_eq!(
        t.table.cells[0].text,
        r"a\*b\* \_c\_ snake_case \[x\] \<b> \&amp; C:\dir &#92;\* $5"
    );
    #[cfg(feature = "commonmark-inline")]
    {
        let rendered = ltem::render_html(&t.table, Some(&ltem::commonmark_inline));
        assert!(
            rendered.contains("a*b* _c_ snake_case [x] &lt;b&gt; &amp;amp; C:\\dir \\* $5"),
            "{rendered}"
        );
    }
}

#[test]
fn nested_table_is_flattened_with_warning() {
    let t = one(
        "<table><tr><th>outer</th></tr><tr><td><table><tr><td>a</td><td>b</td></tr>\
         <tr><td>c</td><td>d</td></tr></table></td></tr></table>",
        None,
    );
    assert_eq!(t.table.cells[1].text, "a; b\nc; d");
    assert!(t.warnings.iter().any(|w| w.contains("inside a cell")));
}

#[test]
fn multiple_tables_and_tfoot_order() {
    let tables = from_html(
        "<table><tfoot><tr><td>total</td></tr></tfoot><thead><tr><th>h</th></tr></thead>\
         <tbody><tr><td>row</td></tr></tbody></table><p>x</p><table><tr><th>2</th></tr></table>",
        None,
    );
    assert_eq!(tables.len(), 2);
    let texts: Vec<&str> = tables[0]
        .table
        .cells
        .iter()
        .map(|c| c.text.as_str())
        .collect();
    assert_eq!(texts, ["h", "row", "total"]);
}

#[test]
fn html_to_ltem_joins_tables() {
    let html = "<table><tr><th>A</th><th>B</th></tr><tr><td colspan=2>both</td></tr></table>";
    assert_eq!(
        html_to_ltem(html, None).unwrap(),
        "| A | B |\n| --- | --- |\n| both | << |"
    );
    assert_eq!(
        html_to_ltem(&format!("{html}{html}"), None).unwrap(),
        "| A | B |\n| --- | --- |\n| both | << |\n\n| A | B |\n| --- | --- |\n| both | << |"
    );
}

#[test]
fn no_tables() {
    for html in ["", "<p>no table</p>", "<table></table>"] {
        assert!(from_html(html, None).is_empty(), "{html:?}");
    }
}

#[test]
fn character_references_and_alignment() {
    let t = one(
        r#"<table><tr><th align=" RIGHT ">&copy;&nbsp;x &ampy &#x41;&#66</th><th style="color:red; TEXT-ALIGN : center">b</th></tr></table>"#,
        None,
    );
    // &nbsp; is content, not HTML whitespace.
    assert_eq!(t.table.cells[0].text, "©\u{a0}x &y AB");
    assert_eq!(
        t.table.align,
        [Some(ltem::Align::Right), Some(ltem::Align::Center)]
    );
}

#[test]
fn ordered_list_items_are_numbered_by_position() {
    // Items are numbered by their position among the list's items, also when two items
    // have the same content.
    let t = one(
        "<table><tr><td><ol><li>a</li><li>a</li><li>b</li></ol></td></tr></table>",
        None,
    );
    assert_eq!(t.table.cells[0].text, "1. a\n2. a\n3. b");
    let t = one(
        "<table><tr><th>h</th></tr><tr><td><ol><li><b>x</b></li><li><b>x</b></li></ol></td></tr></table>",
        None,
    );
    assert_eq!(t.table.cells[1].text, "1. **x**\n2. **x**");
}

#[test]
fn only_the_first_thead_is_a_header_group() {
    // An empty first <thead> gives no header rows; a later <thead> is an ordinary row group.
    let html = "<table><thead></thead><tbody><tr><td rowspan=2>x</td><td>1</td></tr><tr><td>2</td></tr></tbody>\
                <thead><tr><th>h</th><th>i</th></tr></thead></table>";
    let t = one(html, None);
    assert_eq!(t.table.check(), Vec::<String>::new());
    assert_eq!(t.table.header_rows, 1);
    assert!(t.warnings.iter().any(|w| w.contains("no header row")));
    let texts: Vec<&str> = t.table.cells.iter().map(|c| c.text.as_str()).collect();
    assert_eq!(texts[texts.len() - 2..], ["h", "i"]);
    assert!(html_to_ltem(html, None).is_ok());
}

#[test]
fn row_groups_keep_document_order() {
    let t = one(
        "<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody>\
         <tr><td>b</td></tr><tbody><tr><td>c</td></tr></tbody></table>",
        None,
    );
    let texts: Vec<&str> = t.table.cells.iter().map(|c| c.text.as_str()).collect();
    assert_eq!(texts, ["h", "a", "b", "c"]);
    // The first <tfoot> comes last; a later one keeps its place.
    let t = one(
        "<table><tfoot><tr><td>f1</td></tr></tfoot><tr><th>h</th></tr><tfoot><tr><td>f2</td></tr></tfoot>\
         <tr><td>b</td></tr></table>",
        None,
    );
    let texts: Vec<&str> = t.table.cells.iter().map(|c| c.text.as_str()).collect();
    assert_eq!(texts, ["h", "f2", "b", "f1"]);
}

#[test]
fn text_split_at_a_lone_angle_bracket_keeps_its_backslash() {
    let t = one(r"<table><tr><th>C:\< x</th></tr></table>", None);
    assert_eq!(t.table.cells[0].text, "C:&#92;< x");
    #[cfg(feature = "commonmark-inline")]
    {
        let rendered = ltem::render_html(&t.table, Some(&ltem::commonmark_inline));
        assert!(rendered.contains("C:\\&lt; x"), "{rendered}");
    }
}

#[test]
fn span_values_follow_html_integer_rules() {
    let cases = [
        ("-1", 1, 1),
        ("1_0", 1, 1),
        ("\u{ff12}", 1, 1),
        (" 2 ", 2, 2),
        ("2abc", 2, 2),
        ("+2", 2, 2),
        ("0", 1, 3),
        ("-0", 1, 3),
        ("", 1, 1),
        ("\t\n3", 3, 3),
        ("\u{a0}2", 1, 1),
        ("99999999999999999999999", 1000, 3), // colspan is cut at 1000, rowspan at the group end
    ];
    for (value, colspan, rowspan) in cases {
        let t = one(
            &format!(
                "<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead>\
                 <tbody><tr><td colspan=\"{value}\" rowspan=\"{value}\">x</td></tr><tr><td>y</td></tr>\
                 <tr><td>z</td></tr></tbody></table>"
            ),
            None,
        );
        let cell = t.table.cells.iter().find(|c| c.text == "x").unwrap();
        assert_eq!(
            (cell.colspan, cell.rowspan),
            (colspan, rowspan),
            "{value:?}"
        );
    }
}

#[test]
fn text_align_matches_ascii_only() {
    let t = one(
        "<table><tr><th style=\"text-align: r\u{130}ght\">h</th><th style=\"TEXT-ALIGN: CENTER\">i</th></tr></table>",
        None,
    );
    assert_eq!(t.table.align, [None, Some(ltem::Align::Center)]);
}

/// Random tables with random row groups, spans and header rows always give valid
/// models (rule 4 of the table model included).
#[test]
fn converted_models_are_always_valid() {
    use common::Rng;
    let mut rng = Rng::new(20261007);
    let colspans = ["", "0", "1", "2", "3", "5", "-1", "x", "2abc"];
    let rowspans = ["", "0", "1", "2", "3", "5", "-1", "x", "2abc", "65535"];
    for _ in 0..3000 {
        let mut html = String::from("<table>");
        for _ in 0..rng.randint(1, 5) {
            let group = *rng.choice(&["thead", "tbody", "tfoot", "", ""]);
            if !group.is_empty() {
                html += &format!("<{group}>");
            }
            for _ in 0..rng.randint(0, 3) {
                html += "<tr>";
                for _ in 0..rng.randint(0, 4) {
                    let tag = if rng.random() < 0.3 { "th" } else { "td" };
                    let (c, r) = (rng.choice(&colspans), rng.choice(&rowspans));
                    html += &format!("<{tag} colspan=\"{c}\" rowspan=\"{r}\">v</{tag}>");
                }
                html += "</tr>";
            }
            if !group.is_empty() && rng.random() < 0.8 {
                html += &format!("</{group}>");
            }
        }
        html += "</table>";
        let header_rows = if rng.random() < 0.2 {
            Some(rng.randint(0, 4))
        } else {
            None
        };
        for t in from_html(&html, header_rows) {
            assert_eq!(t.table.check(), Vec::<String>::new(), "{html}");
            assert!(ltem::write(&t.table).is_ok());
        }
    }
}

#[test]
fn deep_nesting_does_not_overflow_the_stack() {
    let depth = 200_000;
    let html = format!(
        "<table><tr><td>{}x{}</td></tr></table>",
        "<span>".repeat(depth),
        "</span>".repeat(depth)
    );
    let t = one(&html, None);
    assert_eq!(t.table.cells[0].text, "x");
}

#[test]
fn malformed_html_is_read_forgivingly() {
    // Implicitly closed cells and rows, an unclosed table, and a truncated tag at the end.
    let t = one("<table><tr><th>a<th>b<tr><td>1<td>2</table", None);
    assert_eq!(write(&t.table), "| a | b |\n| --- | --- |\n| 1 | 2 |");
    let t = one("<TABLE><TR><TD>x<script>a<b>|</script></TD></TR>", None);
    assert_eq!(t.table.cells[0].text, "xa\\<b>|"); // raw script text, escaped as text
}

#[test]
fn header_rows_zero_gives_an_empty_header_row() {
    let t = one(
        "<table><tr><td>a</td><td rowspan=2>b</td></tr><tr><td>c</td></tr></table>",
        Some(0),
    );
    assert!(t.warnings.is_empty());
    assert_eq!(
        write(&t.table),
        "|  |  |\n| --- | --- |\n| a | b |\n| c | ^^ |"
    );
    // A <thead> is an ordinary row group then, and its <th> cells are ordinary cells.
    let t = one(
        "<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>",
        Some(0),
    );
    assert_eq!((t.table.rows, t.table.header_rows), (3, 1));
    assert_eq!(write(&t.table), "|  |\n| --- |\n| h |\n| 1 |");
    assert_eq!(
        t.warnings,
        ["1 header cells (<th>) outside the header rows became ordinary cells; LTEM 1.0 has no row headers"]
    );
}

#[test]
fn header_cells_in_body_rows_are_reported_once() {
    let t = one(
        "<table><tr><th>h</th><th>i</th></tr><tr><th>r1</th><td>1</td></tr><tr><th>r2</th><td>2</td></tr></table>",
        None,
    );
    assert_eq!(t.table.header_rows, 1);
    assert_eq!(
        t.warnings,
        ["2 header cells (<th>) outside the header rows became ordinary cells; LTEM 1.0 has no row headers"]
    );
    // It comes before the notes about cell content.
    let t = one(
        "<table><tr><td>a</td></tr><tr><th><table><tr><td>x</td></tr></table></th></tr></table>",
        None,
    );
    assert_eq!(t.warnings.len(), 3);
    assert!(t.warnings[0].contains("no header row"));
    assert!(t.warnings[1].starts_with("1 header cells (<th>)"));
    assert!(t.warnings[2].contains("inside a cell"));
}

#[test]
fn plain_inline_keeps_text_only() {
    let html = "<table><tr><th>a</th></tr><tr><td><b>*x*</b> <a href=\"u\">l</a> <code>c`d</code> \
                <img src=\"p.png\" alt=\"[p]\"> H<sub>2</sub>O</td></tr></table>";
    let options = FromHtmlOptions {
        inline: InlineFormat::Plain,
        ..FromHtmlOptions::default()
    };
    let t = from_html_with(html, &options).remove(0);
    assert_eq!(t.table.cells[1].text, "\\*x\\* l c\\`d \\[p\\] H2O");
    assert!(one(html, None).table.cells[1]
        .text
        .starts_with("**\\*x\\***"));
}

#[test]
fn ideographic_space_is_content_not_html_whitespace() {
    let t = one(
        "<table><tr><th>\u{3000}구분</th></tr><tr><td>\u{3000}\u{3000}소계  합</td></tr></table>",
        None,
    );
    let texts: Vec<&str> = t.table.cells.iter().map(|c| c.text.as_str()).collect();
    assert_eq!(texts, ["\u{3000}구분", "\u{3000}\u{3000}소계 합"]);
    let t = one(
        "<table><tr><th>h</th></tr><tr><td><b>\u{3000}x</b></td></tr></table>",
        None,
    );
    assert_eq!(t.table.cells[1].text, "\u{3000}**x**");
    // Other spaces (no-break space, em space) are content too, also at the edges of list
    // items, links and <sup>; emphasis marks go inside any Unicode whitespace.
    let t = one(
        "<table><tr><th>\u{a0}a\u{a0} \u{2003}b\u{2003}</th></tr><tr><td><ol><li>\u{3000}x\u{3000}</li></ol>\
         <a href=\"u\">\u{3000}l\u{3000}</a><sup>\u{3000}s </sup><b> \u{a0}y\u{3000} </b></td></tr></table>",
        None,
    );
    let texts: Vec<&str> = t.table.cells.iter().map(|c| c.text.as_str()).collect();
    assert_eq!(
        texts,
        [
            "\u{a0}a\u{a0} \u{2003}b\u{2003}",
            "1. \u{3000}x\u{3000}\n[\u{3000}l\u{3000}](u)<sup>\u{3000}s</sup> \u{a0}**y**\u{3000}",
        ]
    );
}

// -- html-profile-v0 (2026-10-12) ----------------------------------------------------

fn plain(html: &str, header_rows: usize) -> HtmlTable {
    let options = FromHtmlOptions {
        header_rows: Some(header_rows),
        inline: InlineFormat::Plain,
    };
    let mut tables = from_html_with(html, &options);
    assert_eq!(tables.len(), 1, "{html}");
    tables.remove(0)
}

#[test]
fn profile_title_row_counts_as_header() {
    let t = plain(
        "<table><tr><th colspan=\"3\">(단위: 백만원)</th></tr><tr><th>구분</th><th>2024</th><th>2025</th></tr>\
         <tr><th>인건비</th><td>100</td><td>120</td></tr></table>",
        2,
    );
    assert_eq!(
        write(&t.table),
        "| (단위: 백만원) | << | << |\n| 구분 | 2024 | 2025 |\n| --- | --- | --- |\n| 인건비 | 100 | 120 |"
    );
    assert_eq!(t.warnings, [format!("1 {ROW_HEADER_NOTE}")]);
}

#[test]
fn profile_form_table_without_header() {
    let t = plain(
        "<table><tr><th>성명</th><td>홍길동</td><th>생년월일</th><td>1990.1.1</td></tr>\
         <tr><th>소속</th><td>기획과</td><th>직급</th><td>주무관</td></tr></table>",
        0,
    );
    assert_eq!(
        write(&t.table),
        "|  |  |  |  |\n| --- | --- | --- | --- |\n| 성명 | 홍길동 | 생년월일 | 1990.1.1 |\n\
         | 소속 | 기획과 | 직급 | 주무관 |"
    );
    assert_eq!(t.warnings, [format!("4 {ROW_HEADER_NOTE}")]);
}

#[test]
fn profile_rows_covered_by_rowspans_are_empty_tr() {
    let t = one(
        "<table><tr><th rowspan=\"2\">구분</th><th rowspan=\"2\">값</th></tr><tr></tr>\
         <tr><td rowspan=\"2\" colspan=\"2\">합계</td></tr><tr></tr></table>",
        Some(2),
    );
    assert!(t.warnings.is_empty());
    assert_eq!(
        write(&t.table),
        "| 구분 | 값 |\n| ^^ | ^^ |\n| --- | --- |\n| 합계 | << |\n| ^^ | << |"
    );
}

#[test]
fn header_rows_inside_thead_keep_cell_positions() {
    // header_rows smaller than <thead>: a <thead> cell spanning past it is cut, and nothing moves.
    let t = one(
        "<table><thead><tr><th rowspan=2>a</th><th>b</th></tr><tr><th>c</th></tr></thead></table>",
        Some(1),
    );
    assert_eq!(write(&t.table), "| a | b |\n| --- | --- |\n|  | c |");
    assert_eq!(
        t.warnings,
        [CUT_AT_HEADER.to_string(), format!("1 {ROW_HEADER_NOTE}")]
    );
}

// -- two backslashes in a row (2026-10-14) ---------------------------------------------

#[test]
fn cell_text_never_holds_two_backslashes_in_a_row() {
    // LTEM reads \\ as a line break (spec 4.2), so a converter must write it another way.
    let cases = [
        // A code span becomes text.
        (
            r"<table><tr><th><code>a\\b</code></th></tr></table>",
            r"a&#92;\b",
        ),
        (
            r"<table><tr><th><code>x\</code>\y</th></tr></table>",
            r"`x\`\y",
        ),
        // Across a text boundary.
        (
            r"<table><tr><th><span>x\</span>\y</th></tr></table>",
            r"x&#92;\y",
        ),
        (
            r#"<table><tr><th><a href="u\\v">l</a></th></tr></table>"#,
            "[l](u&#92;&#92;v)",
        ),
        (
            r#"<table><tr><th><img src="p\\q" alt="i"></th></tr></table>"#,
            "![i](p&#92;&#92;q)",
        ),
        // A backslash that ends a line stays as it is.
        (r"<table><tr><th>a\</th></tr></table>", r"a\"),
        (r"<table><tr><th><b>a\</b></th></tr></table>", "**a&#92;**"),
    ];
    for (html, text) in cases {
        let t = one(html, None);
        assert_eq!(t.table.cells[0].text, text, "{html}");
        let back = ltem::parse_table(&write(&t.table), 0).table.unwrap();
        assert_eq!(back.cells[0].text, text, "{html}");
    }
    assert_eq!(
        one(r"<table><tr><th><code>a\\b</code></th></tr></table>", None).warnings,
        [
            r"a code span with two backslashes in a row became plain text; LTEM 1.0 cell text cannot hold \\"
        ]
    );
    let options = FromHtmlOptions {
        inline: InlineFormat::Plain,
        ..FromHtmlOptions::default()
    };
    let t = from_html_with(
        r"<table><tr><th><code>x\</code>\y</th></tr></table>",
        &options,
    )
    .remove(0);
    assert_eq!(t.table.cells[0].text, r"x&#92;\y");
}

#[test]
fn model_with_two_backslashes_in_a_row_is_invalid() {
    let table = Table::new(
        1,
        1,
        1,
        vec![None],
        vec![ltem::Cell::new(0, 0, 1, 1, r"a\\b")],
    );
    assert_eq!(
        table.check(),
        ["cell (0,0) text has two backslashes in a row, which LTEM 1.0 reads as a line break"]
    );
    assert!(ltem::write(&table).is_err());
}
