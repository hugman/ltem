package goldmarkltem_test

import (
	"strings"
	"testing"
	"time"

	"github.com/yuin/goldmark"
	gast "github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	extast "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"

	"github.com/hugman/ltem/ltem-lib/go/goldmarkltem"
	"github.com/hugman/ltem/ltem-lib/go/internal/conformance"
	"github.com/hugman/ltem/ltem-lib/go/internal/gmtest"
)

// check renders each case and compares the HTML after the conformance normalization.
func check(t *testing.T, md goldmark.Markdown, cases []gmtest.Case) {
	t.Helper()
	for _, c := range cases {
		if got := convert(t, md, c.Source); conformance.Normalize(got) != conformance.Normalize(c.Want) {
			t.Errorf("%s:\n%s\ngot:\n%s\nwant:\n%s", c.Name, c.Source, got, c.Want)
		}
	}
}

func TestContainers(t *testing.T) { check(t, commonMark(), gmtest.Containers) }

func TestInlineMarkup(t *testing.T) {
	md := goldmark.New(
		goldmark.WithExtensions(goldmarkltem.GFM, extension.Footnote),
		goldmark.WithRendererOptions(html.WithUnsafe()),
	)
	got := convert(t, md, gmtest.InlineSource)
	for _, want := range append(gmtest.InlineWant, `<div class="footnotes" role="doc-endnotes">`) {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
}

func TestEscapes(t *testing.T) { check(t, commonMark(), gmtest.Escapes) }

func TestAlignment(t *testing.T) {
	source := "| a | b {c:2} |\n|:-|:-:|--:|\n| 1 | 2 | 3 |\n"
	options := []struct {
		name string
		md   goldmark.Markdown
		want string
	}{
		{"html5", goldmark.New(goldmark.WithExtensions(goldmarkltem.Extension)),
			`<th style="text-align:left">a</th>` + "\n" + `<th colspan="2" style="text-align:center">b</th>`},
		{"xhtml", goldmark.New(goldmark.WithExtensions(goldmarkltem.Extension), goldmark.WithRendererOptions(html.WithXHTML())),
			`<th align="left">a</th>` + "\n" + `<th colspan="2" align="center">b</th>`},
		{"attribute", goldmark.New(goldmark.WithExtensions(goldmarkltem.New(extension.WithTableCellAlignMethod(extension.TableCellAlignAttribute)))),
			`<td align="right">3</td>`},
		{"none", goldmark.New(goldmark.WithExtensions(goldmarkltem.New(extension.WithTableCellAlignMethod(extension.TableCellAlignNone)))),
			"<th>a</th>\n<th colspan=\"2\">b</th>"},
	}
	for _, o := range options {
		if got := convert(t, o.md, source); !strings.Contains(got, o.want) {
			t.Errorf("%s: missing %q in\n%s", o.name, o.want, got)
		}
	}
}

func TestSeveralTables(t *testing.T) { check(t, commonMark(), gmtest.SeveralTables) }

func TestTableEnds(t *testing.T) { check(t, commonMark(), gmtest.TableEnds) }

func TestHeaderRows(t *testing.T) { check(t, commonMark(), gmtest.HeaderRows) }

func TestParagraphBeforeTable(t *testing.T) { check(t, commonMark(), gmtest.ParagraphBeforeTable) }

func TestKnownLimitations(t *testing.T) { check(t, commonMark(), gmtest.KnownLimitations) }

func TestIndentedParagraphLines(t *testing.T) { check(t, commonMark(), gmtest.IndentedParagraphLines) }

// TestAST checks the nodes: goldmark's table nodes for tables without merged cells
// and one header row, LTEM nodes for other tables.
func TestAST(t *testing.T) {
	source := []byte("| a | b |\n|:-|---|\n| 1 | x \\\\ *y* |\n\n| A {c:2} |\n| B | C |\n|---|---:|\n| ^^ | 2 |\n")
	md := commonMark()
	doc := md.Parser().Parse(text.NewReader(source))

	plain, ok := doc.FirstChild().(*extast.Table)
	if !ok {
		t.Fatalf("first table is %T", doc.FirstChild())
	}
	if len(plain.Alignments) != 2 || plain.Alignments[0] != extast.AlignLeft || plain.Alignments[1] != extast.AlignNone {
		t.Errorf("alignments %v", plain.Alignments)
	}
	if _, ok := plain.FirstChild().(*extast.TableHeader); !ok || plain.ChildCount() != 2 {
		t.Errorf("plain table children: %T, %d", plain.FirstChild(), plain.ChildCount())
	}
	cell := plain.LastChild().LastChild().(*extast.TableCell)
	if got := source[cell.Pos() : cell.Pos()+8]; string(got) != `x \\ *y*` {
		t.Errorf("cell position points at %q", got)
	}
	var kinds []string
	for c := cell.FirstChild(); c != nil; c = c.NextSibling() {
		kinds = append(kinds, c.Kind().String())
		if c.Kind() == gast.KindText && c.(*gast.Text).HardLineBreak() != (c.PreviousSibling() != nil && c.NextSibling() != nil) {
			t.Errorf("hard line break on the wrong node")
		}
	}
	if strings.Join(kinds, " ") != "Text Text Emphasis" {
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
		t.Fatalf("head %T with %d rows", ltemTable.FirstChild(), ltemTable.FirstChild().ChildCount())
	}
	body, ok := ltemTable.LastChild().(*goldmarkltem.TableBody)
	if !ok || body.ChildCount() != 1 {
		t.Fatalf("body %T", ltemTable.LastChild())
	}
	a := head.FirstChild().FirstChild().(*goldmarkltem.TableCell)
	if a.Row != 0 || a.Col != 0 || a.Colspan != 2 || a.Rowspan != 1 || !a.Header || a.Alignment != extast.AlignNone {
		t.Errorf("cell A: %+v", a)
	}
	b := head.LastChild().FirstChild().(*goldmarkltem.TableCell)
	if b.Row != 1 || b.Col != 0 || !b.Header || string(source[b.Pos():b.Pos()+1]) != "B" {
		t.Errorf("cell B: %+v", b)
	}
	two := body.FirstChild().LastChild().(*goldmarkltem.TableCell)
	if two.Row != 2 || two.Col != 1 || two.Header || two.Alignment != extast.AlignRight {
		t.Errorf("cell 2: %+v", two)
	}
	if row := head.LastChild(); string(source[row.Pos():row.Pos()+3]) != "| B" {
		t.Errorf("second header row at %d", row.Pos())
	}
	_ = gast.Walk(doc, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if strings.HasPrefix(n.Kind().String(), "LTEMCellLine") || n.Kind().String() == "LTEMTableBlock" {
			t.Errorf("a %s node is left in the document", n.Kind())
		}
		return gast.WalkContinue, nil
	})
}

func TestCommonMarkInline(t *testing.T) {
	cases := map[string]string{
		"**Revenue**":    "<strong>Revenue</strong>",
		"- 2x faster":    "- 2x faster",
		"# not heading":  "# not heading",
		"1. one":         "1. one",
		"[a]: b":         "[a]: b",
		`6.1" < 7`:       "6.1&quot; &lt; 7",
		"`x|y` [a](b)":   `<code>x|y</code> <a href="b">a</a>`,
		"<b>raw</b>":     "<b>raw</b>",
		"":               "",
		"\u3000indented": "\u3000indented",
		"a\\":            "a\\",
	}
	for in, want := range cases {
		if got := goldmarkltem.CommonMarkInline(in); got != want {
			t.Errorf("CommonMarkInline(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestWithGoldmarkTable checks that LTEM tables still work if goldmark's table
// extension is registered too, as with extension.GFM.
func TestWithGoldmarkTable(t *testing.T) {
	md := goldmark.New(goldmark.WithExtensions(extension.GFM, goldmarkltem.Extension))
	got := convert(t, md, "| a | << |\n| ^^ | b |\n|---|---|\n| 1 | 2 |\n")
	if !strings.Contains(got, `<th colspan="2" rowspan="2">a</th>`) {
		t.Errorf("got %s", got)
	}
}

// TestIncompleteInput renders every prefix of some documents, as a table that arrives
// line by line or with a half-written last line: goldmark must not fail, and no
// internal node may be left.
func TestIncompleteInput(t *testing.T) {
	examples, err := conformance.Examples()
	if err != nil {
		t.Fatal(err)
	}
	var docs []string
	for _, ex := range examples {
		docs = append(docs, ex.LTEM)
	}
	docs = append(docs, gmtest.StreamDoc)
	md := commonMark()
	prefixes := 0
	for _, doc := range docs {
		for i := 0; i <= len(doc); i++ {
			source := []byte(doc[:i])
			node := md.Parser().Parse(text.NewReader(source))
			_ = gast.Walk(node, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
				if k := n.Kind().String(); k == "LTEMCellLine" || k == "LTEMTableBlock" {
					t.Fatalf("a %s node is left for %q", k, source)
				}
				return gast.WalkContinue, nil
			})
			var buf strings.Builder
			if err := md.Renderer().Render(&buf, source, node); err != nil {
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
	gfm := goldmark.New(goldmark.WithExtensions(extension.Table), goldmark.WithRendererOptions(html.WithUnsafe()))
	cases := append(gmtest.DifferencesFromGoldmarkTable, gmtest.DifferencesFromGoldmarkV1Table...)
	check(t, commonMark(), cases)
	for _, c := range cases {
		if convert(t, gfm, c.Source) == convert(t, commonMark(), c.Source) {
			t.Errorf("%s: renders as with goldmark's table extension", c.Name)
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
