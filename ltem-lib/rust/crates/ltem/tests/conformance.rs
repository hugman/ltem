//! The conformance cases extracted from the specification (conformance/cases).

mod common;

use common::examples;
use serde_json::Value;

fn ltem_of(ex: &Value) -> &str {
    ex["ltem"].as_str().unwrap()
}

fn label(ex: &Value) -> String {
    format!(
        "example {} ({})",
        ex["example"],
        ex["section"].as_str().unwrap()
    )
}

#[test]
fn the_cases_are_loaded() {
    assert!(examples().len() >= 36);
}

#[test]
fn parse_gives_the_expected_models() {
    for ex in examples() {
        let got: Vec<Value> = ltem::find_tables(ltem_of(&ex))
            .iter()
            .map(|r| serde_json::to_value(r.table.as_ref().unwrap()).unwrap())
            .collect();
        assert_eq!(&Value::Array(got), &ex["tables"], "{}", label(&ex));
    }
}

#[test]
fn validate_gives_the_expected_problems() {
    for ex in examples() {
        let key = |rule: &str, row: u64, col: Option<u64>| {
            (rule.to_string(), row, col.map_or(-1, |c| c as i64))
        };
        let mut got: Vec<_> = ltem::find_tables(ltem_of(&ex))
            .iter()
            .flat_map(|r| r.problems.clone())
            .map(|p| key(&p.rule, p.row as u64, p.col.map(|c| c as u64)))
            .collect();
        let mut want: Vec<_> = ex["errors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                key(
                    e["rule"].as_str().unwrap(),
                    e["row"].as_u64().unwrap(),
                    e["col"].as_u64(),
                )
            })
            .collect();
        got.sort();
        want.sort();
        assert_eq!(got, want, "{}", label(&ex));
    }
}

#[test]
fn parsed_models_satisfy_the_model_rules() {
    for ex in examples() {
        for result in ltem::find_tables(ltem_of(&ex)) {
            assert_eq!(
                result.table.unwrap().check(),
                Vec::<String>::new(),
                "{}",
                label(&ex)
            );
        }
    }
}

/// The render cases assume CommonMark inline rendering inside cells.
#[cfg(feature = "commonmark-inline")]
#[test]
fn render_gives_the_expected_tables() {
    use common::{normalize, tables_only};
    for ex in examples() {
        let got: Vec<_> = ltem::find_tables(ltem_of(&ex))
            .iter()
            .map(|r| {
                normalize(&ltem::render_html(
                    r.table.as_ref().unwrap(),
                    Some(&ltem::commonmark_inline),
                ))
            })
            .collect();
        let want: Vec<_> = tables_only(ex["html"].as_str().unwrap())
            .into_iter()
            .map(normalize)
            .collect();
        assert_eq!(got, want, "{}", label(&ex));
    }
}
