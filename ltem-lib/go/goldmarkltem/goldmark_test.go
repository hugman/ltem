package goldmarkltem_test

import (
	"bytes"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"

	"github.com/hugman/ltem/ltem-lib/go/goldmarkltem"
	"github.com/hugman/ltem/ltem-lib/go/internal/conformance"
	"github.com/hugman/ltem/ltem-lib/go/internal/gmtest"
	"github.com/hugman/ltem/ltem-lib/go/internal/randdoc"
	"github.com/hugman/ltem/ltem-lib/go/ltem"
)

// commonMark is goldmark with its CommonMark settings, raw HTML kept, and LTEM.
func commonMark(opts ...goldmark.Option) goldmark.Markdown {
	return goldmark.New(append([]goldmark.Option{
		goldmark.WithExtensions(goldmarkltem.Extension),
		goldmark.WithRendererOptions(html.WithUnsafe()),
	}, opts...)...)
}

func convert(t testing.TB, md goldmark.Markdown, source string) string {
	t.Helper()
	var buf bytes.Buffer
	if err := md.Convert([]byte(source), &buf); err != nil {
		t.Fatal(err)
	}
	return buf.String()
}

// TestSpecExamples renders every example of the specification as a whole document and
// compares the HTML, normalized as in the conformance tests, with the expected HTML.
func TestSpecExamples(t *testing.T) {
	examples, err := conformance.Examples()
	if err != nil {
		t.Fatal(err)
	}
	for name, md := range map[string]goldmark.Markdown{
		"html5": commonMark(),
		"xhtml": commonMark(goldmark.WithRendererOptions(html.WithXHTML())),
	} {
		passed := 0
		for _, ex := range examples {
			got := convert(t, md, ex.LTEM)
			if conformance.Normalize(got) != conformance.Normalize(ex.HTML) {
				t.Errorf("%s: example %d (%s):\n%s\ngot:\n%s\nwant:\n%s", name, ex.Example, ex.Section, ex.LTEM, got, ex.HTML)
				continue
			}
			passed++
		}
		if passed != 46 {
			t.Errorf("%s: %d of %d examples pass", name, passed, len(examples))
		}
	}
}

// TestMatchesCore renders random documents with goldmark and compares their tables
// with the tables that the core finds and renders, with goldmark rendering cell text.
// The blocks of the documents are wrapped in block quotes and list items for goldmark,
// and left bare for the core, which does not model containers.
func TestMatchesCore(t *testing.T) {
	n := 5000
	if testing.Short() {
		n = 500
	}
	docs, unwrapped := gmtest.RandomDocs(n, (*randdoc.Generator).ComparableBlock)
	md := commonMark()
	tables, failures := 0, 0
	for i, doc := range docs {
		var html []string
		for _, r := range ltem.FindTables(unwrapped[i]) {
			html = append(html, ltem.RenderHTML(r.Table, goldmarkltem.CommonMarkInline))
		}
		tables += len(html)
		got, want := conformance.Tables(convert(t, md, doc)), conformance.Tables(strings.Join(html, "\n"))
		if !reflect.DeepEqual(got, want) {
			if failures++; failures <= 3 {
				t.Errorf("document %q (bare %q):\ngoldmark %q\ncore %q", doc, unwrapped[i], got, want)
			}
		}
	}
	t.Logf("compared %d documents with %d tables: %d differ", len(docs), tables, failures)
}

// TestPlainTablesAsGoldmarkTable checks that tables without LTEM notation render
// byte for byte as with goldmark's own table extension, with every alignment option.
func TestPlainTablesAsGoldmarkTable(t *testing.T) {
	n := 3000
	if testing.Short() {
		n = 300
	}
	docs, _ := gmtest.RandomDocs(n, (*randdoc.Generator).PlainTable)
	options := map[string][]extension.TableOption{
		"default":   nil,
		"attribute": {extension.WithTableCellAlignMethod(extension.TableCellAlignAttribute)},
		"style":     {extension.WithTableCellAlignMethod(extension.TableCellAlignStyle)},
		"none":      {extension.WithTableCellAlignMethod(extension.TableCellAlignNone)},
	}
	for name, opts := range options {
		for _, xhtml := range []bool{false, true} {
			rendererOptions := []renderer.Option{html.WithUnsafe()}
			if xhtml {
				rendererOptions = append(rendererOptions, html.WithXHTML())
			}
			ltemMD := goldmark.New(goldmark.WithExtensions(goldmarkltem.New(opts...)), goldmark.WithRendererOptions(rendererOptions...))
			gfmMD := goldmark.New(goldmark.WithExtensions(extension.NewTable(opts...)), goldmark.WithRendererOptions(rendererOptions...))
			failures, tables := 0, 0
			for _, doc := range docs {
				got, want := convert(t, ltemMD, doc), convert(t, gfmMD, doc)
				tables += strings.Count(want, "<table>")
				if got != want {
					if failures++; failures <= 3 {
						t.Errorf("%s xhtml=%v: %q\nLTEM:\n%s\nGFM:\n%s", name, xhtml, doc, got, want)
					}
				}
			}
			if tables < n/2 {
				t.Errorf("only %d tables in %d documents", tables, n)
			}
			t.Logf("%s, xhtml=%v: %d documents, %d tables: %d differ", name, xhtml, len(docs), tables, failures)
		}
	}
}

func ExampleExtension() {
	md := goldmark.New(goldmark.WithExtensions(goldmarkltem.Extension))
	var buf bytes.Buffer
	_ = md.Convert([]byte("| Region | Revenue | <<  |\n| ^^     | Q1      | Q2  |\n|--------|--------:|----:|\n| Asia   | 100     | 120 |\n"), &buf)
	fmt.Print(buf.String())
	// Output:
	// <table>
	// <thead>
	// <tr>
	// <th rowspan="2">Region</th>
	// <th colspan="2" style="text-align:right">Revenue</th>
	// </tr>
	// <tr>
	// <th style="text-align:right">Q1</th>
	// <th style="text-align:right">Q2</th>
	// </tr>
	// </thead>
	// <tbody>
	// <tr>
	// <td>Asia</td>
	// <td style="text-align:right">100</td>
	// <td style="text-align:right">120</td>
	// </tr>
	// </tbody>
	// </table>
}
