# ltem-lib/typescript

The TypeScript workspace for [LTEM](https://hugman.github.io/ltem/): Markdown pipe tables with merged cells and multi-row headers.

| Package | npm name | Contents |
|---|---|---|
| [`packages/ltem`](https://www.npmjs.com/package/ltem-core) | `ltem-core` | Core library and `ltem` command: parse, validate, render HTML, write canonical LTEM, convert HTML tables |
| [`packages/markdown-it-ltem`](https://www.npmjs.com/package/markdown-it-ltem) | `markdown-it-ltem` | markdown-it plugin (markdown-it 14 and 15) |
| [`packages/marked-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript/packages/marked-ltem) | `marked-ltem` | marked extension (marked 17 and 18) |
| [`packages/micromark-extension-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript/packages/micromark-extension-ltem) | `micromark-extension-ltem` | micromark syntax extension and HTML output |
| [`packages/mdast-util-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript/packages/mdast-util-ltem) | `mdast-util-ltem` | mdast utilities: from Markdown, to Markdown, and handlers for remark-rehype |
| [`packages/remark-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript/packages/remark-ltem) | `remark-ltem` | remark plugin (with or without remark-gfm) |
| [`packages/codemirror-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript/packages/codemirror-ltem) | `codemirror-ltem` | CodeMirror 6 table component: recognition, validation, table widgets and editing (version 0.2.x) |
| [`packages/codemirror-ltem-live`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript/packages/codemirror-ltem-live) | `codemirror-ltem-live` | CodeMirror 6 Markdown live preview built on `codemirror-ltem` (version 0.1.x) |

Status: for LTEM 1.0. `ltem-core` and `markdown-it-ltem` (version 0.1.1) are on npm; the other parser plugins (version 0.1.0) are not yet published. The API may change before version 1.0.0.

## Development

Requires Node.js 24 (LTS). The packages themselves run on Node.js 20 or later.

```
npm install        # install the workspace
npm run build      # compile every package to dist/ with tsc
npm test           # build, type-check the tests, and run them with node:test
npm run clean      # remove dist/
npm run pack       # build, then write every package as a tarball to dist-pack/
```

The tarballs install without a registry for `ltem-core` itself: `npm install ./ltem-core-0.1.0.tgz ./markdown-it-ltem-0.1.0.tgz markdown-it`. The plugins depend on the exact version of `ltem-core`.

The tests run the conformance cases in [`../../conformance/`](https://github.com/hugman/ltem/tree/main/conformance). To run the conformance runner against the command-line interface, from the repository root:

```
python3 conformance/tools/run.py --impl "node ltem-lib/typescript/packages/ltem/dist/cli.js"
```

`test-support/` holds code shared by the tests of the packages: the conformance cases, the HTML normalizer of the conformance runner, a small JSON Schema check for the table model, random valid tables, random documents (optionally inside block quotes and list items), and helpers for the unified packages.

`packages/ltem/tools/gen-tables.py` regenerates the HTML entity table and the Unicode character classes from Python 3.12, the version the reference implementation uses.
