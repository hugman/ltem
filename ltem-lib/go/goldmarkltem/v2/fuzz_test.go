package goldmarkltem_test

import (
	"bytes"
	"testing"

	gast "github.com/yuin/goldmark/v2/ast"

	goldmarkltem "github.com/hugman/ltem/ltem-lib/go/goldmarkltem/v2"
	"github.com/hugman/ltem/ltem-lib/go/internal/conformance"
	"github.com/hugman/ltem/ltem-lib/go/internal/randdoc"
)

// FuzzConvert checks that goldmark with LTEM never fails or panics, leaves no internal
// node, and builds LTEM cells that cover their table's grid exactly once.
func FuzzConvert(f *testing.F) {
	examples, err := conformance.Examples()
	if err != nil {
		f.Fatal(err)
	}
	for _, ex := range examples {
		f.Add(ex.LTEM)
	}
	g := randdoc.New(3)
	for range 30 {
		f.Add(g.Document())
		f.Add("> " + g.Document())
		f.Add("- " + g.Document())
	}
	md := commonMark()
	f.Fuzz(func(t *testing.T, doc string) {
		node := md.parse(doc)
		_ = gast.Walk(node, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
			if !entering {
				return gast.WalkContinue, nil
			}
			switch k := n.Kind().String(); {
			case k == "LTEMCellLine" || k == "LTEMTableBlock":
				t.Fatalf("a %s node is left", k)
			case n.Kind() == goldmarkltem.KindTable:
				checkTable(t, n.(*goldmarkltem.Table))
			}
			return gast.WalkContinue, nil
		})
		var buf bytes.Buffer
		if err := md.renderer.Render(&buf, []byte(doc), node); err != nil {
			t.Fatal(err)
		}
	})
}

// checkTable checks that the cells of an LTEM table cover its grid exactly once.
func checkTable(t *testing.T, table *goldmarkltem.Table) {
	cols := len(table.Alignments)
	var cells []*goldmarkltem.TableCell
	rows := 0
	for section := table.FirstChild(); section != nil; section = section.NextSibling() {
		for row := section.FirstChild(); row != nil; row = row.NextSibling() {
			rows++
			for c := row.FirstChild(); c != nil; c = c.NextSibling() {
				cells = append(cells, c.(*goldmarkltem.TableCell))
			}
		}
	}
	covered := make([]int, rows*cols)
	for _, c := range cells {
		if c.Row < 0 || c.Col < 0 || c.Rowspan < 1 || c.Colspan < 1 || c.Row+c.Rowspan > rows || c.Col+c.Colspan > cols {
			t.Fatalf("cell %+v outside the %dx%d grid", c, rows, cols)
		}
		for r := c.Row; r < c.Row+c.Rowspan; r++ {
			for k := c.Col; k < c.Col+c.Colspan; k++ {
				covered[r*cols+k]++
			}
		}
	}
	for i, n := range covered {
		if n != 1 {
			t.Fatalf("position (%d,%d) is covered %d times", i/cols, i%cols, n)
		}
	}
}
