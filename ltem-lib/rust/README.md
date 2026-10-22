# ltem-lib/rust

The Rust workspace of LTEM (LLM-friendly Table-Enhanced Markdown). It holds the core library, the command-line tool, and adapters for pulldown-cmark, mdBook and comrak.

| Crate | Folder | What it is |
|---|---|---|
| [`ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/rust/crates/ltem) | `crates/ltem/` | The core library: parse, validate, render HTML, write canonical LTEM, convert HTML tables to LTEM |
| [`ltem-cli`](https://github.com/hugman/ltem/tree/main/ltem-lib/rust/crates/ltem-cli) | `crates/ltem-cli/` | The `ltem` command, which follows the [conformance](https://github.com/hugman/ltem/tree/main/conformance) command-line protocol |
| [`pulldown-cmark-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/rust/crates/pulldown-cmark-ltem) | `crates/pulldown-cmark-ltem/` | pulldown-cmark adapter: LTEM tables as HTML blocks, everything else from pulldown-cmark |
| [`mdbook-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/rust/crates/mdbook-ltem) | `crates/mdbook-ltem/` | mdBook preprocessor |
| [`comrak-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/rust/crates/comrak-ltem) | `crates/comrak-ltem/` | comrak adapter: LTEM tables in comrak's AST |

All crates are at version 0.1.0, for LTEM 1.0, and are not yet published to crates.io.

## Build and test

The crates use edition 2021 and are tested with Rust 1.99.

```
cargo build --release          # target/release/ltem
cargo test --workspace         # unit, conformance, writer, HTML, CLI and adapter tests
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```

Run the conformance cases against the command-line tool, from the repository root:

```
python3 conformance/tools/run.py --impl "ltem-lib/rust/target/release/ltem"
```

## Feature flag

The `ltem` crate has one optional feature, `commonmark-inline`. It adds `ltem::commonmark_inline`, which renders the text of a cell as CommonMark inlines with [pulldown-cmark](https://crates.io/crates/pulldown-cmark), for example `**x**` as `<strong>x</strong>`. Without it, `render_html` uses a plain renderer that only applies backslash escapes and HTML escaping. The command-line tool enables the feature, because the specification's rendering examples assume CommonMark inlines.

## Relation to the other implementations

The Rust core mirrors the Python implementation (`../python/ltem/`), which is the semantic reference, module by module: `syntax`, `grid`, `parser`, `model`, `html`, `writer` and `fromhtml`. Like the TypeScript implementation, it tries compact rows with an undo log instead of copying the grid. The three implementations give the same table models, problems, canonical output and HTML on randomized documents, and the HTML converter gives the same models and warnings as the Python one.

See [`crates/ltem/README.md`](https://github.com/hugman/ltem/blob/main/ltem-lib/rust/crates/ltem/README.md) for the API and for why the HTML converter has its own HTML tokenizer.
