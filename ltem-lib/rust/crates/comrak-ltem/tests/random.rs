//! Randomized differential tests: random LTEM documents rendered by the adapter and by
//! the LTEM core, at the top level and inside block quotes and list items, and random
//! GFM documents without LTEM notation, which must render exactly as comrak renders
//! them on its own.

#[path = "../../pulldown-cmark-ltem/tests/common/mod.rs"]
mod common;

use common::{normalize, random_document, table_tokens, wrap, Rng, Token};
use comrak::Options;

/// The tables of a document as the core renders them, with CommonMark cell text.
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

/// Containers to wrap a document in: the first line's prefix, the other lines' prefix,
/// and what a blank line becomes.
const WRAPPERS: [(&str, &str, &str); 10] = [
    ("> ", "> ", ">"),
    ("- ", "  ", ""),
    ("1. ", "   ", ""),
    ("10) ", "    ", ""),
    ("> > ", "> > ", "> >"),
    ("- > ", "  > ", "  >"),
    ("> 1. ", ">    ", ">"),
    ("* - ", "    ", ""),
    // A tab after the marker puts the content at column 4, which one tab reaches.
    ("-\t", "\t", ""),
    ("1.\t", "\t", ""),
];

const CASES: usize = 3000;

#[test]
fn top_level_tables_agree_with_the_core() {
    let mut rng = Rng::new(20261019);
    let options = Options::default();
    let mut tables = 0;
    for _ in 0..CASES {
        let doc = random_document(&mut rng);
        let html = comrak_ltem::markdown_to_html(&doc, &options);
        let want = core_tables(&doc);
        assert_eq!(table_tokens(&html), want, "{doc:?}");
        tables += want.len();
    }
    assert!(tables > CASES, "only {tables} tables");
}

#[test]
fn tables_in_containers_agree_with_the_core() {
    let mut rng = Rng::new(20261020);
    let mut options = Options::default();
    options.extension.tasklist = true;
    for case in 0..CASES {
        // Spaces before a list item's first line would move its content column.
        let doc = random_document(&mut rng)
            .trim_start_matches(' ')
            .to_string();
        let (first, rest, blank) = WRAPPERS[case % WRAPPERS.len()];
        let wrapped = wrap(&doc, first, rest, blank);
        let html = comrak_ltem::markdown_to_html(&wrapped, &options);
        assert_eq!(table_tokens(&html), core_tables(&doc), "{wrapped:?}");
    }
}

// -- GFM documents without LTEM notation ---------------------------------------------------

const PLAIN_CELLS: [&str; 14] = [
    "x",
    "Revenue",
    "100",
    "**b**",
    "*e*",
    "`code`",
    "`a \\| b`",
    "a \\| b",
    "[l](u)",
    "",
    "~~s~~",
    "6.1\"",
    "<b>x</b>",
    "\u{3000}y",
];

fn plain_row(rng: &mut Rng, n: usize) -> String {
    let cells: Vec<&str> = (0..n).map(|_| *rng.choice(&PLAIN_CELLS)).collect();
    // A line holding only a pipe ends a comrak table but is a row in LTEM (a documented
    // difference), so a row without a closing pipe ends in text.
    if rng.random() < 0.8 || cells.last() == Some(&"") {
        format!("| {} |", cells.join(" | "))
    } else {
        format!("| {}", cells.join(" | "))
    }
}

fn plain_table(rng: &mut Rng) -> String {
    let cols = rng.randint(1, 4);
    let header: Vec<&str> = (0..cols)
        .map(|_| *rng.choice(&["Item", "Q1", "**H**", "a", "Total"]))
        .collect();
    let delimiter: Vec<&str> = (0..cols)
        .map(|_| *rng.choice(&["---", ":--", "--:", ":-:", "-"]))
        .collect();
    let mut lines = vec![
        format!("| {} |", header.join(" | ")),
        format!("|{}|", delimiter.join("|")),
    ];
    for _ in 0..rng.randint(0, 4) {
        let n = (cols as isize + *rng.choice(&[0, 0, 0, -1, 1])).max(1) as usize;
        lines.push(plain_row(rng, n));
    }
    lines.join("\n")
}

fn gfm_document(rng: &mut Rng) -> String {
    let mut blocks = Vec::new();
    for _ in 0..rng.randint(1, 5) {
        let block = match rng.randint(0, 6) {
            0..=2 => plain_table(rng),
            3 => format!("Some *text* here\n{}", plain_table(rng)),
            4 => format!("{}\n# After", plain_table(rng)),
            5 => "A paragraph with a | pipe\nand more".to_string(),
            _ => "```\n| a |\n|---|\n```".to_string(),
        };
        blocks.push(block);
    }
    blocks.join("\n\n") + "\n"
}

#[test]
fn gfm_tables_render_exactly_as_comrak_renders_them() {
    let mut rng = Rng::new(42);
    let mut gfm = Options::default();
    gfm.extension.strikethrough = true;
    gfm.extension.autolink = true;
    gfm.extension.tasklist = true;
    gfm.render.r#unsafe = true;
    for case in 0..CASES {
        let mut doc = gfm_document(&mut rng);
        if case % 3 == 1 {
            doc = wrap(&doc, "> ", "> ", ">");
        } else if case % 3 == 2 {
            doc = wrap(&doc, "- ", "  ", "");
        }
        for options in [Options::default(), gfm.clone()] {
            let mut native = options.clone();
            native.extension.table = true;
            assert_eq!(
                comrak_ltem::markdown_to_html(&doc, &options),
                comrak::markdown_to_html(&doc, &native),
                "{doc:?}"
            );
        }
    }
}
