package goldmarkltem_test

import (
	"bytes"
	"fmt"
	"reflect"
	"strings"
	"testing"

	gast "github.com/yuin/goldmark/v2/ast"
	"github.com/yuin/goldmark/v2/extension"
	"github.com/yuin/goldmark/v2/parser"
	"github.com/yuin/goldmark/v2/renderer/html"

	goldmarkv1ltem "github.com/hugman/ltem/ltem-lib/go/goldmarkltem"
	goldmarkltem "github.com/hugman/ltem/ltem-lib/go/goldmarkltem/v2"
	"github.com/hugman/ltem/ltem-lib/go/internal/conformance"
	"github.com/hugman/ltem/ltem-lib/go/internal/gmtest"
	"github.com/hugman/ltem/ltem-lib/go/internal/randdoc"
	"github.com/hugman/ltem/ltem-lib/go/ltem"
)

// markdown is a goldmark v2 parser and HTML renderer.
type markdown struct {
	parser   parser.Parser
	renderer html.Renderer
}

// commonMark is goldmark with its CommonMark settings, raw HTML kept, and LTEM.
func commonMark(opts ...html.Option) markdown {
	return markdown{
		parser.New(parser.WithExtensions(goldmarkltem.Parser)),
		html.New(append([]html.Option{html.WithUnsafe(), html.WithExtensions(goldmarkltem.HTMLRenderer)}, opts...)...),
	}
}

func (md markdown) parse(source string) gast.Node {
	return md.parser.Parse([]byte(source))
}

func convert(t testing.TB, md markdown, source string) string {
	t.Helper()
	var buf bytes.Buffer
	if err := md.renderer.Render(&buf, []byte(source), md.parse(source)); err != nil {
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
	for name, md := range map[string]markdown{"html5": commonMark(), "xhtml": commonMark(html.WithXHTML())} {
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
// with the tables that the core finds and renders. See the test of the same name in
// the package for goldmark v1.
func TestMatchesCore(t *testing.T) {
	n := 5000
	if testing.Short() {
		n = 500
	}
	docs, bare := gmtest.RandomDocs(n, (*randdoc.Generator).ComparableBlock)
	md := commonMark()
	tables, failures := 0, 0
	for i, doc := range docs {
		var html []string
		for _, r := range ltem.FindTables(bare[i]) {
			html = append(html, ltem.RenderHTML(r.Table, goldmarkv1ltem.CommonMarkInline))
		}
		tables += len(html)
		got, want := conformance.Tables(convert(t, md, doc)), conformance.Tables(strings.Join(html, "\n"))
		if !reflect.DeepEqual(got, want) {
			if failures++; failures <= 3 {
				t.Errorf("document %q (bare %q):\ngoldmark %q\ncore %q", doc, bare[i], got, want)
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
	for _, method := range []extension.TableCellAlignMethod{
		extension.TableCellAlignDefault, extension.TableCellAlignAttribute, extension.TableCellAlignStyle, extension.TableCellAlignNone,
	} {
		for _, xhtml := range []bool{false, true} {
			opts := []html.Option{html.WithUnsafe()}
			if xhtml {
				opts = append(opts, html.WithXHTML())
			}
			ltemMD := markdown{
				parser.New(parser.WithExtensions(goldmarkltem.Parser)),
				html.New(append(opts, html.WithExtensions(goldmarkltem.NewHTMLRenderer(goldmarkltem.WithTableCellAlignMethod(method))))...),
			}
			gfmMD := markdown{
				parser.New(parser.WithExtensions(extension.TableParser)),
				html.New(append(opts, html.WithExtensions(extension.NewTableHTMLRenderer(extension.WithTableCellAlignMethod(method))))...),
			}
			failures, tables := 0, 0
			for _, doc := range docs {
				got, want := convert(t, ltemMD, doc), convert(t, gfmMD, doc)
				tables += strings.Count(want, "<table>")
				if got != want {
					if failures++; failures <= 3 {
						t.Errorf("method %d xhtml=%v: %q\nLTEM:\n%s\nGFM:\n%s", method, xhtml, doc, got, want)
					}
				}
			}
			if tables < n/2 {
				t.Errorf("only %d tables in %d documents", tables, n)
			}
			t.Logf("method %d, xhtml=%v: %d documents, %d tables: %d differ", method, xhtml, len(docs), tables, failures)
		}
	}
}

func Example() {
	source := []byte("| Region | Revenue | <<  |\n| ^^     | Q1      | Q2  |\n|--------|--------:|----:|\n| Asia   | 100     | 120 |\n")
	p := parser.New(parser.WithExtensions(goldmarkltem.Parser))
	r := html.New(html.WithExtensions(goldmarkltem.HTMLRenderer))
	var buf bytes.Buffer
	_ = r.Render(&buf, source, p.Parse(source))
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
