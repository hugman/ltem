//! The adapter inside documents: containers, inline markup, escapes, alignment, other
//! blocks around tables, GFM tables without LTEM notation, and incomplete input.

mod common;

use common::{examples, normalize, table_tokens};
use pulldown_cmark::Options;

fn render_with(markdown: &str, options: Options) -> String {
    let mut html = String::new();
    pulldown_cmark_ltem::push_html(&mut html, markdown, options);
    html
}

fn render(markdown: &str) -> String {
    render_with(markdown, Options::empty())
}

/// pulldown-cmark on its own, with tables.
fn native(markdown: &str, options: Options) -> String {
    let mut html = String::new();
    pulldown_cmark::html::push_html(
        &mut html,
        pulldown_cmark::Parser::new_ext(markdown, options | Options::ENABLE_TABLES),
    );
    html
}

const SPAN: &str = "| Revenue {c:2} |\n|---|---|\n| Q1 | Q2 |\n";
const SPAN_HTML: &str = "<table><thead><tr><th colspan=\"2\">Revenue</th></tr></thead><tbody>\n\
                         <tr><td>Q1</td><td>Q2</td></tr>\n</tbody></table>\n";

// -- containers ----------------------------------------------------------------------------

#[test]
fn table_in_a_block_quote() {
    let quoted = common::wrap(SPAN, "> ", "> ", ">");
    assert_eq!(
        render(&quoted),
        format!("<blockquote>\n{SPAN_HTML}</blockquote>\n")
    );
}

#[test]
fn table_in_nested_block_quotes_with_odd_spacing() {
    let md = "> >| Revenue {c:2} |\n>  > |---|---|\n> >   | Q1 | Q2 |\n";
    assert_eq!(
        render(md),
        format!("<blockquote>\n<blockquote>\n{SPAN_HTML}</blockquote>\n</blockquote>\n")
    );
}

#[test]
fn a_tab_after_the_quote_marker() {
    // The marker takes one column of the tab; two columns of indentation remain.
    let md = ">\t| Revenue {c:2} |\n>\t|---|---|\n>\t| Q1 | Q2 |\n";
    assert_eq!(
        render(md),
        format!("<blockquote>\n{SPAN_HTML}</blockquote>\n")
    );
    // After "> ", a tab reaches column 4: two columns of indentation.
    let md = "> \t| Revenue {c:2} |\n> \t|---|---|\n> \t| Q1 | Q2 |\n";
    assert_eq!(
        render(md),
        format!("<blockquote>\n{SPAN_HTML}</blockquote>\n")
    );
    let md = "- a\n\n  \t| Revenue {c:2} |\n  \t|---|---|\n  \t| Q1 | Q2 |\n";
    assert!(render(md).contains(SPAN_HTML), "{}", render(md));
    // Two tabs leave six columns: indented code, not a table.
    let code = ">\t\t| a {c:2} |\n>\t\t|---|---|\n";
    assert!(render(code).contains("<pre><code>"));
}

#[test]
fn table_in_an_alert() {
    let md = "> [!NOTE]\n> | Revenue {c:2} |\n> |---|---|\n> | Q1 | Q2 |\n";
    assert_eq!(
        render_with(md, Options::ENABLE_GFM),
        format!("<blockquote class=\"markdown-alert-note\">\n{SPAN_HTML}</blockquote>\n")
    );
}

#[test]
fn a_lazy_line_is_not_part_of_a_table() {
    // "more | x" continues the quote's paragraph lazily; it cannot be a table row.
    let md = "> | Revenue {c:2} |\n> |---|---|\n> | Q1 | Q2 |\nmore | x\n";
    assert_eq!(
        render(md),
        format!("<blockquote>\n{SPAN_HTML}<p>more | x</p>\n</blockquote>\n")
    );
    // Nor can a lazy line be a header row.
    let md = "> text\n| a | << |\n> | b | c |\n> |---|---|\n";
    assert_eq!(
        table_tokens(&render(md)),
        table_tokens(&native(md, Options::empty()))
    );
}

#[test]
fn tables_in_list_items() {
    let tight = "- | Revenue {c:2} |\n  |---|---|\n  | Q1 | Q2 |\n- next\n";
    assert_eq!(
        render(tight),
        format!("<ul>\n<li>{SPAN_HTML}</li>\n<li>next</li>\n</ul>\n")
    );
    let loose = "1. intro\n\n   | Revenue {c:2} |\n   |---|---|\n   | Q1 | Q2 |\n\n2. next\n";
    assert_eq!(
        render(loose),
        format!("<ol>\n<li>\n<p>intro</p>\n{SPAN_HTML}</li>\n<li>\n<p>next</p>\n</li>\n</ol>\n")
    );
    let nested = "- outer\n  1) | Revenue {c:2} |\n     |---|---|\n     | Q1 | Q2 |\n";
    assert!(render(nested).contains(&format!("<ol>\n<li>{SPAN_HTML}</li>")));
    let numbered = "10) | Revenue {c:2} |\n    |---|---|\n    | Q1 | Q2 |\n";
    assert_eq!(
        render(numbered),
        format!("<ol start=\"10\">\n<li>{SPAN_HTML}</li>\n</ol>\n")
    );
    // "10)" cannot interrupt a paragraph, so it is text, and the lines below it are
    // indented by four columns in the item: no table.
    let text = "- outer\n  10) | Revenue {c:2} |\n      |---|---|\n";
    assert_eq!(render(text), native(text, Options::empty()));
    let in_quote = "> * | Revenue {c:2} |\n>   |---|---|\n>   | Q1 | Q2 |\n";
    assert_eq!(
        render(in_quote),
        format!("<blockquote>\n<ul>\n<li>{SPAN_HTML}</li>\n</ul>\n</blockquote>\n")
    );
}

#[test]
fn list_item_content_indentation() {
    // Content after "-   " starts four columns in; the table lines follow it.
    let md = "-   | Revenue {c:2} |\n    |---|---|\n    | Q1 | Q2 |\n";
    assert_eq!(render(md), format!("<ul>\n<li>{SPAN_HTML}</li>\n</ul>\n"));
    // A line indented less than the content is a lazy line, not a table line.
    let md = "-   | Revenue {c:2} |\n  |---|---|\n";
    assert!(!render(md).contains("<table>"));
}

#[test]
fn a_task_item_keeps_its_checkbox() {
    let md = "- [ ] | Revenue {c:2} |\n  |---|---|\n  | Q1 | Q2 |\n- [x] done\n";
    assert_eq!(
        render_with(md, Options::ENABLE_TASKLISTS),
        format!(
            "<ul>\n<li><input disabled=\"\" type=\"checkbox\"/>\n{SPAN_HTML}</li>\n\
             <li><input disabled=\"\" type=\"checkbox\" checked=\"\"/>\ndone</li>\n</ul>\n"
        )
    );
}

#[test]
fn text_after_a_table_in_a_tight_list_has_no_paragraph_tags() {
    let md = "- | x {c:2} |\n  |---|---|\n  2. two\n- b\n";
    assert_eq!(
        render(md),
        "<ul>\n<li><table><thead><tr><th colspan=\"2\">x</th></tr></thead></table>\n\
         <ol start=\"2\">\n<li>two</li>\n</ol>\n</li>\n<li>b</li>\n</ul>\n"
    );
}

#[test]
fn tables_in_footnote_definitions_are_left_to_pulldown_cmark() {
    let md = "Text[^1]\n\n[^1]: | a {c:2} |\n    |---|---|\n    | 1 | 2 |\n";
    let options = Options::ENABLE_FOOTNOTES;
    assert_eq!(render_with(md, options), native(md, options));
    assert!(pulldown_cmark_ltem::find_tables(md, options).is_empty());
}

// -- inline markup, escapes and alignment ---------------------------------------------------

#[test]
fn inline_markup_in_cells() {
    let md = "| **Bold** {c:2} |\n|---|---|\n| `a \\| b` | [link](https://e.com \"T\") |\n\
              | <b>raw</b> ![i](x.png) | &amp; <https://auto.com> |\n";
    assert_eq!(
        render(md),
        "<table><thead><tr><th colspan=\"2\"><strong>Bold</strong></th></tr></thead><tbody>\n\
         <tr><td><code>a | b</code></td><td><a href=\"https://e.com\" title=\"T\">link</a></td></tr>\n\
         <tr><td><b>raw</b> <img src=\"x.png\" alt=\"i\" /></td>\
         <td>&amp; <a href=\"https://auto.com\">https://auto.com</a></td></tr>\n</tbody></table>\n"
    );
}

#[test]
fn reference_links_in_cells_use_the_documents_definitions() {
    let md = "| [Docs][d] [Home] {c:2} |\n|---|---|\n\n[d]: /docs \"D\"\n[home]: /\n";
    assert_eq!(
        render(md),
        "<table><thead><tr><th colspan=\"2\"><a href=\"/docs\" title=\"D\">Docs</a> \
         <a href=\"/\">Home</a></th></tr></thead></table>\n"
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
    assert!(html.contains("<th>x \\<br />y</th>"), "{html}");
}

#[test]
fn ltem_escapes() {
    let md = "| \\<< | \\^^ | x \\{c:2} | a \\| b |\n|---|---|---|---|\n| << | ^^ | {c:2} | |\n";
    assert_eq!(
        render(md),
        "<table><thead><tr><th>&lt;&lt;</th><th>^^</th><th>x {c:2}</th><th>a | b</th></tr></thead><tbody>\n\
         <tr><td>&lt;&lt;</td><td>^^</td><td colspan=\"2\"></td></tr>\n</tbody></table>\n"
    );
}

#[test]
fn alignment_is_written_as_pulldown_cmark_writes_it() {
    let md = "| a {c:2} | b |\n|:--|:-:|--:|\n";
    assert_eq!(
        render(md),
        "<table><thead><tr><th colspan=\"2\" style=\"text-align: left\">a</th>\
         <th style=\"text-align: right\">b</th></tr></thead></table>\n"
    );
}

#[test]
fn options_apply_to_cell_text() {
    let md = "| \"q\" ~~s~~ $x$ {c:2} |\n|---|---|\n";
    let html = render_with(
        md,
        Options::ENABLE_SMART_PUNCTUATION | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_MATH,
    );
    assert!(
        html.contains("\u{201c}q\u{201d} <del>s</del> <span class=\"math math-inline\">x</span>"),
        "{html}"
    );
    assert!(
        render(md).contains("&quot;q&quot; ~~s~~ $x$") || render(md).contains("\"q\" ~~s~~ $x$")
    );
}

#[test]
fn footnote_references_in_ltem_cells_stay_text() {
    // A limitation: cell text is rendered on its own, without the footnote definitions.
    let md = "| a [^1] {c:2} |\n|---|---|\n\n[^1]: note\n";
    assert!(render_with(md, Options::ENABLE_FOOTNOTES).contains("<th colspan=\"2\">a [^1]</th>"));
    // In a GFM table without LTEM notation, pulldown-cmark renders the reference.
    let gfm = "| a [^1] |\n|---|\n\n[^1]: note\n";
    assert_eq!(
        render_with(gfm, Options::ENABLE_FOOTNOTES),
        native(gfm, Options::ENABLE_FOOTNOTES)
    );
}

// -- documents -------------------------------------------------------------------------------

#[test]
fn several_tables_in_a_document() {
    let md = format!("# Report\n\n{SPAN}\nText.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n{SPAN}");
    let html = render(&md);
    assert_eq!(html.matches("<table>").count(), 3);
    assert_eq!(html.matches("colspan=\"2\"").count(), 2);
    assert_eq!(
        pulldown_cmark_ltem::find_tables(&md, Options::empty()).len(),
        3
    );
}

#[test]
fn two_tables_in_one_paragraph_block() {
    // The second delimiter row starts a new table after the first one's body.
    let md = "| a {c:2} |\n|---|---|\n# h\n| b |\n| ^^ |\n|---|\n";
    let html = render(md);
    assert_eq!(table_tokens(&html).len(), 2);
    assert!(html.contains("<h1>h</h1>"));
    assert!(html.contains("<th rowspan=\"2\">b</th>"));
}

#[test]
fn text_before_a_table_stays_a_paragraph() {
    let md = "Quarterly *revenue*\n| Region {c:2} |\n|---|---|\n";
    assert_eq!(
        render(md),
        "<p>Quarterly <em>revenue</em></p>\n\
         <table><thead><tr><th colspan=\"2\">Region</th></tr></thead></table>\n"
    );
    // Emphasis cannot reach from the paragraph into the table: the paragraph is parsed
    // again on its own.
    let md = "*Quarterly\n| Region* {c:2} |\n|---|---|\n";
    assert!(render(md).starts_with("<p>*Quarterly</p>\n<table>"));
}

#[test]
fn a_line_that_begins_a_block_ends_the_table() {
    let md = "| a {c:2} |\n|---|---|\n| 1 | 2 |\n2. two\n3. three\n";
    assert!(
        render(md).ends_with("</table>\n<ol start=\"2\">\n<li>two</li>\n<li>three</li>\n</ol>\n")
    );
    let md = "| a {c:2} |\n|---|---|\n---\n";
    assert!(render(md).ends_with("</table>\n<hr />\n"));
    let md = "| Step | Action |\n|------|--------|\n| 1    | Mix    |\n- Stir well\n";
    assert!(render(md).ends_with("</table>\n<ul>\n<li>Stir well</li>\n</ul>\n"));
}

#[test]
fn an_indented_line_ends_the_table() {
    // LTEM ends a table at a line indented by four or more columns (spec 2.4);
    // pulldown-cmark on its own would make it a row.
    let md = "| a | b |\n|---|---|\n| 1 | 2 |\n    | 3 | 4 |\n";
    assert!(render(md).ends_with("</table>\n<pre><code>| 3 | 4 |\n</code></pre>\n"));
    assert!(native(md, Options::empty()).contains("<td>3</td>"));
}

#[test]
fn a_list_item_is_not_a_delimiter_row() {
    // A documented difference: pulldown-cmark on its own reads "- | -" as a delimiter
    // row; LTEM, like GFM, reads it as a list item (spec 2.2).
    let md = "Size | Price\n- | -\n";
    assert_eq!(
        render(md),
        "<p>Size | Price</p>\n<ul>\n<li>| -</li>\n</ul>\n"
    );
    assert!(native(md, Options::empty()).contains("<table>"));
}

#[test]
fn delimiter_cells_follow_gfm() {
    // pulldown-cmark on its own accepts "-:-" and rejects tabs; LTEM does the opposite.
    let md = "| a |\n|-:-|\n";
    assert_eq!(render(md), "<p>| a |\n|-:-|</p>\n");
    assert!(native(md, Options::empty()).contains("<table>"));
    let md = "| a |\n|\t---\t|\n";
    assert!(render(md).contains("<th>a</th>"));
    assert!(!native(md, Options::empty()).contains("<table>"));
}

#[test]
fn a_line_holding_only_a_pipe_is_a_row() {
    // A documented difference: pulldown-cmark on its own ends the table there.
    let md = "| a |\n|---|\n|\n";
    assert!(render(md).contains("<tr><td></td></tr>"));
    assert!(native(md, Options::empty()).contains("<p>|</p>"));
}

#[test]
fn tables_next_to_fenced_code_and_html_blocks() {
    let md = "```\n| a {c:2} |\n|---|---|\n```\n| a {c:2} |\n|---|---|\n<div>\n| b {c:2} |\n|---|---|\n</div>\n\n~~~\n| c |\n~~~\n";
    let html = render(md);
    assert_eq!(
        html,
        "<pre><code>| a {c:2} |\n|---|---|\n</code></pre>\n\
         <table><thead><tr><th colspan=\"2\">a</th></tr></thead></table>\n\
         <div>\n| b {c:2} |\n|---|---|\n</div>\n<pre><code>| c |\n</code></pre>\n"
    );
    let md = "<table><tr><td>\n| a {c:2} |\n|---|---|\n</td></tr></table>\n";
    assert_eq!(render(md), native(md, Options::empty()));
}

#[test]
fn indented_code_is_not_a_table() {
    let md = "    | a {c:2} |\n    |---|---|\n";
    assert_eq!(render(md), native(md, Options::empty()));
}

#[test]
fn setext_headings_and_tables() {
    // Spec 2.3: a setext underline above the delimiter row makes a heading.
    let md = "Revenue\n===\n|---|\n| 1 |\n";
    assert_eq!(render(md), "<h1>Revenue</h1>\n<p>|---|\n| 1 |</p>\n");
    // pulldown-cmark reads these lines as a setext heading, LTEM as a table and a
    // thematic break.
    let md = "| a {c:2} |\n|---|---|\n---\n";
    assert_eq!(
        render(md),
        "<table><thead><tr><th colspan=\"2\">a</th></tr></thead></table>\n<hr />\n"
    );
}

#[test]
fn line_endings() {
    let lf = render(SPAN);
    assert_eq!(render(&SPAN.replace('\n', "\r\n")), lf);
    assert_eq!(render(&SPAN.replace('\n', "\r")), lf);
}

#[test]
fn metadata_blocks_are_kept() {
    let md = format!("---\ntitle: x\n---\n{SPAN}");
    let options = Options::ENABLE_YAML_STYLE_METADATA_BLOCKS;
    assert_eq!(render_with(&md, options), SPAN_HTML);
}

// -- GFM tables without LTEM notation ----------------------------------------------------------

#[test]
fn gfm_tables_render_as_pulldown_cmark_renders_them() {
    let samples = [
        "| a | b |\n|---|---|\n| 1 | 2 |\n",
        "| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |\n",
        "a | b\n--|--\n1 | 2\n",
        "| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n",
        "| `a\\|b` | **x** |\n|---|---|\n| [l](u) | \\| |\n",
        "| a |\n|---|\n",
        "text\n| a |\n|---|\n| 1 |\n",
        "| a |\n|---|\n| 1 |\n\npara | x\n",
        "| a |\n|---|\n| 1 |\n# h\n",
        "| a |\n|---|\n| 1 |\n> q\n",
        "| a |\n|---|\n| 1 |\n```\ncode\n```\n",
        "| a |\n|---|\n| 1 |\n- item\n2. item\n",
        "| a |\n|---|\n| 1 |\n***\n",
        "| a |\n|---|\n| 1 |\n<div>\nx\n</div>\n",
        "| a | b |\n|---|---|\n| 1 | 2 |\nmore\n",
        "> | a | b |\n> |---|---|\n> | 1 | 2 |\n",
        "- | a | b |\n  |---|---|\n  | 1 | 2 |\n- next\n",
        "| a | b |\n|---|\n| 1 |\n",
        "| a |\n    |---|\n",
        "    | a |\n    |---|\n",
        "| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |\n",
        "| \u{3000}x | z |\n|---|---|\n| y | 1 |\n",
        "| a | b |\n| --- | --- |\n| 1 | 2 |\r\n",
    ];
    for options in [
        Options::empty(),
        Options::all() - Options::ENABLE_OLD_FOOTNOTES,
    ] {
        for md in samples {
            assert_eq!(render_with(md, options), native(md, options), "{md:?}");
        }
    }
}

// -- incomplete input ------------------------------------------------------------------------

/// Documents that exercise the containers and paths of the adapter.
fn stress_documents() -> Vec<String> {
    let mut docs: Vec<String> = examples().into_iter().map(|e| e.ltem).collect();
    docs.push(format!(
        "> - [ ] {SPAN}  more\n\n1. x\n   | a | << |\n   | ^^ | b |\n   |---|---|\n"
    ));
    docs.push(
        "*Quarterly\n| Region* {c:2} |\n|---|---|\n2. x\n    code\n| a |\n|---|\n|\n".to_string(),
    );
    docs.push(
        ">\t| a {c:2} |\n>\t|---|---|\nlazy\n- | x |\n  |---|\n  | `c \\|` \\\\ y |\n".to_string(),
    );
    docs
}

#[test]
fn incomplete_input_never_panics() {
    let options = [
        Options::empty(),
        Options::all() - Options::ENABLE_OLD_FOOTNOTES,
        Options::ENABLE_OLD_FOOTNOTES | Options::ENABLE_TASKLISTS,
    ];
    for doc in stress_documents() {
        for (end, _) in doc.char_indices().chain([(doc.len(), ' ')]) {
            let prefix = &doc[..end];
            for &opts in &options {
                let html = render_with(prefix, opts);
                let _ = pulldown_cmark_ltem::find_tables(prefix, opts);
                // Whatever arrived so far renders as balanced HTML.
                assert_eq!(
                    html.matches("<table>").count(),
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
    // No table until the delimiter row arrives, then one table.
    assert_eq!(tables, [0, 0, 0, 1, 1]);
    // A half-written last line is read as far as it goes.
    let partial = render(&format!("{}| Eur", lines[..4].concat()));
    assert!(partial.contains("<td>Eur</td>"), "{partial}");
    // A delimiter row that does not have all its columns yet starts no table.
    let partial = render(&format!("{}|---", lines[..3].concat()));
    assert!(!partial.contains("<table>"), "{partial}");
    let partial = render(&format!("{}|---|---|-", lines[..3].concat()));
    assert!(
        partial.contains("<th rowspan=\"2\">Region</th>"),
        "{partial}"
    );
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
    // Many tables in one paragraph of pulldown-cmark's, ended by lines that it reads as
    // paragraph text: an indented line, or a lazy line in a block quote.
    let indented = "| a {c:2} |\n|---|---|\n    x\n".repeat(5000);
    assert_eq!(render(&indented).matches("<table>").count(), 5000);
    let lazy = "> | a {c:2} |\n> |---|---|\nlazy\n".repeat(5000);
    assert_eq!(render(&lazy).matches("<table>").count(), 5000);
    assert!(
        started.elapsed().as_secs() < 20,
        "took {:?}",
        started.elapsed()
    );
}
