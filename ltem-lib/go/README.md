# ltem-lib/go

The Go workspace of LTEM (LLM-friendly Table-Enhanced Markdown): Markdown pipe tables with merged cells and multi-row headers. It holds a core library, the `ltem` command and extensions for [goldmark](https://github.com/yuin/goldmark) v1 and v2, in one Go module, `github.com/hugman/ltem/ltem-lib/go`.

```
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
```

| Package | Import path | What it is |
|---|---|---|
| [`ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/go/ltem) | `github.com/hugman/ltem/ltem-lib/go/ltem` | The core library: find and parse tables, validate, render HTML, write canonical LTEM, the table model as JSON, where each cell is in the source |
| [`cmd/ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/go/cmd/ltem) | `github.com/hugman/ltem/ltem-lib/go/cmd/ltem` | The `ltem` command, which follows the [conformance](https://github.com/hugman/ltem/tree/main/conformance) command-line protocol |
| [`goldmarkltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/go/goldmarkltem) | `github.com/hugman/ltem/ltem-lib/go/goldmarkltem` | goldmark v1 extension (goldmark 1.8) |
| [`goldmarkltem/v2`](https://github.com/hugman/ltem/tree/main/ltem-lib/go/goldmarkltem) | `github.com/hugman/ltem/ltem-lib/go/goldmarkltem/v2` | goldmark v2 extension (goldmark 2.1) |

Status: version 0.1.0, the first release, for LTEM 1.0. Not yet published: the module has no version tag yet. The API may change before version 1.0.0.

## Install

Once the repository is public:

```
go get github.com/hugman/ltem/ltem-lib/go@latest
go install github.com/hugman/ltem/ltem-lib/go/cmd/ltem@latest
```

The module needs Go 1.25 or later, because goldmark v2 does. The core package uses only the standard library; the goldmark packages and the command depend on goldmark. As the module is in a subdirectory of the repository, its versions are tagged `ltem-lib/go/vX.Y.Z`.

## Use

The core:

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

goldmark v1:

```go
import (
	"github.com/yuin/goldmark"
	"github.com/hugman/ltem/ltem-lib/go/goldmarkltem"
)

md := goldmark.New(goldmark.WithExtensions(goldmarkltem.Extension)) // or goldmarkltem.GFM
err := md.Convert(source, &buf)
```

goldmark v2:

```go
import (
	"github.com/yuin/goldmark/v2/parser"
	"github.com/yuin/goldmark/v2/renderer/html"
	goldmarkltem "github.com/hugman/ltem/ltem-lib/go/goldmarkltem/v2"
)

p := parser.New(parser.WithExtensions(goldmarkltem.Parser))
r := html.New(html.WithExtensions(goldmarkltem.HTMLRenderer))
err := r.Render(&buf, source, p.Parse(source))
```

The command:

```
ltem parse    [FILE]           # table models as JSON
ltem render   [FILE]           # HTML of each table
ltem validate [FILE] [--json]  # validation problems; exit status 1 if there are errors
ltem fmt      [FILE]           # rewrite every table in canonical form
ltem write    [FILE]           # canonical LTEM of table models given as JSON
```

See the package READMEs for the details: [`ltem/README.md`](https://github.com/hugman/ltem/blob/main/ltem-lib/go/ltem/README.md), [`cmd/ltem/README.md`](https://github.com/hugman/ltem/blob/main/ltem-lib/go/cmd/ltem/README.md) and [`goldmarkltem/README.md`](https://github.com/hugman/ltem/blob/main/ltem-lib/go/goldmarkltem/README.md).

## Relation to the other implementations

The core follows the Python implementation (`../python/ltem/`), which is the semantic reference: the same block scan, header-row recognition, span resolution, recovery rules, problems (rule, row and column, in the same order), canonical form and HTML. Like the Rust and TypeScript cores, it tries compact rows with an undo log instead of copying the grid. It differs from them in a few places:

- **No HTML-to-LTEM converter.** The Go core and command have no `from_html` / `from-html`.
- **Byte offsets.** `CellSource.Start` and `End` are byte offsets into the line, as in Rust (Python counts code points, TypeScript UTF-16 units).
- **Messages.** Problem messages quote text with Go syntax (`"oops"` where Python writes `'oops'`). Rules and positions are the same.
- **Model checks.** `Table.Check` also rejects what the JSON Schema rules out (sizes below 1, unknown alignments) and grids of more than 2^28 positions, so that a model read from untrusted JSON cannot exhaust memory.
- **More API for parser integrations.** `TableAt` parses the table whose delimiter row is a given line, and `CellLineSpans` gives where each line of a cell's text is in its source; the goldmark extensions use both.
- **Linear time.** Before it reads a table's body, the parser checks that the last header row fits by placing the header rows alone, which gives the same result, and `Format` writes its output in one pass. So a block with many delimiter rows whose header rows do not fit, or with many tables, takes time proportional to its size. The tests check this on such documents of 2000 and 20000 lines.

## Development

From this directory, with Go 1.25 or later:

```
go test ./...          # all tests (about a minute)
go test -short ./...   # without the differential tests and with fewer random documents
go vet ./...
gofmt -l .
go build -o /tmp/ltem ./cmd/ltem
```

Run the conformance cases against the command, from the repository root:

```
python3 conformance/tools/run.py --impl "/tmp/ltem"
```

The tests:

| Test | What it checks |
|---|---|
| `ltem` conformance tests | Every case of [`cases/spec-examples.json`](https://github.com/hugman/ltem/blob/main/conformance/cases/spec-examples.json) (table models, errors as a multiset, HTML after the conformance normalization) and [`cases/canonical.json`](https://github.com/hugman/ltem/blob/main/conformance/cases/canonical.json), read directly |
| `ltem` differential tests | 3000 random documents (fixed seed; `LTEM_DIFF_DOCS` changes the number) against the Python reference, through `testdata/reference.py` and `uv`: table models, problems in order, row forms, table lines, cell sources, HTML, canonical form and `fmt`. And against the Rust command (`LTEM_RUST_CLI`, default `../rust/target/release/ltem`): `parse`, `validate --json`, `fmt` and `render`. Skipped if the references are not available |
| `ltem` unit and fuzz tests | Line syntax, cell text and spans, writer round trips on random tables, sources, JSON, HTML, linear time on adversarial documents; fuzz targets `FuzzFindTables`, `FuzzTableAt`, `FuzzWriteModel` |
| `cmd/ltem` tests | Every command, exit statuses, files and standard input, errors |
| `goldmarkltem`, `goldmarkltem/v2` | The specification examples as whole documents, random documents against the core, tables without LTEM notation against goldmark's own table extension byte for byte, containers, inlines, escapes, alignment, incomplete input, the AST, linear time; fuzz target `FuzzConvert` |

Fuzz targets run with, for example, `go test ./ltem -run XXX -fuzz FuzzFindTables -fuzztime 60s`.

`internal/` holds code shared by the tests: the conformance cases and the HTML normalization of the conformance runner (`conformance`), the random document generator (`randdoc`), and the cases of the goldmark tests (`gmtest`). `internal/gmtable` holds the parts of the goldmark extensions that do not depend on the goldmark version.

## Dependencies

| Module | Version | License | Used by |
|---|---|---|---|
| [github.com/yuin/goldmark](https://github.com/yuin/goldmark) | v1.8.6 | MIT | `goldmarkltem`, `cmd/ltem` |
| [github.com/yuin/goldmark/v2](https://github.com/yuin/goldmark) | v2.1.6 | MIT | `goldmarkltem/v2` |

Both depend only on the Go standard library (BSD-3-Clause). The core package `ltem` has no dependency outside the standard library.

## License

MIT ([`LICENSE`](https://github.com/hugman/ltem/blob/main/ltem-lib/go/LICENSE)).
