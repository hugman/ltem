//! End to end: a real `mdbook build` of a book whose chapters are the specification's
//! examples, with this preprocessor.
//!
//! The test needs the `mdbook` command (0.5). It uses `$MDBOOK` if set, else
//! `target/mdbook/bin/mdbook` in the workspace, where
//! `cargo install mdbook --version 0.5.4 --no-default-features --root target/mdbook`
//! puts it. Without either it says so and passes.

#[path = "../../pulldown-cmark-ltem/tests/common/mod.rs"]
mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use common::{examples, normalize, Token};
use pulldown_cmark_ltem::pulldown_cmark::Options;

fn mdbook() -> Option<PathBuf> {
    let path = std::env::var_os("MDBOOK")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/mdbook/bin/mdbook")
        });
    path.exists().then_some(path)
}

/// The content of a chapter page: what mdBook puts in `<main>`.
fn main_content(page: &str) -> &str {
    let start = page.find("<main>").expect("<main>") + "<main>".len();
    let end = page.find("</main>").expect("</main>");
    &page[start..end]
}

/// Tokens without what mdBook adds to every page: the `<div class="table-wrapper">`
/// around tables, and the ids of headings and definition terms with their
/// `<a class="header">` links.
fn without_mdbook_decoration(tokens: Vec<Token>) -> Vec<Token> {
    let mut out = Vec::with_capacity(tokens.len());
    let mut skipped_ends: Vec<(String, bool)> = Vec::new();
    for token in tokens {
        match token {
            Token::Start(name, attrs) => {
                let class = attrs
                    .iter()
                    .find(|(k, _)| k == "class")
                    .and_then(|(_, v)| v.as_deref());
                let decoration = matches!(
                    (name.as_str(), class),
                    ("div", Some("table-wrapper")) | ("a", Some("header"))
                );
                if matches!(name.as_str(), "div" | "a") {
                    skipped_ends.push((name.clone(), decoration));
                }
                if decoration {
                    continue;
                }
                let anchored = matches!(
                    name.as_str(),
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "dt"
                );
                let attrs = attrs
                    .into_iter()
                    .filter(|(k, _)| !(anchored && k == "id"))
                    .collect();
                out.push(Token::Start(name, attrs));
            }
            Token::End(name) if matches!(name.as_str(), "div" | "a") => {
                let skip = skipped_ends
                    .iter()
                    .rposition(|(n, _)| *n == name)
                    .map(|i| skipped_ends.remove(i).1)
                    .unwrap_or(false);
                if !skip {
                    out.push(Token::End(name));
                }
            }
            token => out.push(token),
        }
    }
    out
}

/// The pulldown-cmark options of mdBook 0.5's HTML renderer with its defaults.
fn mdbook_defaults() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_HEADING_ATTRIBUTES
        | Options::ENABLE_SMART_PUNCTUATION
        | Options::ENABLE_DEFINITION_LIST
        | Options::ENABLE_GFM
}

#[test]
fn mdbook_builds_a_book_of_the_examples() {
    let Some(mdbook) = mdbook() else {
        eprintln!("skipped: no mdbook command (set MDBOOK or install mdbook into target/mdbook)");
        return;
    };
    let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join("mdbook-ltem-book");
    let _ = std::fs::remove_dir_all(&root);
    let src = root.join("src");
    std::fs::create_dir_all(src.join("sub")).unwrap();
    std::fs::write(
        root.join("book.toml"),
        format!(
            "[book]\ntitle = \"LTEM examples\"\n\n[preprocessor.ltem]\ncommand = {:?}\nafter = [\"links\"]\n",
            env!("CARGO_BIN_EXE_mdbook-ltem")
        ),
    )
    .unwrap();

    let examples = examples();
    let mut summary = String::from("# Summary\n\n- [Containers](containers.md)\n");
    for ex in &examples {
        summary.push_str(&format!("- [Example {0}](example-{0}.md)\n", ex.number));
        std::fs::write(src.join(format!("example-{}.md", ex.number)), &ex.ltem).unwrap();
    }
    std::fs::write(src.join("SUMMARY.md"), summary).unwrap();
    std::fs::write(
        src.join("containers.md"),
        "# Containers\n\n> - | Revenue {c:2} |\n>   |---|---|\n>   | [Example 1](example-1.md) | Q2 |\n\n\
         {{#include sub/part.md}}\n\n| Plain | GFM |\n|---|---|\n| 1 | 2 |\n",
    )
    .unwrap();
    std::fs::write(
        src.join("sub/part.md"),
        "| Included {r:2} | x |\n| y |\n|---|---|\n",
    )
    .unwrap();

    let out = Command::new(&mdbook)
        .arg("build")
        .arg(&root)
        .output()
        .expect("mdbook runs");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(out.status.success(), "{stderr}");

    for ex in &examples {
        let page =
            std::fs::read_to_string(root.join(format!("book/example-{}.html", ex.number))).unwrap();
        let got = without_mdbook_decoration(normalize(main_content(&page)));
        let mut want = String::new();
        pulldown_cmark_ltem::push_html(&mut want, &ex.ltem, mdbook_defaults());
        assert_eq!(got, normalize(&want), "example {}", ex.number);
    }

    // mdBook rewrites the .md link inside the LTEM cell, includes run before this
    // preprocessor, and a GFM table is mdBook's own.
    let page = std::fs::read_to_string(root.join("book/containers.html")).unwrap();
    let html = main_content(&page);
    assert!(html.contains("<th colspan=\"2\">Revenue</th>"), "{html}");
    assert!(
        html.contains("<a href=\"example-1.html\">Example 1</a>"),
        "{html}"
    );
    assert!(html.contains("<th rowspan=\"2\">Included</th>"), "{html}");
    assert!(html.contains("<th>Plain</th><th>GFM</th>"), "{html}");

    // Validation errors are reported through mdBook.
    let marker = examples
        .iter()
        .find(|e| e.ltem == "| A | B |\n|---|---|\n| << | 1 |\n")
        .expect("the V13 example");
    let warning = format!(
        "mdbook-ltem: warning: example-{}.md:3: V13 at (1,0): '<<' has no cell to extend",
        marker.number
    );
    assert!(stderr.contains(&warning), "{stderr}");
}
