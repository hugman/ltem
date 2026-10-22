//! The specification's examples, rendered as whole documents through comrak with the
//! adapter, compared with the expected HTML after the conformance normalization.

#[path = "../../pulldown-cmark-ltem/tests/common/mod.rs"]
mod common;

use common::{examples, normalize};
use comrak::Options;

/// Options of a GitHub-like host. None of them changes the examples.
fn gfm() -> Options<'static> {
    let mut options = Options::default();
    options.extension.strikethrough = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    options.extension.footnotes = true;
    options.extension.alerts = true;
    options.render.r#unsafe = true;
    options
}

#[test]
fn there_are_46_examples() {
    assert_eq!(examples().len(), 46);
}

#[test]
fn every_example_renders_as_the_specification_says() {
    for options in [Options::default(), gfm()] {
        for ex in examples() {
            let got = comrak_ltem::markdown_to_html(&ex.ltem, &options);
            assert_eq!(
                normalize(&got),
                normalize(&ex.html),
                "example {} ({})\n{}",
                ex.number,
                ex.section,
                ex.ltem
            );
        }
    }
}

#[test]
fn parse_document_and_markdown_to_html_agree() {
    for ex in examples() {
        let arena = comrak::Arena::new();
        let options = Options::default();
        let root = comrak_ltem::parse_document(&arena, &ex.ltem, &options);
        let mut html = String::new();
        comrak::format_html(root, &options, &mut html).unwrap();
        assert_eq!(
            html,
            comrak_ltem::markdown_to_html(&ex.ltem, &options),
            "example {}",
            ex.number
        );
    }
}
