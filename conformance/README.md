# Conformance tests

The LTEM 1.0 conformance tests: language-neutral test data that every LTEM implementation must pass. They turn the specification into checks a machine can run, and they decide whether an implementation may call itself LTEM 1.0 compatible ([`../TRADEMARK.md`](../TRADEMARK.md)).

| File | Contents |
|---|---|
| [`cases/spec-examples.json`](cases/spec-examples.json) | The numbered examples from [`../spec/ltem-spec.md`](../spec/ltem-spec.md), with the expected table models and validation errors |
| [`cases/canonical.json`](cases/canonical.json) | Table models with the canonical LTEM a writer produces for them ([specification Section 8](../spec/ltem-spec.md#8-canonical-form)) |
| [`tools/spec_examples.py`](tools/spec_examples.py) | Extracts the examples from the specification and checks the data |
| [`tools/run.py`](tools/run.py) | Runs the cases against any implementation through its command line |

The expected HTML comes from the specification. The expected table models, validation errors and canonical text were reviewed by hand against the specification; they are not the output of one implementation.

Version 1.0 of the tests is frozen together with the specification. Later corrections raise the version (1.0.1 and so on).

## Format of a case

`cases/spec-examples.json` holds an object with the specification it was taken from and a list of `examples`. Each example has:

| Field | Contents |
|---|---|
| `example` | Example number in the specification |
| `section` | Section of the specification that contains the example |
| `ltem` | Input |
| `html` | Expected HTML for the whole input |
| `tables` | Expected table models, one per table in the input, in order (see [`../ast/`](../ast/)). Empty if the input contains no table. |
| `errors` | Expected validation errors. Each is an object with `rule`, `row` and `col`. |

`cases/canonical.json` holds a list of `cases`. Each case has a number (`case`), a `name`, the `section` of the specification it tests, a table model (`table`) and the expected canonical LTEM (`ltem`), without a final line break.

## What an implementation must pass

| Kind of software | Input | Expected output | How to compare |
|---|---|---|---|
| Renderer | `ltem` | `html` | After normalizing (see below). An implementation that renders tables only compares the `<table>` elements. |
| Parser | `ltem` | `tables` | As JSON values |
| Validator | `ltem` | `errors` | As a multiset of (`rule`, `row`, `col`): in any order, but a problem reported twice counts twice ([specification Section 5](../spec/ltem-spec.md#5-validation-rules)) |
| Writer of the canonical form | `table` | `ltem` | As text, ignoring line breaks at the end |

HTML is normalized before comparison:

- whitespace between tags is ignored, text is trimmed where it meets a tag, and runs of whitespace inside text count as one space (except inside `<pre>`). Only ASCII whitespace counts: other spaces, such as U+3000, are compared as content.
- character references are decoded, so `&quot;` and `"` compare equal
- attributes are compared as a set
- `style="text-align: X"` counts as `align="X"`
- `<br>` and `<br />` are the same

In `errors`, `row` and `col` give the grid position of the cell, placeholder or marker that broke the rule. For rule V14, which concerns a whole row, `col` is `null`.

## Running an implementation

An implementation provides one command that reads its input from standard input and supports these modes:

| Mode | Input | Output |
|---|---|---|
| `COMMAND parse` | LTEM | JSON `{"tables": [...]}`, one table model per table |
| `COMMAND render` | LTEM | The HTML of every table, one `<table>` element per table |
| `COMMAND validate --json` | LTEM | JSON `{"errors": [{"rule": ..., "row": ..., "col": ...}, ...]}`. Other keys, such as `severity`, are ignored. |
| `COMMAND write` | A table model as JSON | The table in canonical form |

`--only` selects modes, for example `--only parse,render,validate` for an implementation without a writer.

Then:

```
python3 conformance/tools/run.py --impl "COMMAND"
```

For example, `--impl ltem` runs the Python implementation. The `render` cases assume CommonMark inline rendering inside cells, as the specification's examples do. An implementation that renders cell text without it fails the examples that use inline Markdown; for the reference implementations, install the Python package with its `markdown` extra (`ltem-core[markdown]`); the Rust `ltem` command always includes it.

## Writing cases

Whole-document cases also depend on how the host renders the rest of the document. Avoid inputs where common hosts differ outside tables. For example, markdown-it-py removes an ideographic space (U+3000) at the edge of a paragraph, while markdown-it for JavaScript keeps it.

## Checking the data

```
python3 conformance/tools/spec_examples.py check
```

The check confirms three things:

- the cases file matches the examples in the specification
- every table model is valid against [`../ast/table.schema.json`](../ast/table.schema.json) and the rules in [`../ast/table-model.md`](../ast/table-model.md)
- the expected HTML shows the same rows, cells, spans and alignment as the table models

It needs only the Python standard library. Schema validation also runs if the `jsonschema` package is installed.

## Status

Version 1.0: the 46 examples of the specification, which include an example for every validation rule, and 12 canonical-form cases.

## License

The conformance tests and tools, including the examples taken from the specification, are under the MIT License ([`../LICENSE`](../LICENSE)). The specification itself is under CC BY-ND 4.0 ([`../spec/LICENSE`](../spec/LICENSE)).
