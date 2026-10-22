//! The table model, its JSON form, and finding tables in documents.

mod common;

use common::example_tables;
use ltem::{Align, Cell, Problem, Table};

const DOC: &str = "# Report

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
";

#[test]
fn json_has_the_schema_key_order() {
    let table = Table::new(
        1,
        1,
        1,
        vec![Some(Align::Right)],
        vec![Cell::new(0, 0, 1, 1, "x")],
    );
    assert_eq!(
        table.to_json(),
        r#"{"version":"1.0","rows":1,"cols":1,"header_rows":1,"align":["right"],"cells":[{"row":0,"col":0,"rowspan":1,"colspan":1,"text":"x"}]}"#
    );
}

#[test]
fn json_sorts_cells() {
    let table = Table::new(
        1,
        2,
        1,
        vec![None, None],
        vec![Cell::new(0, 1, 1, 1, "b"), Cell::new(0, 0, 1, 1, "a")],
    );
    assert!(table.to_json().contains(r#""cells":[{"row":0,"col":0"#));
}

#[test]
fn json_round_trips() {
    for table in example_tables() {
        assert_eq!(Table::from_json(&table.to_json_pretty()).unwrap(), table);
    }
}

#[test]
fn json_rejects_other_versions_and_fields() {
    let ok = r#"{"version":"1.0","rows":1,"cols":1,"header_rows":1,"align":[null],"cells":[]}"#;
    assert!(Table::from_json(ok).is_ok());
    assert!(Table::from_json(&ok.replace("1.0", "2.0"))
        .unwrap_err()
        .to_string()
        .contains("unsupported"));
    assert!(Table::from_json(&ok.replace(r#""cells""#, r#""extra":1,"cells""#)).is_err());
    assert!(Table::from_json(&ok.replace("[null]", r#"["middle"]"#)).is_err());
}

#[test]
fn check_reports_model_rule_violations() {
    let table = Table::new(
        2,
        2,
        1,
        vec![None],
        vec![
            Cell::new(0, 1, 2, 1, "a"),
            Cell::new(0, 0, 1, 1, "b"),
            Cell::new(1, 1, 1, 1, "c"),
            Cell::new(1, 1, 1, 5, "d"),
        ],
    );
    assert_eq!(
        table.check(),
        vec![
            "align has 1 entries, expected 2",
            "cells are not sorted by row and column",
            "header cell (0,1) reaches into the body",
            "position (1,1) belongs to two cells",
            "cell (1,1) lies outside the grid",
            "positions without a cell: [(1, 0)]",
        ]
    );
}

#[test]
fn problems_serialize_as_the_protocol_and_display_with_messages() {
    let p = Problem::new("V14", 2, None, "row has 4 cells");
    assert_eq!(
        serde_json::to_string(&p).unwrap(),
        r#"{"rule":"V14","row":2,"col":null}"#
    );
    assert_eq!(p.to_string(), "V14 at row 2: row has 4 cells");
    let result = ltem::parse_table("| A | B |\n|---|---|\n| << | 1 |", 0);
    assert_eq!(
        result.problems[0].to_string(),
        "V13 at (1,0): '<<' has no cell to extend"
    );
}

#[test]
fn find_tables_skips_code_blocks_and_reports_lines() {
    let results = ltem::find_tables(DOC);
    assert_eq!(results.len(), 2);
    let lines: Vec<&str> = DOC.split('\n').collect();
    assert!(lines[results[0].start].starts_with("| Region"));
    assert!(lines[results[1].start].starts_with("| A {c:2}"));
    assert_eq!(results[1].end, results[1].start + 3);
}

#[test]
fn find_tables_accepts_commonmark_line_endings() {
    for eol in ["\r\n", "\r"] {
        let doc = [
            "```", "| a |", "|---|", "```", "", "| b |", "|---|", "| 1 |", "",
        ]
        .join(eol);
        let results = ltem::find_tables(&doc);
        assert_eq!(results.len(), 1, "{eol:?}");
        let table = results[0].table.as_ref().unwrap();
        let texts: Vec<&str> = table.cells.iter().map(|c| c.text.as_str()).collect();
        assert_eq!(texts, ["b", "1"]);
        assert_eq!((results[0].start, results[0].end), (5, 8));
    }
}

#[test]
fn parse_table_accepts_text_or_lines() {
    let lines = ["Intro", "| a |", "|---|", "| 1 |", "- item"];
    let from_lines = ltem::parse_table(&lines, 10);
    let from_text = ltem::parse_table(lines.join("\n").as_str(), 10);
    assert_eq!(from_lines, from_text);
    assert_eq!((from_lines.start, from_lines.end), (11, 14));
    assert_eq!(from_lines.before, ["Intro"]);
    assert_eq!(from_lines.after, ["- item"]);
    let vec: Vec<String> = lines.iter().map(|s| s.to_string()).collect();
    assert_eq!(ltem::parse_table(&vec, 10), from_lines);
}

#[test]
fn no_table() {
    for text in ["", "no table here", "| a |\n| b |"] {
        assert!(ltem::find_tables(text).is_empty(), "{text:?}");
    }
    let result = ltem::parse_table("| a |\n| b |", 0);
    assert!(result.table.is_none());
    assert_eq!(result.before, ["| a |", "| b |"]);
}

#[test]
fn row_forms() {
    let result = ltem::parse_table(
        "| A {c:2} |\n|---|---|\n| 1 | 2 | 3 |\n| x {r:2} | y |\n| z |",
        0,
    );
    assert_eq!(
        result.forms,
        [
            ltem::RowForm::Compact,
            ltem::RowForm::Padded,
            ltem::RowForm::Grid,
            ltem::RowForm::Compact
        ]
    );
}

#[test]
fn plain_inline_is_the_default_renderer() {
    let table = ltem::parse_table("| **a** \\* |\n|---|", 0).table.unwrap();
    assert_eq!(
        ltem::render_html(&table, None),
        "<table>\n<thead>\n<tr>\n<th>**a** *</th>\n</tr>\n</thead>\n</table>"
    );
    let upper = |s: &str| s.to_uppercase();
    assert!(ltem::render_html(&table, Some(&upper)).contains("<th>**A** \\*</th>"));
}

#[test]
fn line_helpers() {
    assert!(ltem::is_delimiter_row("| --- | :-: |"));
    assert!(!ltem::is_delimiter_row("- | -"));
    assert!(ltem::is_upper_header_row("| a |"));
    assert!(!ltem::is_upper_header_row("| # id |"));
    assert!(ltem::starts_block("> quote"));
    assert!(ltem::ends_table_body(" \t"));
    assert!(!ltem::ends_table_body("\u{3000}"));
    assert_eq!(ltem::indentation(" \tx"), 4);
    assert_eq!(ltem::split_row("| a | b \\| c |"), ["a", "b | c"]);
}
