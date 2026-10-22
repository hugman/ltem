package ltem_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/hugman/ltem/ltem-lib/go/internal/conformance"
	"github.com/hugman/ltem/ltem-lib/go/internal/randdoc"
	"github.com/hugman/ltem/ltem-lib/go/ltem"
)

func addSeeds(f *testing.F) {
	examples, err := conformance.Examples()
	if err != nil {
		f.Fatal(err)
	}
	for _, ex := range examples {
		f.Add(ex.LTEM)
	}
	for _, doc := range randdoc.New(1).Documents(50) {
		f.Add(doc)
	}
}

// FuzzFindTables checks that parsing never panics and that every table found is a
// valid model whose sources point at its cells and whose canonical form reads back
// as the same table.
func FuzzFindTables(f *testing.F) {
	addSeeds(f)
	f.Fuzz(func(t *testing.T, doc string) {
		lines := strings.Split(strings.NewReplacer("\r\n", "\n", "\r", "\n").Replace(doc), "\n")
		for _, r := range ltem.FindTables(doc) {
			if err := r.Table.Check(); err != nil {
				t.Fatalf("invalid model %+v: %v", r.Table, err)
			}
			if len(r.Sources) != len(r.Table.Cells) || len(r.Forms) != r.Table.Rows || r.End-r.Start != r.Table.Rows+1 {
				t.Fatalf("result does not fit its table: %+v", r)
			}
			for i, s := range r.Sources {
				line := lines[s.Line]
				if s.Start < 0 || s.Start > s.End || s.End > len(line) {
					t.Fatalf("source %+v outside line %q", s, line)
				}
				if got := modelText(line[s.Start:s.End]); got != r.Table.Cells[i].Text {
					t.Fatalf("source %q gives %q, model text is %q", line[s.Start:s.End], got, r.Table.Cells[i].Text)
				}
			}
			text, err := ltem.Write(r.Table)
			if err != nil {
				t.Fatal(err)
			}
			back := ltem.ParseTable(text)
			if back.Table == nil || len(back.Problems) != 0 || !sameStructure(back.Table, r.Table) {
				t.Fatalf("canonical form %q does not read back as the table: %+v", text, back)
			}
			if got, want := ltem.RenderHTML(back.Table, nil), ltem.RenderHTML(r.Table, nil); got != want {
				t.Fatalf("canonical form %q renders differently:\n%s\n%s", text, got, want)
			}
		}
		ltem.Format(doc)
	})
}

// FuzzTableAt checks that TableAt never panics, whatever the delimiter index.
func FuzzTableAt(f *testing.F) {
	addSeeds(f)
	f.Fuzz(func(t *testing.T, block string) {
		lines := strings.Split(block, "\n")
		for d := -1; d <= len(lines); d++ {
			if r := ltem.TableAt(lines, d, 3); r.Table != nil && r.Start < 3 {
				t.Fatalf("start %d before the offset", r.Start)
			}
		}
	})
}

// FuzzWriteModel checks that writing a table model read from JSON never panics, and
// that a model that can be written reads back with the same structure.
func FuzzWriteModel(f *testing.F) {
	cases, err := conformance.CanonicalCases()
	if err != nil {
		f.Fatal(err)
	}
	for _, c := range cases {
		f.Add(string(c.Table))
	}
	f.Add(`{"version":"1.0","rows":1000000000,"cols":1000000000,"header_rows":1,"align":[],"cells":[]}`)
	f.Fuzz(func(t *testing.T, data string) {
		var table ltem.Table
		if json.Unmarshal([]byte(data), &table) != nil {
			return
		}
		text, err := ltem.Write(&table)
		if err != nil {
			return
		}
		back := ltem.ParseTable(text)
		if back.Table == nil || !sameStructure(back.Table, &table) {
			t.Fatalf("%q does not read back as the model %+v: %+v", text, table, back.Table)
		}
	})
}
