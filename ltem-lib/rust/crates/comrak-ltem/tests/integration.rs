//! The adapter inside documents: containers, inline markup, escapes, alignment, other
//! blocks around tables, comrak's options, GFM tables without LTEM notation, and
//! incomplete input.

#[path = "../../pulldown-cmark-ltem/tests/common/mod.rs"]
mod common;

use common::{examples, normalize, table_tokens};
use comrak::Options;

fn render_with(markdown: &str, options: &Options) -> String {
    comrak_ltem::markdown_to_html(markdown, options)
}

fn render(markdown: &str) -> String {
    render_with(markdown, &Options::default())
}

/// comrak on its own, with tables.
fn native(markdown: &str, options: &Options) -> String {
    let mut options = options.clone();
    options.extension.table = true;
    comrak::markdown_to_html(markdown, &options)
}

const SPAN: &str = "| Revenue {c:2} |\n|---|---|\n| Q1 | Q2 |\n";
const SPAN_HTML: &str = "<table>\n<thead>\n<tr>\n<th colspan=\"2\">Revenue</th>\n</tr>\n</thead>\n\
                         <tbody>\n<tr>\n<td>Q1</td>\n<td>Q2</td>\n</tr>\n</tbody>\n</table>\n";

fn with(change: impl FnOnce(&mut Options)) -> Options<'static> {
    let mut options = Options::default();
    change(&mut options);
    options
}

// -- containers ----------------------------------------------------------------------------

#[test]
fn table_in_a_block_quote() {
    let quoted = common::wrap(SPAN, "> ", "> ", ">");
    assert_eq!(
        render(&quoted),
        format!("<blockquote>\n{SPAN_HTML}</blockquote>\n")
    );
    let md = "> >| Revenue {c:2} |\n>  > |---|---|\n> >   | Q1 | Q2 |\n";
    assert_eq!(
        render(md),
        format!("<blockquote>\n<blockquote>\n{SPAN_HTML}</blockquote>\n</blockquote>\n")
    );
}

#[test]
fn tabs_in_container_prefixes() {
    for md in [
        ">\t| Revenue {c:2} |\n>\t|---|---|\n>\t| Q1 | Q2 |\n",
        "> \t| Revenue {c:2} |\n> \t|---|---|\n> \t| Q1 | Q2 |\n",
    ] {
        assert_eq!(
            render(md),
            format!("<blockquote>\n{SPAN_HTML}</blockquote>\n"),
            "{md:?}"
        );
    }
    let md = "- a\n\n  \t| Revenue {c:2} |\n  \t|---|---|\n  \t| Q1 | Q2 |\n";
    assert!(render(md).contains(SPAN_HTML), "{}", render(md));
    // Two tabs leave six columns: indented code, not a table.
    assert!(render(">\t\t| a {c:2} |\n>\t\t|---|---|\n").contains("<pre><code>"));
}

#[test]
fn table_in_an_alert() {
    let md = "> [!NOTE]\n> | Revenue {c:2} |\n> |---|---|\n> | Q1 | Q2 |\n";
    let html = render_with(md, &with(|o| o.extension.alerts = true));
    assert!(
        html.starts_with("<div class=\"markdown-alert markdown-alert-note\">"),
        "{html}"
    );
    assert!(html.contains(SPAN_HTML), "{html}");
}

#[test]
fn a_lazy_line_is_not_part_of_a_table() {
    let md = "> | Revenue {c:2} |\n> |---|---|\n> | Q1 | Q2 |\nmore | x\n";
    assert_eq!(
        render(md),
        format!("<blockquote>\n{SPAN_HTML}<p>more | x</p>\n</blockquote>\n")
    );
}

#[test]
fn tables_in_list_items() {
    let tight = "- | Revenue {c:2} |\n  |---|---|\n  | Q1 | Q2 |\n- next\n";
    assert_eq!(
        render(tight),
        format!("<ul>\n<li>{SPAN_HTML}</li>\n<li>next</li>\n</ul>\n")
    );
    let nested = "- outer\n  1) | Revenue {c:2} |\n     |---|---|\n     | Q1 | Q2 |\n";
    assert!(render(nested).contains(&format!("<ol>\n<li>{SPAN_HTML}</li>")));
    let numbered = "10) | Revenue {c:2} |\n    |---|---|\n    | Q1 | Q2 |\n";
    assert_eq!(
        render(numbered),
        format!("<ol start=\"10\">\n<li>{SPAN_HTML}</li>\n</ol>\n")
    );
    let content = "-   | Revenue {c:2} |\n    |---|---|\n    | Q1 | Q2 |\n";
    assert_eq!(
        render(content),
        format!("<ul>\n<li>{SPAN_HTML}</li>\n</ul>\n")
    );
    // "10)" cannot interrupt a paragraph; the lines below it are indented as code.
    let text = "- outer\n  10) | Revenue {c:2} |\n      |---|---|\n";
    assert_eq!(render(text), native(text, &Options::default()));
}

#[test]
fn task_list_items() {
    let options = with(|o| o.extension.tasklist = true);
    // comrak reads the first line as a paragraph of a task item (its next line, not the
    // first, is the header row of a GFM table); LTEM reads both as header rows.
    let md = "- [ ] | A | << |\n  | b | c |\n  |---|---|\n  | 1 | 2 |\n- [x] done\n";
    let html = render_with(md, &options);
    assert!(
        html.starts_with("<ul>\n<li><input type=\"checkbox\" disabled=\"\" /> <table>\n<thead>\n<tr>\n<th colspan=\"2\">A</th>"),
        "{html}"
    );
    // Where comrak reads a GFM table on the first line, "[ ]" is its first cell.
    let md = "- [ ] | Revenue {c:2} |\n  |---|---|\n";
    assert!(render_with(md, &options).contains("<th>[ ]</th>\n<th>Revenue</th>"));
    // A task item's continuation lines follow its own marker's width.
    let md = "1.  [x] text\n    | Revenue {c:2} |\n    |---|---|\n    | Q1 | Q2 |\n";
    assert!(
        render_with(md, &options).contains(SPAN_HTML),
        "{}",
        render_with(md, &options)
    );
}

#[test]
fn unsupported_containers_are_left_to_comrak() {
    let footnote = "Text[^1]\n\n[^1]: | a {c:2} |\n    |---|---|\n    | 1 | 2 |\n";
    let options = with(|o| o.extension.footnotes = true);
    assert_eq!(render_with(footnote, &options), native(footnote, &options));
    let quote = ">>>\n| a {c:2} |\n|---|---|\n>>>\n";
    let options = with(|o| o.extension.multiline_block_quotes = true);
    assert_eq!(render_with(quote, &options), native(quote, &options));
    let details = "Term\n\n: | a {c:2} |\n  |---|---|\n";
    let options = with(|o| o.extension.description_lists = true);
    assert_eq!(render_with(details, &options), native(details, &options));
}

// -- inline markup, escapes, alignment and options -------------------------------------------

#[test]
fn inline_markup_in_cells() {
    let md = "| **Bold** {c:2} |\n|---|---|\n| `a \\| b` | [link](https://e.com \"T\") |\n";
    assert_eq!(
        render(md),
        "<table>\n<thead>\n<tr>\n<th colspan=\"2\"><strong>Bold</strong></th>\n</tr>\n</thead>\n<tbody>\n\
         <tr>\n<td><code>a | b</code></td>\n<td><a href=\"https://e.com\" title=\"T\">link</a></td>\n</tr>\n\
         </tbody>\n</table>\n"
    );
}

#[test]
fn reference_links_use_the_documents_definitions() {
    let md = "| [Docs][d] [Home] {c:2} |\n|---|---|\n2. [Docs][d]\n\n[d]: /docs \"D\"\n[home]: /\n";
    let html = render(md);
    assert!(
        html.contains(
            "<th colspan=\"2\"><a href=\"/docs\" title=\"D\">Docs</a> <a href=\"/\">Home</a></th>"
        ),
        "{html}"
    );
    // Text that is parsed again (a list that ends the table) sees them too.
    assert!(
        html.contains("<ol start=\"2\">\n<li><a href=\"/docs\" title=\"D\">Docs</a></li>"),
        "{html}"
    );
}

#[test]
fn front_matter_stays_first() {
    let md = "---\ntitle: x\n---\n\n| [a] {c:2} |\n|---|---|\n\n[a]: /a\n";
    let options = with(|o| o.extension.front_matter_delimiter = Some("---".to_string()));
    let html = render_with(md, &options);
    assert!(html.starts_with("<table>"), "{html}");
    assert!(
        html.contains("<th colspan=\"2\"><a href=\"/a\">a</a></th>"),
        "{html}"
    );
}

#[test]
fn each_line_of_a_cell_is_parsed_on_its_own() {
    let md = "| **a \\\\ b** | `c \\\\ d` | x \\ \\\\ y |\n|---|---|---|\n";
    let html = render(md);
    assert!(
        !html.contains("<strong>") && !html.contains("<code>"),
        "{html}"
    );
    assert!(html.contains("<th>x \\<br />\ny</th>"), "{html}");
}

#[test]
fn ltem_escapes() {
    let md = "| \\<< | \\^^ | x \\{c:2} | a \\| b |\n|---|---|---|---|\n";
    let html = render(md);
    assert!(
        html.contains("<th>&lt;&lt;</th>\n<th>^^</th>\n<th>x {c:2}</th>\n<th>a | b</th>"),
        "{html}"
    );
}

#[test]
fn alignment_is_written_as_comrak_writes_it() {
    let html = render("| a {c:2} | b |\n|:--|:-:|--:|\n");
    assert!(
        html.contains("<th colspan=\"2\" align=\"left\">a</th>\n<th align=\"right\">b</th>"),
        "{html}"
    );
}

#[test]
fn options_apply_to_cell_text() {
    let md = "| \"q\" ~~s~~ www.e.com ^up^ <b>raw</b> {c:2} |\n|---|---|\n";
    let options = with(|o| {
        o.parse.smart = true;
        o.extension.strikethrough = true;
        o.extension.autolink = true;
        o.extension.superscript = true;
    });
    let html = render_with(md, &options);
    assert!(
        html.contains("\u{201c}q\u{201d} <del>s</del> <a href=\"http://www.e.com\">www.e.com</a> <sup>up</sup> <!-- raw HTML omitted -->raw<!-- raw HTML omitted -->"),
        "{html}"
    );
    let unsafe_html = render_with(md, &with(|o| o.render.r#unsafe = true));
    assert!(unsafe_html.contains("<b>raw</b>"), "{unsafe_html}");
}

#[test]
fn footnote_references_in_ltem_cells_stay_text() {
    let options = with(|o| o.extension.footnotes = true);
    let md = "| a [^1] {c:2} |\n|---|---|\n\n[^1]: note\n";
    assert!(render_with(md, &options).contains("<th colspan=\"2\">a [^1]</th>"));
    let gfm = "| a [^1] |\n|---|\n\n[^1]: note\n";
    assert_eq!(render_with(gfm, &options), native(gfm, &options));
}

// -- documents -------------------------------------------------------------------------------

#[test]
fn several_tables_in_a_document() {
    let md = format!("# Report\n\n{SPAN}\nText.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n{SPAN}");
    let html = render(&md);
    assert_eq!(html.matches("<table>").count(), 3);
    assert_eq!(html.matches("colspan=\"2\"").count(), 2);
}

#[test]
fn text_before_a_table_stays_a_paragraph() {
    let md = "Quarterly *revenue*\n| Region {c:2} |\n|---|---|\n";
    assert!(render(md).starts_with("<p>Quarterly <em>revenue</em></p>\n<table>"));
    let md = "*Quarterly\n| Region* {c:2} |\n|---|---|\n";
    assert!(
        render(md).starts_with("<p>*Quarterly</p>\n<table>"),
        "{}",
        render(md)
    );
}

#[test]
fn a_line_that_begins_a_block_ends_the_table() {
    let md = "| a {c:2} |\n|---|---|\n| 1 | 2 |\n2. two\n3. three\n";
    assert!(
        render(md).ends_with("</table>\n<ol start=\"2\">\n<li>two</li>\n<li>three</li>\n</ol>\n")
    );
    let md = "| a {c:2} |\n|---|---|\n---\n";
    assert!(render(md).ends_with("</table>\n<hr />\n"), "{}", render(md));
    let md = "| a | b |\n|---|---|\n| 1 | 2 |\n    | 3 | 4 |\n";
    assert_eq!(render(md), native(md, &Options::default()));
}

#[test]
fn differences_from_comrak_for_tables_without_ltem_notation() {
    // A line holding only a pipe: a row in LTEM, the end of the table in comrak.
    let md = "| a |\n|---|\n|\n";
    assert!(render(md).contains("<td></td>"));
    assert!(native(md, &Options::default()).contains("<p>|</p>"));
    // A delimiter row without a pipe: no table in LTEM, a table in comrak.
    let md = "Total\n:--\n";
    assert_eq!(render(md), "<p>Total\n:--</p>\n");
    assert!(native(md, &Options::default()).contains("<table>"));
}

#[test]
fn tables_next_to_fenced_code_and_html_blocks() {
    let md = "```\n| a {c:2} |\n|---|---|\n```\n| a {c:2} |\n|---|---|\n<div>\n| b {c:2} |\n|---|---|\n</div>\n";
    let html = render_with(md, &with(|o| o.render.r#unsafe = true));
    assert!(html.starts_with("<pre><code>| a {c:2} |\n|---|---|\n</code></pre>\n<table>\n<thead>\n<tr>\n<th colspan=\"2\">a</th>"), "{html}");
    assert!(
        html.ends_with("</table>\n<div>\n| b {c:2} |\n|---|---|\n</div>\n"),
        "{html}"
    );
    let md = "    | a {c:2} |\n    |---|---|\n";
    assert_eq!(render(md), native(md, &Options::default()));
}

#[test]
fn setext_headings_and_tables() {
    assert_eq!(
        render("Revenue\n===\n|---|\n| 1 |\n"),
        "<h1>Revenue</h1>\n<p>|---|\n| 1 |</p>\n"
    );
}

#[test]
fn line_endings() {
    let lf = render(SPAN);
    assert_eq!(render(&SPAN.replace('\n', "\r\n")), lf);
    assert_eq!(render(&SPAN.replace('\n', "\r")), lf);
}

#[test]
fn gfm_tables_render_as_comrak_renders_them() {
    let samples = [
        "| a | b |\n|---|---|\n| 1 | 2 |\n",
        "| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |\n",
        "a | b\n--|--\n1 | 2\n",
        "| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n",
        "| `a\\|b` | **x** |\n|---|---|\n| [l](u) | \\| |\n",
        "| a |\n|---|\n",
        "text\n| a |\n|---|\n| 1 |\n",
        "| a |\n|---|\n| 1 |\n# h\n",
        "| a |\n|---|\n| 1 |\n> q\n",
        "| a |\n|---|\n| 1 |\n- item\n2. item\n",
        "| a |\n|---|\n| 1 |\n<div>\nx\n</div>\n",
        "| a | b |\n|---|---|\n| 1 | 2 |\nmore\n",
        "> | a | b |\n> |---|---|\n> | 1 | 2 |\n",
        "| a | b |\n|---|\n| 1 |\n",
        "Size | Price\n- | -\n",
        "| a |\n|-:-|\n",
        "| a |\n|\t---\t|\n",
        "| \u{3000}x | z |\n|---|---|\n| y | 1 |\n",
    ];
    let gfm = with(|o| {
        o.extension.strikethrough = true;
        o.extension.tasklist = true;
        o.extension.autolink = true;
        o.render.r#unsafe = true;
        o.render.sourcepos = true;
    });
    for options in [Options::default(), gfm] {
        for md in samples {
            assert_eq!(render_with(md, &options), native(md, &options), "{md:?}");
        }
    }
}

// -- incomplete input ------------------------------------------------------------------------

#[test]
fn incomplete_input_never_panics() {
    let mut docs: Vec<String> = examples().into_iter().map(|e| e.ltem).collect();
    docs.push(format!(
        "> - [ ] {SPAN}  more\n\n1. x\n   | a | << |\n   | ^^ | b |\n   |---|---|\n"
    ));
    docs.push(
        "*Quarterly\n| Region* {c:2} |\n|---|---|\n2. x\n    code\n| a |\n|---|\n|\n[r]: /u\n"
            .to_string(),
    );
    docs.push(
        ">\t| a {c:2} |\n>\t|---|---|\nlazy\n- | x |\n  |---|\n  | `c \\|` \\\\ y [r] é |\n"
            .to_string(),
    );
    let all = with(|o| {
        o.extension.strikethrough = true;
        o.extension.tasklist = true;
        o.extension.footnotes = true;
        o.extension.alerts = true;
        o.extension.description_lists = true;
        o.extension.multiline_block_quotes = true;
        o.extension.front_matter_delimiter = Some("---".to_string());
        o.render.sourcepos = true;
        o.parse.sourcepos_chars = true;
    });
    for doc in docs {
        for (end, _) in doc.char_indices().chain([(doc.len(), ' ')]) {
            let prefix = &doc[..end];
            for options in [Options::default(), all.clone()] {
                let html = render_with(prefix, &options);
                assert_eq!(
                    html.matches("<table").count(),
                    html.matches("</table>").count()
                );
            }
        }
    }
}

#[test]
fn a_table_arriving_line_by_line() {
    let doc = "Intro\n| Region | Revenue | <<  |\n| ^^     | Q1      | Q2  |\n|--------|---------|-----|\n| Asia   | 100     | 120 |\n";
    let lines: Vec<&str> = doc.split_inclusive('\n').collect();
    let tables: Vec<usize> = (1..=lines.len())
        .map(|n| table_tokens(&render(&lines[..n].concat())).len())
        .collect();
    assert_eq!(tables, [0, 0, 0, 1, 1]);
    assert!(render(&format!("{}| Eur", lines[..4].concat())).contains("<td>Eur</td>"));
    assert!(!render(&format!("{}|---", lines[..3].concat())).contains("<table>"));
    assert_eq!(
        normalize(&render(doc)),
        normalize(&render(&doc.replace('\n', "\r\n")))
    );
}

#[test]
fn long_documents_stay_fast() {
    let started = std::time::Instant::now();
    let paragraph: String = (0..20000).map(|i| format!("| line {i} |\n")).collect();
    assert!(!render(&paragraph).contains("<table>"));
    let table = format!(
        "| a | b {{c:2}} |\n|---|---|---|\n{}",
        "| x | y |\n".repeat(20000)
    );
    assert_eq!(render(&table).matches("<tr>").count(), 20001);
    let quoted = common::wrap(&table, "> ", "> ", ">");
    assert_eq!(render(&quoted).matches("<tr>").count(), 20001);
    let lazy = "> | a {c:2} |\n> |---|---|\nlazy\n".repeat(5000);
    assert_eq!(render(&lazy).matches("<table>").count(), 5000);
    let reparsed = "| a {c:2} |\n|---|---|\n2. x\n\n".repeat(2000);
    assert_eq!(render(&reparsed).matches("<table>").count(), 2000);
    assert!(
        started.elapsed().as_secs() < 30,
        "took {:?}",
        started.elapsed()
    );
}
