---
title: Libraries
outline: [2, 3]
---

# Libraries

LTEM comes with libraries in five languages: Python, TypeScript, Rust, Go and Lua. Each language has a core, and plugins connect LTEM to the Markdown parsers people already use. All libraries are at version 0.1, implement LTEM 1.0 and pass the [conformance tests](https://github.com/hugman/ltem/tree/main/conformance); the CodeMirror packages have their own version numbers.

A **core** parses LTEM into the [table model](https://github.com/hugman/ltem/tree/main/ast), validates a table against the specification's rules, renders HTML with real `colspan` and `rowspan`, and writes a table back as canonical LTEM. The Rust, TypeScript and Python cores also convert HTML tables to LTEM. A **plugin** replaces the host parser's table rule: LTEM handles the table structure, and the host parser still handles the text inside each cell, such as emphasis, links, code and math.

<div class="lt-lib-table">

| Language                | Package                                              | What it is                                    |
|-------------------------|------------------------------------------------------|-----------------------------------------------|
| JavaScript / TypeScript | [`ltem-core`](#js-ltem-core)                         | Core and `ltem` command                       |
| ^^                      | [`markdown-it-ltem`](#js-markdown-it-ltem)           | markdown-it plugin, also for VitePress        |
| ^^                      | [`marked-ltem`](#js-marked-ltem)                     | marked extension · *coming soon* |
| ^^                      | [`remark-ltem`](#js-remark-ltem)                     | remark and unified plugin · *coming soon* |
| ^^                      | [`codemirror-ltem`](#js-codemirror-ltem)             | CodeMirror 6 table editing and live preview · *coming soon* |
| Python                  | [`ltem-core`](#py-ltem-core)                         | Core and `ltem` command, the reference        |
| ^^                      | [`mdit-py-ltem`](#py-mdit-py-ltem)                   | markdown-it-py plugin · *coming soon* |
| ^^                      | [`markdown-ltem`](#py-markdown-ltem)                 | Python-Markdown extension, also for MkDocs · *coming soon* |
| Rust                    | [`ltem`](#rs-ltem)                                   | Core crate · *coming soon* |
| ^^                      | [`ltem-cli`](#rs-ltem-cli)                           | The `ltem` command · *coming soon* |
| ^^                      | [`pulldown-cmark-ltem`](#rs-pulldown-cmark-ltem)     | pulldown-cmark adapter · *coming soon* |
| ^^                      | [`mdbook-ltem`](#rs-mdbook-ltem)                     | mdBook preprocessor · *coming soon* |
| ^^                      | [`comrak-ltem`](#rs-comrak-ltem)                     | comrak adapter · *coming soon* |
| Go                      | [`ltem`](#go-ltem)                                   | Core package and `ltem` command               |
| ^^                      | [`goldmarkltem`](#go-goldmarkltem)                   | goldmark extension                            |
| Lua                     | [`ltem.lua`](#lua-ltem-lua)                          | Core in pure Lua 5.4                          |
| ^^                      | [Pandoc readers and filter](#lua-pandoc-readers-and-filter) | Pandoc                                 |
| ^^                      | [Quarto extension](#lua-quarto-extension)            | Quarto                                        |

</div>

## JavaScript / TypeScript

### ltem-core {#js-ltem-core}

The TypeScript core, with the `ltem` command. It has no dependencies; add markdown-it to render inline Markdown in cells.

<Pkg g="js" n="ltem-core" />

```ts
import { parseTable, renderHtml, write } from "ltem-core";

const result = parseTable(`\
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |`);

const table = result.table!;   // the table model (see ast/ in the LTEM repository)
JSON.stringify(table);         // the model as JSON, valid against ast/table.schema.json
renderHtml(table);             // <table> with colspan and rowspan
write(table);                  // canonical LTEM
result.problems;               // validation problems, if any
```

### markdown-it-ltem {#js-markdown-it-ltem}

A plugin for markdown-it 14 and 15. It replaces markdown-it's table rule; a table without LTEM notation renders as before.

<Pkg g="js" n="markdown-it-ltem" />

```js
import markdownit from "markdown-it";
import ltem from "markdown-it-ltem";

const md = markdownit().use(ltem);
md.render(text);
```

VitePress renders Markdown with markdown-it. This site is built this way:

```ts
// .vitepress/config.mts
import { defineConfig } from 'vitepress'
import ltem from 'markdown-it-ltem'

export default defineConfig({
  markdown: {
    config(md) {
      md.use(ltem)
    },
  },
})
```

### marked-ltem {#js-marked-ltem}

An extension for marked 17 and 18. It needs no DOM, so it also runs in browsers through a bundler.

<Pkg g="js" n="marked-ltem" />

```js
import { marked } from "marked";
import markedLtem from "marked-ltem";

marked.use(markedLtem());
marked.parse(text);
```

### remark-ltem {#js-remark-ltem}

A remark plugin, with or without remark-gfm. Pass `ltemHandlers` to remark-rehype, or the merged cells are lost on the way to HTML. Underneath are `micromark-extension-ltem`, the syntax extension, and `mdast-util-ltem`, the mdast utilities, which the rest of the unified ecosystem can use directly.

<Pkg g="js" n="remark-ltem" />

```js
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkLtem, { ltemHandlers } from "remark-ltem";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const file = await unified()
  .use(remarkParse)
  .use(remarkGfm)                                // optional
  .use(remarkLtem)
  .use(remarkRehype, { handlers: ltemHandlers })  // required for merged cells
  .use(rehypeStringify)
  .process(text);
String(file);
```

### codemirror-ltem {#js-codemirror-ltem}

A CodeMirror 6 component that recognizes and checks LTEM tables and lets people edit them as tables: a table widget, merging and splitting cells, and pasting from Excel and the web with merged cells kept. `codemirror-ltem-live` builds a live preview of the whole Markdown document on it. [Cellmark Editor](./#an-editor-built-on-ltem) uses both.

<Pkg g="js" n="codemirror-ltem" />

```ts
import { EditorView, basicSetup } from "codemirror";
import { ltem } from "codemirror-ltem";

new EditorView({
  doc: "| Region | Revenue | <<  |\n| ^^     | Q1      | Q2  |\n|--------|---------|-----|\n| Asia   | 100     | 120 |\n",
  extensions: [basicSetup, ltem()],
  parent: document.body,
});
```

## Python

### ltem-core {#py-ltem-core}

The reference implementation, with the `ltem` command. It is installed as `ltem-core` and imported as `ltem`. It has no dependencies; the `markdown` extra (`pip install "ltem-core[markdown]"`) renders inline Markdown in cells with markdown-it-py.

<Pkg g="py" n="ltem-core" />

```python
import ltem

result = ltem.parse_table("""\
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |""")

table = result.table            # the table model (see ast/ in the LTEM repository)
table.to_dict()                 # JSON-ready dict
ltem.render_html(table)         # <table> with colspan and rowspan
ltem.write(table)               # canonical LTEM
result.problems                 # validation problems, if any

for item in ltem.from_html(html):   # HTML tables -> table models
    print(ltem.write(item.table), item.warnings)
```

### mdit-py-ltem {#py-mdit-py-ltem}

A plugin for markdown-it-py.

<Pkg g="py" n="mdit-py-ltem" />

```python
from markdown_it import MarkdownIt
from mdit_py_ltem import ltem_plugin

md = MarkdownIt("commonmark").use(ltem_plugin)
```

### markdown-ltem {#py-markdown-ltem}

An extension for Python-Markdown, and so for MkDocs.

<Pkg g="py" n="markdown-ltem" />

```python
import markdown

html = markdown.markdown(text, extensions=["ltem"])
```

In `mkdocs.yml`:

```yaml
markdown_extensions:
  - ltem
```

## Rust

### ltem {#rs-ltem}

The Rust core. The optional feature `commonmark-inline` renders the text of cells as CommonMark inlines with pulldown-cmark.

<Pkg g="rs" n="ltem" />

```rust
let doc = "| Region | Revenue | <<  |\n| ^^     | Q1      | Q2  |\n|--------|---------|-----|\n| Asia   | 100     | 120 |\n";

for result in ltem::find_tables(doc) {
    let table = result.table.expect("find_tables returns tables only");
    for problem in &result.problems {
        println!("{problem}"); // for example "V13 at (1,0): '<<' has no cell to extend"
    }
    let html = ltem::render_html(&table, None);    // plain inline rendering
    let canonical = ltem::write(&table).unwrap();  // canonical LTEM
    let json = table.to_json_pretty();             // the table model as JSON
}
```

### ltem-cli {#rs-ltem-cli}

The `ltem` command, built on the Rust core with CommonMark inline rendering.

<Pkg g="rs" n="ltem-cli" />

```text
ltem parse     [FILE]                     print the table model of every table as JSON
ltem render    [FILE]                     print the HTML of every table
ltem validate  [FILE] [--json]            print validation problems; exit status 1 if there are any
ltem fmt       [FILE]                     rewrite the input with every table in canonical form
ltem from-html [FILE] [--header-rows N] [--plain]   convert HTML tables to canonical LTEM
```

### pulldown-cmark-ltem {#rs-pulldown-cmark-ltem}

An adapter for pulldown-cmark: LTEM tables come out as HTML blocks, everything else from pulldown-cmark.

<Pkg g="rs" n="pulldown-cmark-ltem" />

```rust
use pulldown_cmark::{html, Options};

let parser = pulldown_cmark_ltem::Parser::new_ext(markdown, Options::ENABLE_FOOTNOTES);
let mut out = String::new();
html::push_html(&mut out, parser);
```

### mdbook-ltem {#rs-mdbook-ltem}

A preprocessor for mdBook 0.4 and 0.5. Install it, then add it to `book.toml`:

<Pkg g="rs" n="mdbook-ltem" />

```toml
[preprocessor.ltem]
after = ["links"]
```

### comrak-ltem {#rs-comrak-ltem}

An adapter for comrak, the engine behind GitLab and crates.io: LTEM tables in comrak's AST.

<Pkg g="rs" n="comrak-ltem" />

```rust
use comrak::Options;

let mut options = Options::default();
options.extension.strikethrough = true;
let html = comrak_ltem::markdown_to_html(markdown, &options);
```

## Go

### ltem {#go-ltem}

The Go core uses only the standard library. The module `github.com/hugman/ltem/ltem-lib/go` also holds the `ltem` command and the goldmark extensions; it needs Go 1.25 or later.

<Pkg g="go" n="ltem" />

```go
import "github.com/hugman/ltem/ltem-lib/go/ltem"

for _, r := range ltem.FindTables(markdown) {
	for _, p := range r.Problems {
		fmt.Println(p) // for example "V13 at (1,0): '<<' has no cell to extend"
	}
	html := ltem.RenderHTML(r.Table, nil) // <table> with colspan and rowspan
	text, _ := ltem.Write(r.Table)        // canonical LTEM
	model, _ := json.Marshal(r.Table)     // the table model (ast/)
}
```

### goldmarkltem {#go-goldmarkltem}

Extensions for goldmark v1 (`goldmarkltem`) and v2 (`goldmarkltem/v2`).

<Pkg g="go" n="goldmarkltem" />

```go
import (
	"github.com/yuin/goldmark"
	"github.com/hugman/ltem/ltem-lib/go/goldmarkltem"
)

md := goldmark.New(goldmark.WithExtensions(goldmarkltem.Extension))
var buf bytes.Buffer
err := md.Convert(source, &buf)
```

## Lua, Pandoc and Quarto

### ltem.lua {#lua-ltem-lua}

The core in pure Lua 5.4, without C code. It runs in any Lua 5.4, including Pandoc's.

<Pkg g="lua" n="ltem.lua" />

```lua
local ltem = require("ltem")

for _, result in ipairs(ltem.find_tables(text)) do
  local t = result.table              -- the table model
  for _, p in ipairs(result.problems) do
    print(p.rule, p.row, p.col, p.message)  -- for example: V13  1  0  '<<' has no cell to extend
  end
  print(ltem.render_html(t))          -- HTML with colspan and rowspan
  print(ltem.write(t))                -- canonical LTEM
end
```

### Pandoc readers and filter {#lua-pandoc-readers-and-filter}

Two Pandoc readers read Pandoc's Markdown or `commonmark_x` with LTEM tables, into any format Pandoc writes. They need Pandoc 3, tested with 3.9.

<Pkg g="lua" n="Pandoc readers and filter" />

```sh
pandoc -f ltem-lib/lua/pandoc/ltem-markdown.lua input.md -o output.html
pandoc -f ltem-lib/lua/pandoc/ltem-commonmark_x.lua input.md -o output.docx
```

To keep your input format, the filter turns code blocks with the class `ltem` into tables:

```sh
pandoc -L ltem-lib/lua/pandoc/ltem-filter.lua input.md -o output.html
```

### Quarto extension {#lua-quarto-extension}

Quarto takes the filter as an extension; it cannot use the readers. Copy the folder `ltem-lib/lua/_extensions/ltem` into your project's `_extensions` folder and add:

<Pkg g="lua" n="Quarto extension" />

```yaml
filters:
  - ltem
```

## Where LTEM does not render yet

GitHub, GitLab and most chat interfaces render Markdown with their own engines, which do not know LTEM yet. There an LTEM table shows as a plain GFM table, and some of it can look wrong. [In renderers without LTEM support](./docs/guide#in-renderers-without-ltem-support) shows what to expect and how to write tables that still read well.
