# ltem-cli

The `ltem` command: parse, render, validate and format LTEM (LLM-friendly Table-Enhanced Markdown) tables, and convert HTML tables to LTEM. It is built on the [`ltem`](../ltem/) crate with CommonMark inline rendering enabled.

## Install

```
cargo install --path ltem-lib/rust/crates/ltem-cli
```

or build it in the workspace with `cargo build --release`; the binary is `target/release/ltem`.

## Use

```
ltem parse     [FILE]                     print the table model of every table as JSON
ltem render    [FILE]                     print the HTML of every table
ltem validate  [FILE] [--json]            print validation problems; exit status 1 if there are any
ltem fmt       [FILE]                     rewrite the input with every table in canonical form
ltem from-html [FILE] [--header-rows N] [--plain]   convert HTML tables to canonical LTEM
```

Input is read from FILE, or from standard input if FILE is missing or `-`. It must be UTF-8. Line endings `\r\n` and `\r` are read as `\n`.

- `parse` prints `{"tables": [...]}` with one [table model](../../../../ast/table-model.md) per table.
- `render` prints one `<table>` element per table. Cell text is rendered as CommonMark inlines.
- `validate --json` prints `{"errors": [{"rule": ..., "row": ..., "col": ...}]}`. Without `--json`, it prints one line per problem, such as `table 1: V13 at (1,0): '<<' has no cell to extend`.
- `fmt` keeps everything outside tables as it is.
- `from-html` prints the tables separated by blank lines and writes conversion warnings to standard error. `--header-rows` sets the number of header rows; by default it comes from `<thead>`, from leading rows of `<th>` cells, or is 1. `--header-rows 0` means the table has no header: it gets a header row of empty cells. `--plain` keeps the text of cells only, without Markdown emphasis, code, links or images.

`parse`, `render` and `validate --json` follow the command-line protocol of the [conformance tests](../../../../conformance/):

```
python3 conformance/tools/run.py --impl "ltem-lib/rust/target/release/ltem"
```

## Exit status

| Status | Meaning |
|---|---|
| 0 | success |
| 1 | `validate` found problems, or `from-html` produced a table that cannot be written |
| 2 | usage error, or the input could not be read |
