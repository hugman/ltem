//! The preprocessor through its command line: the mdBook protocol, the specification's
//! examples rendered the way mdBook renders chapters, random documents, documents with
//! containers, and incomplete input.

#[path = "../../pulldown-cmark-ltem/tests/common/mod.rs"]
mod common;

use std::io::Write;
use std::process::{Command, Stdio};

use common::{
    drop_empty_tbody, examples, normalize, random_document, table_tokens, wrap, Rng, Token,
};
use pulldown_cmark_ltem::pulldown_cmark::{html, Options, Parser};
use serde_json::{json, Value};

const BIN: &str = env!("CARGO_BIN_EXE_mdbook-ltem");

struct Output {
    status: Option<i32>,
    stdout: String,
    stderr: String,
}

fn run(args: &[&str], input: &str) -> Output {
    let mut child = Command::new(BIN)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the preprocessor runs");
    // The preprocessor reads all of its input before it writes anything.
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    Output {
        status: out.status.code(),
        stdout: String::from_utf8(out.stdout).unwrap(),
        stderr: String::from_utf8(out.stderr).unwrap(),
    }
}

fn fixture(name: &str) -> String {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// The context of mdBook 0.5 with the given `[output.html]` table.
fn context(html: Value) -> Value {
    json!({
        "root": "/book",
        "config": {"book": {"title": "Test"}, "output": {"html": html}},
        "renderer": "html",
        "mdbook_version": "0.5.4"
    })
}

fn switches_off() -> Value {
    json!({"smart-punctuation": false, "definition-lists": false, "admonitions": false})
}

/// Run the preprocessor on a book of chapters; returns the chapters' Markdown after it
/// and what it wrote to standard error.
fn preprocess(context: &Value, chapters: &[String]) -> (Vec<String>, String) {
    let items: Vec<Value> = chapters
        .iter()
        .enumerate()
        .map(|(i, content)| {
            json!({"Chapter": {
                "name": format!("Chapter {i}"), "content": content, "number": [i + 1],
                "sub_items": [], "path": format!("ch{i}.md"), "source_path": format!("ch{i}.md"),
                "parent_names": []
            }})
        })
        .collect();
    let out = run(&[], &json!([context, {"items": items}]).to_string());
    assert_eq!(out.status, Some(0), "{}", out.stderr);
    let book: Value = serde_json::from_str(&out.stdout).expect("the book as JSON");
    let contents = book["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["Chapter"]["content"].as_str().unwrap().to_string())
        .collect();
    (contents, out.stderr)
}

/// The pulldown-cmark options of mdBook 0.5's HTML renderer (`mdbook-markdown`).
fn mdbook_options(smart: bool, definition_lists: bool, admonitions: bool) -> Options {
    let mut options = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_HEADING_ATTRIBUTES;
    options.set(Options::ENABLE_SMART_PUNCTUATION, smart);
    options.set(Options::ENABLE_DEFINITION_LIST, definition_lists);
    options.set(Options::ENABLE_GFM, admonitions);
    options
}

/// Render preprocessed Markdown as mdBook does: with plain pulldown-cmark.
fn render(markdown: &str, options: Options) -> String {
    let mut out = String::new();
    html::push_html(&mut out, Parser::new_ext(markdown, options));
    out
}

/// Tokens without the `<div class="table-wrapper">` around tables.
fn unwrap_tables(tokens: Vec<Token>) -> Vec<Token> {
    let wrapper = Token::Start(
        "div".to_string(),
        vec![("class".to_string(), Some("table-wrapper".to_string()))],
    );
    let mut out = Vec::with_capacity(tokens.len());
    let mut open = 0;
    for token in tokens {
        if token == wrapper {
            open += 1;
        } else if open > 0 && token == Token::End("div".to_string()) {
            open -= 1;
        } else {
            out.push(token);
        }
    }
    out
}

/// The tables of a document as the LTEM core renders them, with CommonMark cell text.
fn core_tables(markdown: &str) -> Vec<Vec<Token>> {
    ltem::find_tables(markdown)
        .iter()
        .map(|r| {
            normalize(&ltem::render_html(
                r.table.as_ref().unwrap(),
                Some(&ltem::commonmark_inline),
            ))
        })
        .collect()
}

// -- the protocol ----------------------------------------------------------------------------

#[test]
fn supports_the_html_renderer_only() {
    assert_eq!(run(&["supports", "html"], "").status, Some(0));
    for renderer in ["markdown", "epub", "linkcheck"] {
        assert_eq!(
            run(&["supports", renderer], "").status,
            Some(1),
            "{renderer}"
        );
    }
}

#[test]
fn command_line() {
    let version = run(&["--version"], "");
    assert_eq!(
        (version.status, version.stdout.as_str()),
        (Some(0), "mdbook-ltem 0.1.0\n")
    );
    let help = run(&["--help"], "");
    assert_eq!(help.status, Some(0));
    assert!(help.stdout.contains("supports RENDERER"));
    let bad = run(&["render"], "");
    assert_eq!(bad.status, Some(2));
    assert!(bad.stderr.contains("usage:"));
    let bad = run(&["supports"], "");
    assert_eq!(bad.status, Some(2));
}

#[test]
fn bad_input_fails_with_a_message() {
    for input in ["", "not json", "{}", "[{}]", "[{}, {}, {}]"] {
        let out = run(&[], input);
        assert_eq!(out.status, Some(1), "{input:?}");
        assert!(out.stderr.starts_with("mdbook-ltem: "), "{}", out.stderr);
        assert!(out.stdout.is_empty());
    }
}

#[test]
fn input_from_mdbook_0_5_4() {
    let input: Value = serde_json::from_str(&fixture("mdbook-0.5.4.json")).unwrap();
    let out = run(&[], &input.to_string());
    assert_eq!(out.status, Some(0), "{}", out.stderr);
    let book: Value = serde_json::from_str(&out.stdout).unwrap();
    let items = book["items"].as_array().unwrap();
    let intro = items[0]["Chapter"]["content"].as_str().unwrap();
    assert!(intro.starts_with("# Intro\n\n<!----><div class=\"table-wrapper\"><table><thead><tr><th rowspan=\"2\">Region</th>"));
    assert!(intro.ends_with("</table></div>\n"));
    // A GFM table without LTEM notation is left to mdBook.
    assert_eq!(
        items[1]["Chapter"]["content"],
        input[1]["items"][1]["Chapter"]["content"]
    );
    let sub = items[1]["Chapter"]["sub_items"][0]["Chapter"]["content"]
        .as_str()
        .unwrap();
    assert!(sub.starts_with("# Sub\n\n> <!----><div class=\"table-wrapper\"><table>"));
    // Everything else is kept as it was.
    assert_eq!(without_content(&book), without_content(&input[1]));
    assert_eq!(items[2], json!("Separator"));
    assert_eq!(items[3], json!({"PartTitle": "Part"}));
}

#[test]
fn input_from_mdbook_0_4() {
    let input: Value = serde_json::from_str(&fixture("mdbook-0.4.json")).unwrap();
    let out = run(&[], &input.to_string());
    assert_eq!(out.status, Some(0), "{}", out.stderr);
    let book: Value = serde_json::from_str(&out.stdout).unwrap();
    assert_eq!(without_content(&book), without_content(&input[1]));
    assert_eq!(book["__non_exhaustive"], Value::Null);
    let intro = book["sections"][0]["Chapter"]["content"].as_str().unwrap();
    // mdBook 0.4's `curly-quotes` turns on smart punctuation in cells too.
    assert!(
        intro.contains("<th colspan=\"2\">\u{201c}Region\u{201d}</th>"),
        "{intro}"
    );
    let sub = book["sections"][0]["Chapter"]["sub_items"][0]["Chapter"]["content"]
        .as_str()
        .unwrap();
    assert!(sub.starts_with(
        "- <!----><div class=\"table-wrapper\"><table><thead><tr><th colspan=\"2\">a</th>"
    ));
}

/// The book without the chapters' contents.
fn without_content(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(k, _)| k.as_str() != "content")
                .map(|(k, v)| (k.clone(), without_content(v)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(without_content).collect()),
        other => other.clone(),
    }
}

#[test]
fn validation_errors_are_reported_on_standard_error() {
    let chapters = [
        "Intro\n\n| A | B |\n|---|---|\n| << | 1 |\n".to_string(),
        "| a | b |\n|---|---|\n| 1 |\n".to_string(), // V14 only: a warning, not reported
    ];
    let (_, stderr) = preprocess(&context(json!({})), &chapters);
    assert_eq!(
        stderr,
        "mdbook-ltem: warning: ch0.md:5: V13 at (1,0): '<<' has no cell to extend\n"
    );
    let mut quiet = context(json!({}));
    quiet["config"]["preprocessor"] = json!({"ltem": {"warnings": false}});
    let (_, stderr) = preprocess(&quiet, &chapters);
    assert_eq!(stderr, "");
}

// -- the specification's examples ------------------------------------------------------------

/// Examples whose table is a GFM table without LTEM notation and without body rows: the
/// preprocessor leaves it to mdBook, which writes an empty `<tbody>`.
const EMPTY_TBODY: [u64; 2] = [11, 12];

/// Examples that mdBook's default smart punctuation changes: dashes in paragraph text,
/// a header cell `---` and a quote in a cell.
const SMART_PUNCTUATION: [u64; 8] = [4, 5, 8, 9, 10, 11, 12, 22];

/// Examples that mdBook's default definition lists change: `Total` above `:--`.
const DEFINITION_LISTS: [u64; 1] = [4];

#[test]
fn spec_examples_with_mdbooks_switches_off() {
    let examples = examples();
    assert_eq!(examples.len(), 46);
    let docs: Vec<String> = examples.iter().map(|e| e.ltem.clone()).collect();
    let (out, _) = preprocess(&context(switches_off()), &docs);
    for (ex, md) in examples.iter().zip(&out) {
        let got = unwrap_tables(normalize(&render(md, mdbook_options(false, false, false))));
        let want = normalize(&ex.html);
        if EMPTY_TBODY.contains(&ex.number) {
            assert_ne!(got, want, "example {} is listed as different", ex.number);
            assert_eq!(drop_empty_tbody(got), want, "example {}", ex.number);
        } else {
            assert_eq!(got, want, "example {}\n{md}", ex.number);
        }
    }
}

#[test]
fn spec_examples_with_mdbooks_defaults() {
    let examples = examples();
    let docs: Vec<String> = examples.iter().map(|e| e.ltem.clone()).collect();
    let (out, _) = preprocess(&context(json!({})), &docs);
    let defaults = mdbook_options(true, true, true);
    let mut changed = Vec::new();
    for (ex, md) in examples.iter().zip(&out) {
        let got = unwrap_tables(normalize(&render(md, defaults)));
        // The preprocessed chapter renders as the pulldown-cmark adapter renders the
        // original with the same options.
        let mut adapter = String::new();
        pulldown_cmark_ltem::push_html(&mut adapter, &ex.ltem, defaults);
        assert_eq!(got, normalize(&adapter), "example {}", ex.number);
        if drop_empty_tbody(got) != normalize(&ex.html) {
            changed.push(ex.number);
        }
    }
    let mut known: Vec<u64> = SMART_PUNCTUATION
        .iter()
        .chain(&DEFINITION_LISTS)
        .copied()
        .collect();
    known.sort();
    known.dedup();
    assert_eq!(changed, known);
}

#[test]
fn the_differences_come_from_the_switches_alone() {
    let examples = examples();
    let docs: Vec<String> = examples.iter().map(|e| e.ltem.clone()).collect();
    let only = |html: Value, options: Options| -> Vec<u64> {
        let (out, _) = preprocess(&context(html), &docs);
        examples
            .iter()
            .zip(&out)
            .filter(|(ex, md)| {
                drop_empty_tbody(unwrap_tables(normalize(&render(md, options))))
                    != normalize(&ex.html)
            })
            .map(|(ex, _)| ex.number)
            .collect()
    };
    let smart = json!({"smart-punctuation": true, "definition-lists": false, "admonitions": false});
    assert_eq!(
        only(smart, mdbook_options(true, false, false)),
        SMART_PUNCTUATION
    );
    let lists = json!({"smart-punctuation": false, "definition-lists": true, "admonitions": false});
    assert_eq!(
        only(lists, mdbook_options(false, true, false)),
        DEFINITION_LISTS
    );
    let notes = json!({"smart-punctuation": false, "definition-lists": false, "admonitions": true});
    assert_eq!(
        only(notes, mdbook_options(false, false, true)),
        Vec::<u64>::new()
    );
}

// -- random documents ---------------------------------------------------------------------------

const CASES: usize = 3000;

#[test]
fn random_documents_agree_with_the_core() {
    let mut rng = Rng::new(20261019);
    let wrappers = [
        ("", "", ""),
        ("> ", "> ", ">"),
        ("- ", "  ", ""),
        ("1. > ", "   > ", "   >"),
    ];
    let mut docs = Vec::with_capacity(CASES);
    let mut originals = Vec::with_capacity(CASES);
    for case in 0..CASES {
        let doc = random_document(&mut rng)
            .trim_start_matches(' ')
            .to_string();
        let (first, rest, blank) = wrappers[case % wrappers.len()];
        docs.push(wrap(&doc, first, rest, blank));
        originals.push(doc);
    }
    let (out, _) = preprocess(&context(switches_off()), &docs);
    for ((md, doc), original) in out.iter().zip(&docs).zip(&originals) {
        let html = render(md, mdbook_options(false, false, false));
        let got: Vec<Vec<Token>> = table_tokens(&html).into_iter().map(unwrap_tables).collect();
        assert_eq!(got, core_tables(original), "{doc:?}\n{md}");
    }
}

#[test]
fn chapters_without_ltem_notation_are_unchanged() {
    let mut rng = Rng::new(5);
    let cells = ["x", "**b**", "`a \\| b`", "", "[l](u)", "6.1\""];
    let docs: Vec<String> = (0..500)
        .map(|_| {
            let cols = rng.randint(1, 4);
            let row = |rng: &mut Rng| {
                let cells: Vec<&str> = (0..cols).map(|_| *rng.choice(&cells)).collect();
                format!("| {} |", cells.join(" | "))
            };
            let mut lines = vec![row(&mut rng), format!("|{}|", vec!["---"; cols].join("|"))];
            for _ in 0..rng.randint(0, 3) {
                lines.push(row(&mut rng));
            }
            format!(
                "# Title\n\nText with a | pipe.\n\n{}\n\n> {}\n",
                lines.join("\n"),
                lines.join("\n> ")
            )
        })
        .collect();
    let (out, stderr) = preprocess(&context(json!({})), &docs);
    assert_eq!(out, docs);
    assert_eq!(stderr, "");
}

// -- documents ------------------------------------------------------------------------------------

#[test]
fn tables_in_containers_and_next_to_other_blocks() {
    let chapter = "\
# Containers

> | Revenue {c:2} |
> |---|---|
> | Q1 | Q2 |

- First
- | A | << |
  | ^^ | B |
  |---|---|
  | `x \\| y` \\\\ *z* | [doc](other.md#part) |
- Last

```
| not {c:2} |
|---|---|
```

<div>
| raw {c:2} |
|---|---|
</div>

| \\<< | x \\{c:2} |
|:-:|--:|
| 1 | 2 |
2. Two
";
    let (out, _) = preprocess(&context(json!({})), &[chapter.to_string()]);
    let html = render(&out[0], mdbook_options(true, true, true));
    let tables = table_tokens(&html);
    assert_eq!(tables.len(), 3, "{html}");
    assert!(html.contains("<blockquote>\n<!----><div class=\"table-wrapper\"><table><thead><tr><th colspan=\"2\">Revenue</th>"), "{html}");
    assert!(html.contains("<li><!----><div class=\"table-wrapper\"><table><thead><tr><th colspan=\"2\" rowspan=\"2\">A</th>"), "{html}");
    assert!(
        html.contains(
            "<td><code>x | y</code><br /><em>z</em></td><td><a href=\"other.md#part\">doc</a></td>"
        ),
        "{html}"
    );
    assert!(
        html.contains("<li>Last</li>"),
        "the list stays tight: {html}"
    );
    assert!(html.contains("<pre><code>| not {c:2} |"));
    assert!(html.contains("<div>\n| raw {c:2} |"));
    assert!(html.contains("<th style=\"text-align: center\">&lt;&lt;</th><th style=\"text-align: right\">x {c:2}</th>"), "{html}");
    assert!(
        html.ends_with("</table></div>\n<ol start=\"2\">\n<li>Two</li>\n</ol>\n"),
        "{html}"
    );
}

#[test]
fn incomplete_chapters_never_fail() {
    let mut docs: Vec<String> = Vec::new();
    let sources: Vec<String> = examples()
        .into_iter()
        .map(|e| e.ltem)
        .chain(["> - | A {c:2} |\n>   |---|---|\n>   | x \\\\ y | z |\n> lazy\n".to_string()])
        .collect();
    for source in &sources {
        for (end, _) in source.char_indices().chain([(source.len(), ' ')]) {
            docs.push(source[..end].to_string());
        }
    }
    let (out, _) = preprocess(&context(json!({})), &docs);
    assert_eq!(out.len(), docs.len());
    for md in &out {
        let html = render(md, mdbook_options(true, true, true));
        assert_eq!(
            html.matches("<table>").count(),
            html.matches("</table>").count()
        );
    }
}

#[test]
fn a_lazy_line_after_a_table_is_read_after_the_container() {
    // A documented difference from pulldown-cmark-ltem, which keeps the line in the
    // block quote: the paragraph it continued lazily is now an HTML block.
    let chapter = "> | a {c:2} |\n> |---|---|\nlazy\n".to_string();
    let (out, _) = preprocess(&context(switches_off()), &[chapter]);
    let html = render(&out[0], mdbook_options(false, false, false));
    assert!(
        html.ends_with("</table></div>\n</blockquote>\n<p>lazy</p>\n"),
        "{html}"
    );
}
