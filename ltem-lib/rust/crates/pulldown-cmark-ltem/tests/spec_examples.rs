//! The specification's examples, rendered as whole documents through pulldown-cmark
//! with the adapter, compared with the expected HTML after the conformance
//! normalization.

mod common;

use common::{drop_empty_tbody, examples, normalize};
use pulldown_cmark::Options;

fn render(markdown: &str, options: Options) -> String {
    let mut html = String::new();
    pulldown_cmark_ltem::push_html(&mut html, markdown, options);
    html
}

/// Examples whose table is a GFM table without LTEM notation and without body rows.
/// The adapter keeps pulldown-cmark's own rendering of such a table, and pulldown-cmark
/// writes an empty `<tbody>`, which the specification's HTML does not have.
const EMPTY_TBODY: [u64; 2] = [11, 12];

/// Options of a GitHub-like host. None of them changes the examples.
fn gfm() -> Options {
    Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_GFM
        | Options::ENABLE_HEADING_ATTRIBUTES
}

#[test]
fn there_are_46_examples() {
    assert_eq!(examples().len(), 46);
}

#[test]
fn every_example_renders_as_the_specification_says() {
    for ex in examples() {
        let got = normalize(&render(&ex.ltem, Options::empty()));
        let want = normalize(&ex.html);
        let label = format!("example {} ({})", ex.number, ex.section);
        if EMPTY_TBODY.contains(&ex.number) {
            assert_ne!(got, want, "{label} is listed as different");
            assert_eq!(drop_empty_tbody(got), want, "{label}");
        } else {
            assert_eq!(got, want, "{label}\n{}", ex.ltem);
        }
    }
}

#[test]
fn github_like_options_render_the_examples_the_same() {
    for ex in examples() {
        assert_eq!(
            render(&ex.ltem, gfm()),
            render(&ex.ltem, Options::empty()),
            "example {}",
            ex.number
        );
    }
}

#[test]
fn the_parser_and_push_html_agree() {
    for ex in examples() {
        let mut html = String::new();
        pulldown_cmark::html::push_html(&mut html, pulldown_cmark_ltem::Parser::new(&ex.ltem));
        assert_eq!(
            html,
            render(&ex.ltem, Options::empty()),
            "example {}",
            ex.number
        );
    }
}

#[test]
fn find_tables_finds_the_tables_of_the_examples() {
    for ex in examples() {
        let found = pulldown_cmark_ltem::find_tables(&ex.ltem, Options::empty());
        let core: Vec<ltem::Table> = ltem::find_tables(&ex.ltem)
            .into_iter()
            .map(|r| r.table.unwrap())
            .collect();
        let found: Vec<ltem::Table> = found.into_iter().map(|t| t.table).collect();
        assert_eq!(found, core, "example {}", ex.number);
    }
}
