# ltem command (Go)

The `ltem` command: parse, render, validate and format LTEM (LLM-friendly Table-Enhanced Markdown) tables. It is built on the Go [`ltem`](../../ltem/) package, and renders cell text as CommonMark inlines with goldmark.

Status: version 0.1.0, for LTEM 1.0. Not yet published.

## Install

```
go install github.com/hugman/ltem/ltem-lib/go/cmd/ltem@latest
```

or, in this workspace, `go build -o ltem ./cmd/ltem`.

## Use

```
ltem parse    [FILE]           print the table model of every table as JSON
ltem render   [FILE]           print the HTML of every table
ltem validate [FILE] [--json]  print validation problems; exit status 1 if there are errors
ltem fmt      [FILE]           rewrite the input with every table in canonical form
ltem write    [FILE]           print the canonical LTEM of table models given as JSON
```

Input is read from FILE, or from standard input if FILE is missing or `-`. It must be UTF-8. Line endings `\r\n` and `\r` are read as `\n`.

- `parse` prints `{"tables": [...]}` with one [table model](../../../../ast/table-model.md) per table.
- `render` prints one `<table>` element per table. Cell text is rendered as CommonMark inlines, raw HTML included.
- `validate --json` prints `{"errors": [{"rule": ..., "row": ..., "col": ..., "severity": ...}]}`. Without `--json`, it prints one line per problem, such as `table 1: V13 at (1,0): '<<' has no cell to extend`. Warnings (V14) alone leave the exit status at 0.
- `fmt` keeps everything outside tables as it is. A table keeps the indentation of its first line, so a table in a list item stays there. It finds tables with the light scan of the core, which does not model block quotes.
- `write` reads one table model, or `{"tables": [...]}`, and prints the tables separated by blank lines.

`parse`, `render`, `validate --json` and `write` follow the command-line protocol of the [conformance tests](../../../../conformance/). From the repository root:

```
go -C ltem-lib/go build -o /tmp/ltem ./cmd/ltem
python3 conformance/tools/run.py --impl "/tmp/ltem"
```

Unlike the Python and Rust commands, this command has no `from-html`.

## Exit status

| Status | Meaning |
|---|---|
| 0 | success |
| 1 | `validate` found errors, or `write` got a table model that breaks the model rules |
| 2 | usage error, the input could not be read or is not UTF-8, or `write` got input that is not a table model |
