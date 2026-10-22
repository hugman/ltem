package goldmarkltem_test

import (
	"strings"
	"testing"
	"time"

	gast "github.com/yuin/goldmark/v2/ast"
	"github.com/yuin/goldmark/v2/extension"
	extast "github.com/yuin/goldmark/v2/extension/ast"
	"github.com/yuin/goldmark/v2/parser"
	"github.com/yuin/goldmark/v2/renderer/html"

	goldmarkltem "github.com/hugman/ltem/ltem-lib/go/goldmarkltem/v2"
	"github.com/hugman/ltem/ltem-lib/go/internal/conformance"
	"github.com/hugman/ltem/ltem-lib/go/internal/gmtest"
)

// check renders each case and compares the HTML after the conformance normalization.
func check(t *testing.T, md markdown, cases []gmtest.Case) {
	t.Helper()
	for _, c := range cases {
		if got := convert(t, md, c.Source); conformance.Normalize(got) != conformance.Normalize(c.Want) {
			t.Errorf("%s:\n%s\ngot:\n%s\nwant:\n%s", c.Name, c.Source, got, c.Want)
		}
	}
}

func TestContainers(t *testing.T) { check(t, commonMark(), gmtest.Containers) }

func TestEscapes(t *testing.T) { check(t, commonMark(), gmtest.Escapes) }

func TestSeveralTables(t *testing.T) { check(t, commonMark(), gmtest.SeveralTables) }

func TestTableEnds(t *testing.T) { check(t, commonMark(), gmtest.TableEnds) }

func TestHeaderRows(t *testing.T) { check(t, commonMark(), gmtest.HeaderRows) }

func TestParagraphBeforeTable(t *testing.T) { check(t, commonMark(), gmtest.ParagraphBeforeTable) }

func TestKnownLimitations(t *testing.T) { check(t, commonMark(), gmtest.KnownLimitations) }

// TestIndentedParagraphLines checks that the indentation of paragraph lines counts,
// although goldmark v2 removes it from the lines of a paragraph.
func TestIndentedParagraphLines(t *testing.T) { check(t, commonMark(), gmtest.IndentedParagraphLines) }

func TestInlineMarkup(t *testing.T) {
	md := markdown{
		parser.New(parser.WithExtensions(goldmarkltem.GFMParser, extension.FootnoteParser)),
		html.New(html.WithUnsafe(), html.WithExtensions(goldmarkltem.GFMHTMLRenderer, extension.FootnoteHTMLRenderer)),
	}
	got := convert(t, md, gmtest.InlineSource)
	for _, want := range gmtest.InlineWant {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
}

func TestAlignment(t *testing.T) {
	source := "| a | b {c:2} |\n|:-|:-:|--:|\n| 1 | 2 | 3 |\n"
	ext := func(opts ...goldmarkltem.HTMLRendererOption) markdown {
		return markdown{parser.New(parser.WithExtensions(goldmarkltem.Parser)), html.New(html.WithExtensions(goldmarkltem.NewHTMLRenderer(opts...)))}
	}
	xhtml := markdown{parser.New(parser.WithExtensions(goldmarkltem.Parser)), html.New(html.WithXHTML(), html.WithExtensions(goldmarkltem.HTMLRenderer))}
	options := []struct {
		name string
		md   markdown
		want string
	}{
		{"html5", ext(), `<th style="text-align:left">a</th>` + "\n" + `<th colspan="2" style="text-align:center">b</th>`},
		{"xhtml", xhtml, `<th align="left">a</th>` + "\n" + `<th colspan="2" align="center">b</th>`},
		{"attribute", ext(goldmarkltem.WithTableCellAlignMethod(extension.TableCellAlignAttribute)), `<td align="right">3</td>`},
		{"none", ext(goldmarkltem.WithTableCellAlignMethod(extension.TableCellAlignNone)), "<th>a</th>\n<th colspan=\"2\">b</th>"},
	}
	for _, o := range options {
		if got := convert(t, o.md, source); !strings.Contains(got, o.want) {
			t.Errorf("%s: missing %q in\n%s", o.name, o.want, got)
		}
	}
	// The default extension, used by an XHTML renderer above, still renders HTML5.
	if got := convert(t, commonMark(), source); !strings.Contains(got, `style="text-align:left"`) {
		t.Errorf("an XHTML renderer changed the default extension:\n%s", got)
	}
}

// TestAST checks the nodes: goldmark's table nodes for tables without merged cells
// and one header row, LTEM nodes for other tables.
func TestAST(t *testing.T) {
	source := "| a | b |\n|:-|---|\n| 1 | x \\\\ *y* |\n\n| A {c:2} |\n| B | C |\n|---|---:|\n| ^^ | 2 |\n"
	doc := commonMark().parse(source)

	plain, ok := doc.FirstChild().(*extast.Table)
	if !ok {
		t.Fatalf("first table is %T", doc.FirstChild())
	}
	header, ok := plain.FirstChild().(*extast.TableHeader)
	if !ok || header.FirstChild().(*extast.TableCell).Alignment != extast.AlignLeft {
		t.Fatalf("plain table header: %T", plain.FirstChild())
	}
	body, ok := plain.LastChild().(*extast.TableBody)
	if !ok {
		t.Fatalf("plain table body: %T", plain.LastChild())
	}
	cell := body.FirstChild().LastChild().(*extast.TableCell)
	if got := source[cell.Pos() : cell.Pos()+8]; got != `x \\ *y*` {
		t.Errorf("cell position points at %q", got)
	}
	var kinds []string
	for c := cell.FirstChild(); c != nil; c = c.NextSibling() {
		kinds = append(kinds, c.Kind().String())
	}
	if strings.Join(kinds, " ") != "Text Text Emphasis" || !cell.FirstChild().NextSibling().(*gast.Text).HardLineBreak() {
		t.Errorf("cell children: %v", kinds)
	}

	ltemTable, ok := plain.NextSibling().(*goldmarkltem.Table)
	if !ok {
		t.Fatalf("second table is %T", plain.NextSibling())
	}
	if plain.Pos() != 0 || string(source[ltemTable.Pos():ltemTable.Pos()+5]) != "| A {" {
		t.Errorf("tables at %d and %d", plain.Pos(), ltemTable.Pos())
	}
	head, ok := ltemTable.FirstChild().(*goldmarkltem.TableHead)
	if !ok || head.ChildCount() != 2 {
		t.Fatalf("head %T", ltemTable.FirstChild())
	}
	a := head.FirstChild().FirstChild().(*goldmarkltem.TableCell)
	if a.Row != 0 || a.Col != 0 || a.Colspan != 2 || a.Rowspan != 1 || !a.Header || a.Alignment != extast.AlignNone {
		t.Errorf("cell A: %+v", a)
	}
	two := ltemTable.LastChild().(*goldmarkltem.TableBody).FirstChild().LastChild().(*goldmarkltem.TableCell)
	if two.Row != 2 || two.Col != 1 || two.Header || two.Alignment != extast.AlignRight || source[two.Pos()] != '2' {
		t.Errorf("cell 2: %+v", two)
	}
	if row := head.LastChild(); string(source[row.Pos():row.Pos()+3]) != "| B" {
		t.Errorf("second header row at %d", row.Pos())
	}
	_ = gast.Walk(doc, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if k := n.Kind().String(); k == "LTEMCellLine" || k == "LTEMTableBlock" {
			t.Errorf("a %s node is left in the document", k)
		}
		return gast.WalkContinue, nil
	})
}

// TestWithGoldmarkTable checks that LTEM tables still work if goldmark's table
// extension is registered too, as with extension.GFMParser.
func TestWithGoldmarkTable(t *testing.T) {
	md := markdown{
		parser.New(parser.WithExtensions(extension.GFMParser, goldmarkltem.Parser)),
		html.New(html.WithExtensions(extension.GFMHTMLRenderer, goldmarkltem.HTMLRenderer)),
	}
	if got := convert(t, md, "| a | << |\n| ^^ | b |\n|---|---|\n| 1 | 2 |\n"); !strings.Contains(got, `<th colspan="2" rowspan="2">a</th>`) {
		t.Errorf("got %s", got)
	}
}

// TestIncompleteInput renders every prefix of some documents: goldmark must not fail,
// and no internal node may be left.
func TestIncompleteInput(t *testing.T) {
	examples, err := conformance.Examples()
	if err != nil {
		t.Fatal(err)
	}
	docs := []string{gmtest.StreamDoc}
	for _, ex := range examples {
		docs = append(docs, ex.LTEM)
	}
	md := commonMark()
	prefixes := 0
	for _, doc := range docs {
		for i := 0; i <= len(doc); i++ {
			node := md.parse(doc[:i])
			_ = gast.Walk(node, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
				if k := n.Kind().String(); k == "LTEMCellLine" || k == "LTEMTableBlock" {
					t.Fatalf("a %s node is left for %q", k, doc[:i])
				}
				return gast.WalkContinue, nil
			})
			var buf strings.Builder
			if err := md.renderer.Render(&buf, []byte(doc[:i]), node); err != nil {
				t.Fatal(err)
			}
			prefixes++
		}
	}
	t.Logf("rendered %d prefixes", prefixes)
}

// TestDifferencesFromGoldmarkTable checks the inputs that render differently from
// goldmark's table extension, and that they do differ.
func TestDifferencesFromGoldmarkTable(t *testing.T) {
	gfm := markdown{parser.New(parser.WithExtensions(extension.TableParser)), html.New(html.WithUnsafe(), html.WithExtensions(extension.TableHTMLRenderer))}
	check(t, commonMark(), gmtest.DifferencesFromGoldmarkTable)
	for _, c := range gmtest.DifferencesFromGoldmarkTable {
		if convert(t, gfm, c.Source) == convert(t, commonMark(), c.Source) {
			t.Errorf("%s: renders as with goldmark's table extension", c.Name)
		}
	}
	// goldmark v2 gives a cell added to a short row its column's alignment, as LTEM does.
	for _, c := range gmtest.DifferencesFromGoldmarkV1Table {
		if convert(t, gfm, c.Source) != convert(t, commonMark(), c.Source) {
			t.Errorf("%s: renders differently from goldmark's table extension", c.Name)
		}
	}
}

// TestLinearTime checks that documents built to need quadratic time are rendered in
// time proportional to their size.
func TestLinearTime(t *testing.T) {
	if testing.Short() {
		t.Skip("skipped with -short")
	}
	md := commonMark()
	measure := func(doc string) time.Duration {
		start := time.Now()
		convert(t, md, doc)
		return time.Since(start)
	}
	small, large := gmtest.Adversarial(2000), gmtest.Adversarial(20000)
	for name := range small {
		measure(small[name]) // warm up
		if s, l := measure(small[name]), measure(large[name]); l > 40*s+100*time.Millisecond {
			t.Errorf("%s: %v for 2000 lines, %v for 20000", name, s, l)
		}
	}
}
