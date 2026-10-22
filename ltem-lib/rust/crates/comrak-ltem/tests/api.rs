//! The public API: the AST that `parse_document` returns, `markdown_to_html`, source
//! positions, and how the AST works with comrak's formatters.

use comrak::nodes::{NodeValue, Sourcepos};
use comrak::{Arena, Options};

const DOC: &str = "Intro\n> | \u{e9} {c:2} |\n> |---|---|\n> | x | y\u{e9} |\n> 2. *two*\n";

fn sourcepos_options(chars: bool) -> Options<'static> {
    let mut options = Options::default();
    options.render.sourcepos = true;
    options.parse.sourcepos_chars = chars;
    options
}

#[test]
fn version() {
    assert_eq!(comrak_ltem::VERSION, "0.1.0");
}

#[test]
fn comrak_is_re_exported() {
    let options = comrak_ltem::comrak::Options::default();
    assert!(!options.extension.table);
}

#[test]
fn an_ltem_table_is_a_raw_node() {
    let arena = Arena::new();
    let root = comrak_ltem::parse_document(&arena, "| A {c:2} |\n|---|---|\n", &Options::default());
    let child = root.first_child().unwrap();
    assert!(child.next_sibling().is_none());
    let NodeValue::Raw(html) = &child.data().value else {
        panic!("{:?}", child.data().value);
    };
    assert_eq!(
        html,
        "<table>\n<thead>\n<tr>\n<th colspan=\"2\">A</th>\n</tr>\n</thead>\n</table>\n"
    );
    assert_eq!(child.data().sourcepos, Sourcepos::from((1, 1, 1, 11)));
}

#[test]
fn a_gfm_table_keeps_comraks_node_and_the_table_extension_is_on() {
    let arena = Arena::new();
    let options = Options::default();
    let root = comrak_ltem::parse_document(&arena, "| x | y |\n|:-|-:|\n| 1 | 2 |\n", &options);
    let table = root.first_child().unwrap();
    assert!(matches!(table.data().value, NodeValue::Table(_)));
    assert_eq!(table.children().count(), 2);
}

#[test]
fn markdown_to_html_is_format_html_of_parse_document() {
    for options in [Options::default(), sourcepos_options(false)] {
        let arena = Arena::new();
        let root = comrak_ltem::parse_document(&arena, DOC, &options);
        let mut html = String::new();
        comrak::format_html(root, &options, &mut html).unwrap();
        assert_eq!(html, comrak_ltem::markdown_to_html(DOC, &options));
    }
}

#[test]
fn the_ast_works_with_plugins() {
    let arena = Arena::new();
    let options = Options::default();
    let root = comrak_ltem::parse_document(&arena, DOC, &options);
    let mut html = String::new();
    comrak::format_html_with_plugins(
        root,
        &options,
        &mut html,
        &comrak::options::Plugins::default(),
    )
    .unwrap();
    assert_eq!(html, comrak_ltem::markdown_to_html(DOC, &options));
}

#[test]
fn source_positions_in_bytes() {
    let html = comrak_ltem::markdown_to_html(DOC, &sourcepos_options(false));
    for part in [
        "<table data-sourcepos=\"2:3-4:13\">",
        "<tr data-sourcepos=\"2:3-2:14\">",
        "<th data-sourcepos=\"2:5-2:12\" colspan=\"2\">\u{e9}</th>",
        "<td data-sourcepos=\"4:9-4:11\">y\u{e9}</td>",
        // Text parsed again keeps its place in the document.
        "<ol data-sourcepos=\"5:3-5:10\" start=\"2\">",
        "<em data-sourcepos=\"5:6-5:10\">two</em>",
    ] {
        assert!(html.contains(part), "{part}\n{html}");
    }
}

#[test]
fn source_positions_in_characters() {
    let html = comrak_ltem::markdown_to_html(DOC, &sourcepos_options(true));
    for part in [
        "<table data-sourcepos=\"2:3-4:12\">",
        "<th data-sourcepos=\"2:5-2:11\" colspan=\"2\">\u{e9}</th>",
        "<td data-sourcepos=\"4:9-4:10\">y\u{e9}</td>",
        "<ol data-sourcepos=\"5:3-5:10\" start=\"2\">",
    ] {
        assert!(html.contains(part), "{part}\n{html}");
    }
}

#[test]
fn a_paragraph_cut_before_a_table_keeps_its_positions() {
    let html = comrak_ltem::markdown_to_html(
        "Lead *in*\n| a {c:2} |\n|---|---|\n",
        &sourcepos_options(false),
    );
    assert!(html.starts_with("<p data-sourcepos=\"1:1-1:9\">Lead <em data-sourcepos=\"1:6-1:9\">in</em></p>\n<table data-sourcepos=\"2:1-2:11\">"), "{html}");
}

#[test]
fn the_table_html_follows_the_options_given_to_parse_document() {
    // The table is rendered when the document is parsed.
    let arena = Arena::new();
    let root = comrak_ltem::parse_document(
        &arena,
        "| <b>x</b> {c:2} |\n|---|---|\n",
        &Options::default(),
    );
    let mut unsafe_options = Options::default();
    unsafe_options.render.r#unsafe = true;
    let mut html = String::new();
    comrak::format_html(root, &unsafe_options, &mut html).unwrap();
    assert!(
        html.contains("<!-- raw HTML omitted -->x<!-- raw HTML omitted -->"),
        "{html}"
    );
}

#[test]
fn commonmark_output_holds_the_table_html() {
    // There is no round trip: comrak writes a raw node as it is.
    let arena = Arena::new();
    let options = Options::default();
    let root = comrak_ltem::parse_document(&arena, "| A {c:2} |\n|---|---|\n", &options);
    let mut markdown = String::new();
    comrak::format_commonmark(root, &options, &mut markdown).unwrap();
    assert!(markdown.starts_with("<table>\n<thead>"), "{markdown}");
}

#[test]
fn documents_without_tables_are_untouched() {
    let md = "# Title\n\nText with a | pipe.\n\n- a\n- b\n";
    let mut options = Options::default();
    options.extension.table = true;
    assert_eq!(
        comrak_ltem::markdown_to_html(md, &Options::default()),
        comrak::markdown_to_html(md, &options)
    );
}

#[test]
fn compact_html_has_no_line_feeds_in_tables() {
    let mut options = Options::default();
    options.render.compact_html = true;
    let html = comrak_ltem::markdown_to_html("| a \\\\ b {c:2} |\n|---|---|\n", &options);
    assert_eq!(
        html,
        "<table><thead><tr><th colspan=\"2\">a<br />b</th></tr></thead></table>"
    );
}
