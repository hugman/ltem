package ltem_test

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/hugman/ltem/ltem-lib/go/goldmarkltem"
	"github.com/hugman/ltem/ltem-lib/go/internal/conformance"
	"github.com/hugman/ltem/ltem-lib/go/ltem"
)

// TestSpecExamples checks every example of the specification: the table models, the
// validation errors (as a multiset) and the HTML of the tables after the
// normalization of conformance/README.md.
func TestSpecExamples(t *testing.T) {
	examples, err := conformance.Examples()
	if err != nil {
		t.Fatal(err)
	}
	if len(examples) != 46 {
		t.Fatalf("got %d examples, want 46", len(examples))
	}
	for _, ex := range examples {
		t.Run(fmt.Sprintf("example-%02d", ex.Example), func(t *testing.T) {
			results := ltem.FindTables(ex.LTEM)
			if len(results) != len(ex.Tables) {
				t.Fatalf("found %d tables, want %d", len(results), len(ex.Tables))
			}
			var keys []conformance.ErrorKey
			var html []string
			for i, r := range results {
				got, err := json.Marshal(r.Table)
				if err != nil {
					t.Fatal(err)
				}
				if eq, err := conformance.JSONEqual(got, ex.Tables[i]); err != nil || !eq {
					t.Errorf("table %d:\n got %s\nwant %s", i, got, ex.Tables[i])
				}
				if err := r.Table.Check(); err != nil {
					t.Errorf("table %d: %v", i, err)
				}
				for _, p := range r.Problems {
					keys = append(keys, conformance.ErrorKey{Rule: string(p.Rule), Row: p.Row, Col: p.Col})
				}
				html = append(html, ltem.RenderHTML(r.Table, goldmarkltem.CommonMarkInline))
			}
			if got, want := conformance.Multiset(keys), conformance.Multiset(conformance.Keys(ex.Errors)); !equalKeys(got, want) {
				t.Errorf("errors:\n got %v\nwant %v", got, want)
			}
			if got, want := conformance.Tables(strings.Join(html, "\n")), conformance.Tables(ex.HTML); !reflect.DeepEqual(got, want) {
				t.Errorf("html:\n got %q\nwant %q", got, want)
			}
		})
	}
}

func equalKeys(a, b []conformance.ErrorKey) bool {
	return len(a) == len(b) && (len(a) == 0 || reflect.DeepEqual(a, b))
}

// TestCanonicalCases checks the writer against cases/canonical.json, and that the
// canonical text reads back as the same table.
func TestCanonicalCases(t *testing.T) {
	cases, err := conformance.CanonicalCases()
	if err != nil {
		t.Fatal(err)
	}
	if len(cases) != 12 {
		t.Fatalf("got %d cases, want 12", len(cases))
	}
	for _, c := range cases {
		t.Run(fmt.Sprintf("case-%02d", c.Case), func(t *testing.T) {
			var table ltem.Table
			if err := json.Unmarshal(c.Table, &table); err != nil {
				t.Fatal(err)
			}
			got, err := ltem.Write(&table)
			if err != nil {
				t.Fatal(err)
			}
			if got != c.LTEM {
				t.Fatalf("%s:\n got %q\nwant %q", c.Name, got, c.LTEM)
			}
			back := ltem.ParseTable(got)
			if back.Table == nil || back.Start != 0 || back.End != table.Rows+1 {
				t.Fatalf("canonical text does not read back as one table: %+v", back)
			}
			if len(back.Problems) != 0 {
				t.Errorf("canonical text has problems: %v", back.Problems)
			}
			if !sameStructure(back.Table, &table) {
				t.Errorf("structure changed:\n got %+v\nwant %+v", back.Table, table)
			}
		})
	}
}

// sameStructure compares two tables ignoring cell text.
func sameStructure(a, b *ltem.Table) bool {
	if a.Rows != b.Rows || a.Cols != b.Cols || a.HeaderRows != b.HeaderRows ||
		!reflect.DeepEqual(a.Align, b.Align) || len(a.Cells) != len(b.Cells) {
		return false
	}
	for i := range a.Cells {
		x, y := a.Cells[i], b.Cells[i]
		if x.Row != y.Row || x.Col != y.Col || x.Rowspan != y.Rowspan || x.Colspan != y.Colspan {
			return false
		}
	}
	return true
}
