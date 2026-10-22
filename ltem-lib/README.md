# ltem-lib

LTEM libraries, with one workspace per language. Each workspace holds that language's core library and its plugins for Markdown parsers.

All libraries are at version 0.1 and implement LTEM 1.0.

| Folder | Core | Plugins |
|---|---|---|
| [`rust/`](https://github.com/hugman/ltem/tree/main/ltem-lib/rust) | Core and CLI | pulldown-cmark adapter, mdBook preprocessor, comrak adapter |
| [`typescript/`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript) | Core and CLI | markdown-it, marked, remark (micromark and mdast utilities), CodeMirror 6 |
| [`python/`](https://github.com/hugman/ltem/tree/main/ltem-lib/python) | Core and CLI | markdown-it-py, Python-Markdown (and MkDocs) |
| [`go/`](https://github.com/hugman/ltem/tree/main/ltem-lib/go) | Core and CLI | goldmark (v1 and v2) |
| [`lua/`](https://github.com/hugman/ltem/tree/main/ltem-lib/lua) | Core and CLI | Pandoc readers and filter, Quarto extension |

The CodeMirror 6 packages have their own version numbers (see [`typescript/`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript)).

## What a core does

- parse LTEM into the table model ([`../ast/`](https://github.com/hugman/ltem/tree/main/ast))
- validate a table against the specification's rules
- write a table model back as canonical LTEM
- render HTML with real `colspan` and `rowspan`
- convert HTML tables to LTEM (the Rust, TypeScript and Python cores)

## What a plugin does

A plugin replaces the host parser's table rule. LTEM code handles the table structure: header rows, spans, the grid and the HTML table markup. The host parser handles the text inside each cell (emphasis, links, code and math), just as it does for GFM tables.

Every implementation must pass [`../conformance/`](https://github.com/hugman/ltem/tree/main/conformance).
