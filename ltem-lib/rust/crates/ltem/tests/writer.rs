//! The canonical writer: round trips and edge cases.

mod common;

use common::{example_tables, normalized, random_table, Rng};
use ltem::{Cell, RowForm, Table};

fn reparse(table: &Table) -> Table {
    let written = ltem::write(table).unwrap();
    let result = ltem::parse_table(written.as_str(), 0);
    assert_eq!(result.problems, vec![], "{written}");
    assert!(
        !result.forms.is_empty() && result.forms.iter().all(|&f| f == RowForm::Grid),
        "{written}"
    );
    result.table.unwrap()
}

#[test]
fn example_tables_round_trip() {
    let tables = example_tables();
    assert!(tables.len() >= 30);
    for table in tables {
        assert_eq!(normalized(reparse(&table)), table);
    }
}

#[test]
fn random_tables_round_trip() {
    let mut rng = Rng::new(20261002);
    for _ in 0..2000 {
        let rows = rng.randint(1, 7);
        let header_rows = rng.randint(1, rows);
        let cols = rng.randint(1, 6);
        let table = random_table(&mut rng, rows, cols, header_rows);
        assert_eq!(table.check(), Vec::<String>::new());
        assert_eq!(normalized(reparse(&table)), table);
    }
}

#[test]
fn write_is_idempotent() {
    let source = "| A {c:2} |\n|---|---|\n| 1 | 2 |";
    let once = ltem::write(&ltem::parse_table(source, 0).table.unwrap()).unwrap();
    let twice = ltem::write(&ltem::parse_table(once.as_str(), 0).table.unwrap()).unwrap();
    assert_eq!(once, "| A | << |\n| --- | --- |\n| 1 | 2 |");
    assert_eq!(twice, once);
}

#[test]
fn writer_escapes_only_where_needed() {
    let table = Table::new(
        2,
        2,
        1,
        vec![None, None],
        vec![
            Cell::new(0, 0, 1, 1, "-"),
            Cell::new(0, 1, 1, 1, "-"),
            Cell::new(1, 0, 1, 1, "<<"),
            Cell::new(1, 1, 1, 1, "x {c:2}"),
        ],
    );
    assert_eq!(
        ltem::write(&table).unwrap(),
        "| \\- | - |\n| --- | --- |\n| \\<< | x \\{c:2} |"
    );
}

#[test]
fn writer_escapes_pipes_and_line_breaks_and_alignment() {
    let table = Table::new(
        2,
        2,
        1,
        vec![Some(ltem::Align::Left), Some(ltem::Align::Center)],
        vec![
            Cell::new(0, 0, 1, 2, "a | b"),
            Cell::new(1, 0, 1, 1, "l1\nl2\n^^"),
            Cell::new(1, 1, 1, 1, ""),
        ],
    );
    assert_eq!(
        ltem::write(&table).unwrap(),
        "| a \\| b | << |\n| :--- | :---: |\n| l1 \\\\ l2 \\\\ \\^^ |  |"
    );
}

#[test]
fn writer_avoids_reserved_identifier_line() {
    let table = Table::new(
        2,
        1,
        1,
        vec![None],
        vec![
            Cell::new(0, 0, 1, 1, "# orders"),
            Cell::new(1, 0, 1, 1, "1"),
        ],
    );
    // The last header row is read as a header row even in this form, so it needs no escape.
    assert_eq!(ltem::write(&table).unwrap(), "| # orders |\n| --- |\n| 1 |");
    assert_eq!(reparse(&table), table);
    // A header row above the last one would end the header rows (spec Section 9).
    let table = Table::new(
        4,
        1,
        3,
        vec![None],
        vec![
            Cell::new(0, 0, 1, 1, "a"),
            Cell::new(1, 0, 1, 1, "# x"),
            Cell::new(2, 0, 1, 1, "b"),
            Cell::new(3, 0, 1, 1, "1"),
        ],
    );
    assert_eq!(
        ltem::write(&table).unwrap(),
        "| a |\n| \\# x |\n| b |\n| --- |\n| 1 |"
    );
    assert_eq!(normalized(reparse(&table)), table);
}

#[test]
fn writer_rejects_invalid_model() {
    let table = Table::new(1, 2, 1, vec![None, None], vec![Cell::new(0, 0, 1, 1, "a")]);
    let err = ltem::write(&table).unwrap_err();
    assert_eq!(
        err.to_string(),
        "invalid table model: positions without a cell: [(0, 1)]"
    );
}
