//! The public API: the parser and its events, offsets, `find_tables` and `push_html`.

use pulldown_cmark::{Alignment, Event, Options, Tag, TagEnd};
use pulldown_cmark_ltem::{find_tables, push_html, OffsetIter, Parser, TableBlock};

const DOC: &str = "Intro\n\n> | A {c:2} |\n> | b | c |\n> |---|---|\n> | << | 1 |\n\n| x | y |\n|:-|-:|\n| 1 | 2 |\n";

#[test]
fn version() {
    assert_eq!(pulldown_cmark_ltem::VERSION, "0.1.0");
}

#[test]
fn pulldown_cmark_is_re_exported() {
    let options = pulldown_cmark_ltem::pulldown_cmark::Options::ENABLE_TABLES;
    assert_eq!(options, Options::ENABLE_TABLES);
}

#[test]
fn an_ltem_table_is_one_html_block() {
    let events: Vec<Event<'_>> = Parser::new("| A {c:2} |\n|---|---|\n").collect();
    assert_eq!(events.len(), 3);
    assert_eq!(events[0], Event::Start(Tag::HtmlBlock));
    let Event::Html(html) = &events[1] else {
        panic!("{:?}", events[1]);
    };
    assert_eq!(
        html.as_ref(),
        "<table><thead><tr><th colspan=\"2\">A</th></tr></thead></table>\n"
    );
    assert_eq!(events[2], Event::End(TagEnd::HtmlBlock));
}

#[test]
fn a_gfm_table_keeps_pulldown_cmarks_events() {
    let markdown = "| x | y |\n|:-|-:|\n| 1 | 2 |\n";
    let ours: Vec<Event<'_>> = Parser::new(markdown).collect();
    let theirs: Vec<Event<'_>> =
        pulldown_cmark::Parser::new_ext(markdown, Options::ENABLE_TABLES).collect();
    assert_eq!(ours, theirs);
    assert_eq!(
        ours[0],
        Event::Start(Tag::Table(vec![Alignment::Left, Alignment::Right]))
    );
}

#[test]
fn tables_are_always_enabled() {
    let a: Vec<Event<'_>> = Parser::new("| x |\n|---|\n").collect();
    let b: Vec<Event<'_>> = Parser::new_ext("| x |\n|---|\n", Options::ENABLE_TABLES).collect();
    assert_eq!(a, b);
    assert!(matches!(a[0], Event::Start(Tag::Table(_))));
}

#[test]
fn push_html_is_the_html_of_the_parser() {
    for options in [Options::empty(), Options::ENABLE_SMART_PUNCTUATION] {
        let mut a = String::from("before\n");
        push_html(&mut a, DOC, options);
        let mut b = String::from("before\n");
        pulldown_cmark::html::push_html(&mut b, Parser::new_ext(DOC, options));
        assert_eq!(a, b);
    }
}

#[test]
fn offsets() {
    let events: Vec<(Event<'_>, std::ops::Range<usize>)> =
        Parser::new(DOC).into_offset_iter().collect();
    let tables = find_tables(DOC, Options::empty());
    // The LTEM table's three events carry the table's range.
    let html: Vec<_> = events
        .iter()
        .filter(|(e, _)| {
            matches!(
                e,
                Event::Start(Tag::HtmlBlock) | Event::Html(_) | Event::End(TagEnd::HtmlBlock)
            )
        })
        .collect();
    assert_eq!(html.len(), 3);
    assert!(html.iter().all(|(_, r)| *r == tables[0].range));
    assert_eq!(
        &DOC[tables[0].range.clone()],
        "| A {c:2} |\n> | b | c |\n> |---|---|\n> | << | 1 |\n"
    );
    // Other events keep pulldown-cmark's ranges.
    let native: Vec<_> = pulldown_cmark::Parser::new_ext(DOC, Options::ENABLE_TABLES)
        .into_offset_iter()
        .collect();
    assert_eq!(events[..3], native[..3]); // the paragraph "Intro"
    assert_eq!(events[events.len() - 18..], native[native.len() - 18..]); // the GFM table
}

#[test]
fn offsets_of_text_parsed_again() {
    // "2. two" ends the table and is parsed again on its own; its events point into
    // the document.
    let doc = "> | A {c:2} |\n> |---|---|\n> 2. *two*\n";
    let events: Vec<_> = Parser::new(doc).into_offset_iter().collect();
    let list = events
        .iter()
        .find(|(e, _)| matches!(e, Event::Start(Tag::List(Some(2)))))
        .expect("an ordered list");
    assert!(doc[list.1.clone()].starts_with("2. *two*"));
    let text = events
        .iter()
        .find(|(e, _)| matches!(e, Event::Text(t) if t.as_ref() == "two"))
        .unwrap();
    assert_eq!(&doc[text.1.clone()], "two");
}

#[test]
fn offset_iter_and_parser_yield_the_same_events() {
    let a: Vec<Event<'_>> = Parser::new(DOC).collect();
    let iter: OffsetIter<'_> = Parser::new(DOC).into_offset_iter();
    let b: Vec<Event<'_>> = iter.map(|(e, _)| e).collect();
    assert_eq!(a, b);
}

#[test]
fn find_tables_describes_every_table() {
    let tables = find_tables(DOC, Options::empty());
    assert_eq!(tables.len(), 2);
    let [quoted, gfm] = [&tables[0], &tables[1]];

    assert_eq!(quoted.lines, 2..6);
    assert!(!quoted.native);
    assert_eq!(
        (
            quoted.table.rows,
            quoted.table.cols,
            quoted.table.header_rows
        ),
        (3, 2, 2)
    );
    let cells: Vec<&str> = quoted.cells.iter().map(|r| &DOC[r.clone()]).collect();
    assert_eq!(cells, ["A {c:2}", "b", "c", "<<", "1"]);
    let problems: Vec<(String, usize, Option<usize>)> = quoted
        .problems
        .iter()
        .map(|p| (p.rule.clone(), p.row, p.col))
        .collect();
    assert_eq!(problems, [("V13".to_string(), 2, Some(0))]);
    assert!(quoted.html.contains("<td>&lt;&lt;</td>"));

    assert_eq!(gfm.lines, 7..10);
    assert!(gfm.native);
    assert_eq!(&DOC[gfm.range.clone()], "| x | y |\n|:-|-:|\n| 1 | 2 |\n");
    assert_eq!(
        gfm.html,
        "<table><thead><tr><th style=\"text-align: left\">x</th><th style=\"text-align: right\">y</th></tr></thead><tbody>\n\
         <tr><td style=\"text-align: left\">1</td><td style=\"text-align: right\">2</td></tr>\n</tbody></table>\n"
    );
}

#[test]
fn find_tables_is_in_document_order_across_containers() {
    let doc = "| a {c:2} |\n|---|---|\n\n> | b {c:2} |\n> |---|---|\n\n- | c {c:2} |\n  |---|---|\n\n| d {c:2} |\n|---|---|\n";
    let texts: Vec<String> = find_tables(doc, Options::empty())
        .into_iter()
        .map(|t: TableBlock| t.table.cells[0].text.clone())
        .collect();
    assert_eq!(texts, ["a", "b", "c", "d"]);
}

#[test]
fn find_tables_padded_cell_positions() {
    let doc = "| a | b |\n|---|---|\n| 1 |\n";
    let table = &find_tables(doc, Options::empty())[0];
    let last = table.cells.last().unwrap();
    // A cell added to fill a short row is empty, at the end of its line.
    assert_eq!(last.start, last.end);
    assert_eq!(last.start, doc.len() - 1);
}

#[test]
fn html_of_find_tables_is_the_html_block() {
    let doc = "| A {c:2} |\n|---|---|\n| [x][r] \\\\ *y* | z |\n\n[r]: /u\n";
    let table = &find_tables(doc, Options::empty())[0];
    let html: Vec<String> = Parser::new(doc)
        .filter_map(|e| match e {
            Event::Html(h) => Some(h.to_string()),
            _ => None,
        })
        .collect();
    assert_eq!(html, std::slice::from_ref(&table.html));
    assert!(table
        .html
        .contains("<td><a href=\"/u\">x</a><br /><em>y</em></td>"));
    // Line feeds only come between tags.
    assert!(table.html.match_indices('\n').all(|(i, _)| {
        table.html[..i].ends_with('>')
            && (i + 1 == table.html.len() || table.html[i + 1..].starts_with('<'))
    }));
}

#[test]
fn parser_is_debug_and_reusable() {
    let parser = Parser::new("| a |\n|---|\n");
    assert!(format!("{parser:?}").contains("Parser"));
    assert_eq!(Parser::new("").count(), 0);
}
