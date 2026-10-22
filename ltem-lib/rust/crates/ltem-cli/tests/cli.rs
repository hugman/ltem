//! Smoke tests of the `ltem` command.

use std::io::Write;
use std::process::{Command, Output, Stdio};

const DOC: &str = "# Report

| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| **Asia** | 100   | 120 |

```
| not | a | table |
|-----|---|-------|
```

| A {c:2} |
|---|---|
| 1 | 2 |
";

fn ltem(args: &[&str], stdin: &str) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_ltem"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the ltem binary runs");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

fn stdout(out: &Output) -> String {
    String::from_utf8(out.stdout.clone()).unwrap()
}

#[test]
fn parse_prints_table_models() {
    let out = ltem(&["parse"], DOC);
    assert!(out.status.success());
    let json: serde_json::Value = serde_json::from_str(&stdout(&out)).unwrap();
    let tables = json["tables"].as_array().unwrap();
    assert_eq!(tables.len(), 2);
    assert_eq!(tables[0]["header_rows"], 2);
    assert_eq!(tables[1]["cells"][0]["colspan"], 2);
}

#[test]
fn render_prints_html_with_commonmark_inlines() {
    let out = ltem(&["render"], DOC);
    assert!(out.status.success());
    let html = stdout(&out);
    assert_eq!(html.matches("<table>").count(), 2);
    assert!(html.contains(r#"<th colspan="2">Revenue</th>"#));
    assert!(html.contains("<td><strong>Asia</strong></td>"));
}

#[test]
fn validate_reports_problems_and_exit_status() {
    let out = ltem(
        &["validate", "--json"],
        "| A | B |\n|---|---|\n| << | 1 |\n",
    );
    assert_eq!(out.status.code(), Some(1));
    let json: serde_json::Value = serde_json::from_str(&stdout(&out)).unwrap();
    assert_eq!(
        json,
        serde_json::json!({"errors": [{"rule": "V13", "row": 1, "col": 0, "severity": "error"}]})
    );

    // Warnings (V14) leave the table valid: exit status 0.
    let out = ltem(&["validate", "--json"], "| A | B |\n|---|---|\n| 1 |\n");
    assert_eq!(out.status.code(), Some(0));
    let json: serde_json::Value = serde_json::from_str(&stdout(&out)).unwrap();
    assert_eq!(
        json,
        serde_json::json!({"errors": [{"rule": "V14", "row": 1, "col": null, "severity": "warning"}]})
    );

    let out = ltem(&["validate"], "| A | B |\n|---|---|\n| << | 1 |\n");
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(
        stdout(&out),
        "table 1: V13 at (1,0): '<<' has no cell to extend\n"
    );

    let out = ltem(&["validate", "--json"], DOC);
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(stdout(&out), "{\n  \"errors\": []\n}\n");
}

#[test]
fn fmt_rewrites_tables_only() {
    let out = ltem(&["fmt"], DOC);
    assert!(out.status.success());
    let text = stdout(&out);
    assert!(text.starts_with(
        "# Report\n\n| Region | Revenue | << |\n| ^^ | Q1 | Q2 |\n| --- | --- | --- |"
    ));
    assert!(text.contains("| not | a | table |")); // code block untouched
    assert!(text.contains("| A | << |\n| --- | --- |\n| 1 | 2 |"));
    assert!(text.ends_with("| 1 | 2 |\n"));
}

#[test]
fn fmt_normalizes_newlines() {
    let out = ltem(&["fmt"], "| a {c:2} |\r\n|---|---|\r\n| 1 | 2 |\r\n");
    assert_eq!(stdout(&out), "| a | << |\n| --- | --- |\n| 1 | 2 |\n");
}

#[test]
fn from_html_converts_tables_and_warns() {
    let html = "<table><tr><td>A</td><td>B</td></tr><tr><td colspan=2>both</td></tr></table>";
    let out = ltem(&["from-html"], html);
    assert!(out.status.success());
    assert_eq!(stdout(&out), "| A | B |\n| --- | --- |\n| both | << |\n");
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("table 1: the HTML table has no header row")
    );

    let out = ltem(&["from-html", "--header-rows", "2"], html);
    assert_eq!(stdout(&out), "| A | B |\n| both | << |\n| --- | --- |\n");
    let out = ltem(&["from-html", "--header-rows=1"], html);
    assert!(out.status.success());
}

#[test]
fn reads_a_file_argument() {
    let path = std::env::temp_dir().join(format!("ltem-cli-test-{}.md", std::process::id()));
    std::fs::write(&path, DOC).unwrap();
    let out = ltem(&["parse", path.to_str().unwrap()], "");
    std::fs::remove_file(&path).ok();
    assert!(out.status.success());
    assert!(stdout(&out).contains("\"header_rows\": 2"));
}

#[test]
fn usage_errors_exit_with_status_2() {
    assert_eq!(ltem(&[], "").status.code(), Some(2));
    assert_eq!(ltem(&["frobnicate"], "").status.code(), Some(2));
    assert_eq!(ltem(&["parse", "--json"], "").status.code(), Some(2));
    assert_eq!(
        ltem(&["from-html", "--header-rows", "x"], "").status.code(),
        Some(2)
    );
    assert_eq!(
        ltem(&["parse", "/nonexistent/file.md"], "").status.code(),
        Some(2)
    );
    let help = ltem(&["--help"], "");
    assert!(help.status.success() && stdout(&help).starts_with("usage: ltem"));
}

#[test]
fn from_html_plain_and_headerless() {
    let html = "<table><tr><td><b>x</b> <a href=\"u\">l</a></td><td>y</td></tr></table>";
    let out = ltem(&["from-html", "--plain"], html);
    assert_eq!(stdout(&out), "| x l | y |\n| --- | --- |\n");
    let out = ltem(&["from-html", "--header-rows", "0"], html);
    assert_eq!(
        stdout(&out),
        "|  |  |\n| --- | --- |\n| **x** [l](u) | y |\n"
    );
    assert!(out.stderr.is_empty());
    let out = ltem(&["from-html", "--header-rows=-2"], html);
    assert_eq!(stdout(&out), "| **x** [l](u) | y |\n| --- | --- |\n");
}

const MODEL: &str = r#"{"version": "1.0", "rows": 2, "cols": 1, "header_rows": 1, "align": [null], "cells": [{"row": 0, "col": 0, "rowspan": 1, "colspan": 1, "text": "a | b"}, {"row": 1, "col": 0, "rowspan": 1, "colspan": 1, "text": "<<"}]}"#;

#[test]
fn write_prints_canonical_ltem() {
    let out = ltem(&["write"], MODEL);
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(stdout(&out), "| a \\| b |\n| --- |\n| \\<< |\n");
    let out = ltem(&["write"], &format!("{{\"tables\": [{MODEL}, {MODEL}]}}"));
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(stdout(&out).matches("| --- |").count(), 2);
    assert_eq!(ltem(&["write"], "not json").status.code(), Some(2));
    let invalid = MODEL.replace("\"rows\": 2", "\"rows\": 3");
    assert_eq!(ltem(&["write"], &invalid).status.code(), Some(1));
}

#[test]
fn fmt_keeps_the_indentation_of_a_table() {
    let out = ltem(&["fmt"], "- item\n\n  | a | b |\n  |-|-|\n  | 1 | 2 |\n");
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(
        stdout(&out),
        "- item\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n"
    );
}
