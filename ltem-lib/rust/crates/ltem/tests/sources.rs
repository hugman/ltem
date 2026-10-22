//! Where cells are in the source: `ParseResult::sources` and `write_with_sources`.

mod common;

use common::{normalized, random_table, Rng};
use ltem::{CellSource, Table};

/// The model text of the cell whose source is `&line[start..end]`, read by parsing that
/// source as the only cell of a table.
fn text_at(line: &str, source: &CellSource) -> String {
    let piece = &line[source.start..source.end];
    let parsed = ltem::parse_table(format!("| {piece} |\n| --- |").as_str(), 0);
    parsed.table.expect("a one-cell table").cells[0]
        .text
        .clone()
}

/// The texts with the writer's CommonMark escapes (`\-`, `\:`, `\#`) removed.
fn normalized_texts(texts: Vec<String>) -> Vec<String> {
    let cells = texts
        .into_iter()
        .enumerate()
        .map(|(i, t)| ltem::Cell::new(0, i, 1, 1, t))
        .collect();
    let n = normalized(Table::new(1, 0, 1, Vec::new(), cells));
    n.cells.into_iter().map(|c| c.text).collect()
}

#[test]
fn parse_sources_compact_attribute_escape_and_padding() {
    let src = "intro\n| R {c:2} |\n| a   | \\| b |\n|---|---|\n| x | y |\n| z |";
    let r = ltem::parse_table(src, 0);
    let lines: Vec<&str> = src.split('\n').collect();
    let got: Vec<_> = r
        .sources
        .iter()
        .map(|s| {
            (
                s.row,
                s.col,
                s.rowspan,
                s.colspan,
                s.line,
                &lines[s.line][s.start..s.end],
            )
        })
        .collect();
    assert_eq!(
        got,
        [
            (0, 0, 1, 2, 1, "R {c:2}"),
            (1, 0, 1, 1, 2, "a"),
            (1, 1, 1, 1, 2, "\\| b"),
            (2, 0, 1, 1, 4, "x"),
            (2, 1, 1, 1, 4, "y"),
            (3, 0, 1, 1, 5, "z"),
            (3, 1, 1, 1, 5, ""),
        ]
    );
    let padded = r.sources.last().unwrap();
    assert_eq!((padded.start, padded.end), (lines[5].len(), lines[5].len()));
}

#[test]
fn find_tables_sources_use_document_lines() {
    let doc = "# Title\r\n\r\n| a | << |\r\n|---|---|\r\n| 1 | 2 |\r\n";
    let results = ltem::find_tables(doc);
    assert_eq!(results.len(), 1);
    let lines: Vec<&str> = doc.split("\r\n").collect();
    let got: Vec<_> = results[0]
        .sources
        .iter()
        .map(|s| (s.line, &lines[s.line][s.start..s.end]))
        .collect();
    assert_eq!(got, [(2, "a"), (4, "1"), (4, "2")]);
}

#[test]
fn offsets_are_utf8_bytes() {
    let src = "| 가나 | 😀 x |\n|---|---|\n|　y | \u{1F600}{c:1} |";
    let r = ltem::parse_table(src, 0);
    let lines: Vec<&str> = src.split('\n').collect();
    let got: Vec<&str> = r
        .sources
        .iter()
        .map(|s| &lines[s.line][s.start..s.end])
        .collect();
    assert_eq!(got, ["가나", "😀 x", "　y", "\u{1F600}{c:1}"]);
    assert_eq!((r.sources[0].start, r.sources[0].end), (2, 8));
}

#[test]
fn sources_serialize_as_objects() {
    let s = CellSource {
        row: 1,
        col: 2,
        rowspan: 1,
        colspan: 3,
        line: 4,
        start: 5,
        end: 6,
    };
    let json = serde_json::to_string(&s).unwrap();
    assert_eq!(
        json,
        r#"{"row":1,"col":2,"rowspan":1,"colspan":3,"line":4,"start":5,"end":6}"#
    );
    assert_eq!(serde_json::from_str::<CellSource>(&json).unwrap(), s);
}

#[test]
fn write_with_sources_on_random_tables() {
    let mut rng = Rng::new(11);
    for _ in 0..2000 {
        let rows = rng.randint(1, 7);
        let cols = rng.randint(1, 6);
        let header_rows = rng.randint(1, rows);
        let table = random_table(&mut rng, rows, cols, header_rows);
        let (text, sources) = ltem::write_with_sources(&table).unwrap();
        let lines: Vec<&str> = text.split('\n').collect();
        let spans: Vec<_> = sources
            .iter()
            .map(|s| (s.row, s.col, s.rowspan, s.colspan))
            .collect();
        let cells: Vec<_> = table
            .cells
            .iter()
            .map(|c| (c.row, c.col, c.rowspan, c.colspan))
            .collect();
        assert_eq!(spans, cells);
        let rebuilt = sources.iter().map(|s| text_at(lines[s.line], s)).collect();
        let expected: Vec<String> = table.cells.iter().map(|c| c.text.clone()).collect();
        assert_eq!(normalized_texts(rebuilt), expected, "{text}");
    }
}

#[test]
fn sources_of_parsed_random_documents_point_at_the_cells() {
    let mut rng = Rng::new(5);
    for _ in 0..1000 {
        let rows = rng.randint(1, 6);
        let cols = rng.randint(1, 5);
        let header_rows = rng.randint(1, rows);
        let table = random_table(&mut rng, rows, cols, header_rows);
        let doc = format!("Some text\n\n{}\n\nafter\n", ltem::write(&table).unwrap());
        let results = ltem::find_tables(&doc);
        assert_eq!(results.len(), 1);
        let lines: Vec<&str> = doc.split('\n').collect();
        let parsed = results[0].table.as_ref().unwrap();
        for (cell, s) in parsed.cells.iter().zip(&results[0].sources) {
            assert_eq!(text_at(lines[s.line], s), cell.text, "{doc}");
        }
    }
}
