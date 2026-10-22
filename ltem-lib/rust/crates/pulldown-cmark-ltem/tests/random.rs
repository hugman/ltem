//! Randomized differential tests: random LTEM documents rendered by the adapter and by
//! the LTEM core, at the top level and inside block quotes and list items, and random
//! GFM documents without LTEM notation, which must render exactly as pulldown-cmark
//! renders them on its own.

mod common;

use common::{normalize, random_document, table_tokens, wrap, Rng, Token};
use pulldown_cmark::Options;
use pulldown_cmark_ltem::find_tables;

fn adapter_html(markdown: &str, options: Options) -> String {
    let mut html = String::new();
    pulldown_cmark_ltem::push_html(&mut html, markdown, options);
    html
}

/// The tables of a document as the core renders them, with CommonMark cell text.
fn core_tables(markdown: &str) -> Vec<Vec<Token>> {
    ltem::find_tables(markdown)
        .iter()
        .map(|r| {
            let html = ltem::render_html(r.table.as_ref().unwrap(), Some(&ltem::commonmark_inline));
            normalize(&html)
        })
        .collect()
}

/// The source of each cell of each table, as the core reports it.
fn core_cell_sources(markdown: &str) -> Vec<Vec<String>> {
    let lines: Vec<&str> = markdown.split('\n').collect();
    ltem::find_tables(markdown)
        .iter()
        .map(|r| {
            r.sources
                .iter()
                .map(|s| lines[s.line][s.start..s.end].to_string())
                .collect()
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
    let mut tables = 0;
    for _ in 0..CASES {
        let doc = random_document(&mut rng);
        let html = adapter_html(&doc, Options::empty());
        let want = core_tables(&doc);
        assert_eq!(table_tokens(&html), want, "{doc:?}");
        tables += want.len();

        let found = find_tables(&doc, Options::empty());
        let core = ltem::find_tables(&doc);
        assert_eq!(found.len(), core.len(), "{doc:?}");
        for (f, c) in found.iter().zip(&core) {
            assert_eq!(Some(&f.table), c.table.as_ref(), "{doc:?}");
            assert_eq!(f.problems, c.problems, "{doc:?}");
            assert_eq!((f.lines.start, f.lines.end), (c.start, c.end), "{doc:?}");
        }
        let sources: Vec<Vec<String>> = found
            .iter()
            .map(|t| t.cells.iter().map(|r| doc[r.clone()].to_string()).collect())
            .collect();
        assert_eq!(sources, core_cell_sources(&doc), "{doc:?}");
    }
    assert!(tables > CASES, "only {tables} tables");
}

#[test]
fn tables_in_containers_agree_with_the_core() {
    let mut rng = Rng::new(20261020);
    for case in 0..CASES {
        // Spaces before a list item's first line would move its content column.
        let doc = random_document(&mut rng)
            .trim_start_matches(' ')
            .to_string();
        let (first, rest, blank) = WRAPPERS[case % WRAPPERS.len()];
        let wrapped = wrap(&doc, first, rest, blank);
        let html = adapter_html(&wrapped, Options::empty());
        assert_eq!(table_tokens(&html), core_tables(&doc), "{wrapped:?}");

        let found = find_tables(&wrapped, Options::empty());
        let models: Vec<ltem::Table> = found.iter().map(|t| t.table.clone()).collect();
        let core: Vec<ltem::Table> = ltem::find_tables(&doc)
            .into_iter()
            .map(|r| r.table.unwrap())
            .collect();
        assert_eq!(models, core, "{wrapped:?}");
        let sources: Vec<Vec<String>> = found
            .iter()
            .map(|t| {
                t.cells
                    .iter()
                    .map(|r| wrapped[r.clone()].to_string())
                    .collect()
            })
            .collect();
        assert_eq!(sources, core_cell_sources(&doc), "{wrapped:?}");
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
    // A line holding only a pipe ends a pulldown-cmark table but is a row in LTEM (a
    // documented difference), so a row without a closing pipe ends in text.
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
fn gfm_tables_render_exactly_as_pulldown_cmark_renders_them() {
    let mut rng = Rng::new(42);
    let options = [
        Options::empty(),
        Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS | Options::ENABLE_GFM,
    ];
    for case in 0..CASES {
        let mut doc = gfm_document(&mut rng);
        if case % 3 == 1 {
            doc = wrap(&doc, "> ", "> ", ">");
        } else if case % 3 == 2 {
            doc = wrap(&doc, "- ", "  ", "");
        }
        for &opts in &options {
            let mut native = String::new();
            pulldown_cmark::html::push_html(
                &mut native,
                pulldown_cmark::Parser::new_ext(&doc, opts | Options::ENABLE_TABLES),
            );
            assert_eq!(adapter_html(&doc, opts), native, "{doc:?}");
        }
        assert!(
            find_tables(&doc, Options::empty()).iter().all(|t| t.native),
            "{doc:?}"
        );
    }
}
