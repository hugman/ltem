package ltem_test

import (
	"errors"
	"math/rand/v2"
	"reflect"
	"strings"
	"testing"

	"github.com/hugman/ltem/ltem-lib/go/ltem"
)

// randomTable returns a random valid table: spans fill free rectangles and stay in
// the header rows or in the body. The texts are model texts, so LTEM escapes are
// already removed.
func randomTable(r *rand.Rand, rows, cols, headerRows int) *ltem.Table {
	taken := make([][]bool, rows)
	for i := range taken {
		taken[i] = make([]bool, cols)
	}
	texts := []string{"", "x", "Revenue", "**Q1**", "a | b", "line 1\nline 2", "\u3000indent", "<<", "^^",
		"a << b", "{c:2}", "x {r:3}", "$5 ~ $10", "-", "100", "# x", ":--", "\n", "a\\", "x \\|", "| # id |"}
	t := &ltem.Table{Rows: rows, Cols: cols, HeaderRows: headerRows}
	for row := 0; row < rows; row++ {
		for col := 0; col < cols; col++ {
			if taken[row][col] {
				continue
			}
			bottom := rows
			if row < headerRows {
				bottom = headerRows
			}
			maxCols := 1
			for col+maxCols < cols && !taken[row][col+maxCols] && maxCols < 4 {
				maxCols++
			}
			colspan, rowspan := 1, 1
			if r.Float64() < 0.3 {
				colspan = 1 + r.IntN(maxCols)
			}
			if r.Float64() < 0.3 {
				rowspan = 1 + r.IntN(min(3, bottom-row))
			}
			for rowspan > 1 && anyTaken(taken[row+rowspan-1][col:col+colspan]) {
				rowspan--
			}
			for dr := 0; dr < rowspan; dr++ {
				for dc := 0; dc < colspan; dc++ {
					taken[row+dr][col+dc] = true
				}
			}
			t.Cells = append(t.Cells, ltem.Cell{Row: row, Col: col, Rowspan: rowspan, Colspan: colspan,
				Text: texts[r.IntN(len(texts))]})
		}
	}
	for range cols {
		t.Align = append(t.Align, ltem.Align(r.IntN(4)))
	}
	return t
}

func anyTaken(cells []bool) bool {
	for _, c := range cells {
		if c {
			return true
		}
	}
	return false
}

// withoutWriterEscapes removes the CommonMark escapes that the writer adds to header
// rows (\-, \: and \#); they stay in the text read back but render the same.
func withoutWriterEscapes(t *ltem.Table) *ltem.Table {
	out := *t
	out.Cells = append([]ltem.Cell{}, t.Cells...)
	for i, c := range out.Cells {
		if strings.HasPrefix(c.Text, `\-`) || strings.HasPrefix(c.Text, `\:`) || strings.HasPrefix(c.Text, `\#`) {
			out.Cells[i].Text = c.Text[1:]
		}
	}
	return &out
}

func TestWriteRoundTrip(t *testing.T) {
	r := rand.New(rand.NewPCG(20261002, 1))
	for range 5000 {
		rows := 1 + r.IntN(7)
		table := randomTable(r, rows, 1+r.IntN(6), 1+r.IntN(rows))
		if err := table.Check(); err != nil {
			t.Fatal(err)
		}
		text, err := ltem.Write(table)
		if err != nil {
			t.Fatal(err)
		}
		back := ltem.ParseTable(text)
		if back.Table == nil || back.End != rows+1 || len(back.Problems) != 0 {
			t.Fatalf("%q does not read back as one valid table: %+v", text, back)
		}
		if got := withoutWriterEscapes(back.Table); !reflect.DeepEqual(got, table) {
			t.Fatalf("round trip of %q:\n got %+v\nwant %+v", text, got, table)
		}
		again, _ := ltem.Write(back.Table)
		if again != text {
			t.Fatalf("writing is not idempotent:\n%q\n%q", text, again)
		}
		written, sources, err := ltem.WriteWithSources(table)
		if err != nil || written != text || len(sources) != len(table.Cells) {
			t.Fatalf("WriteWithSources: %q %v %v", written, sources, err)
		}
		lines := strings.Split(text, "\n")
		for i, s := range sources {
			c := table.Cells[i]
			if s.Row != c.Row || s.Col != c.Col || s.Rowspan != c.Rowspan || s.Colspan != c.Colspan {
				t.Fatalf("source %+v for cell %+v", s, c)
			}
			if got := modelText(lines[s.Line][s.Start:s.End]); got != back.Table.Cells[i].Text {
				t.Fatalf("source %q gives %q, want %q", lines[s.Line][s.Start:s.End], got, back.Table.Cells[i].Text)
			}
		}
	}
}

// modelText is the model text of a content cell's source, from CellLineSpans.
func modelText(source string) string {
	var lines []string
	for _, s := range ltem.CellLineSpans(source) {
		lines = append(lines, ltem.Unescape(strings.ReplaceAll(source[s.Start:s.End], `\|`, "|")))
	}
	return strings.Join(lines, "\n")
}

func TestWriteEscapes(t *testing.T) {
	cases := []struct {
		table *ltem.Table
		want  string
	}{
		{
			&ltem.Table{Rows: 2, Cols: 2, HeaderRows: 1, Align: []ltem.Align{0, 0}, Cells: []ltem.Cell{
				{0, 0, 1, 1, "-"}, {0, 1, 1, 1, "-"}, {1, 0, 1, 1, "<<"}, {1, 1, 1, 1, "x {c:2}"},
			}},
			"| \\- | - |\n| --- | --- |\n| \\<< | x \\{c:2} |",
		},
		{
			&ltem.Table{Rows: 3, Cols: 1, HeaderRows: 2, Align: []ltem.Align{ltem.AlignCenter}, Cells: []ltem.Cell{
				{0, 0, 1, 1, "# orders"}, {1, 0, 1, 1, "# id"}, {2, 0, 1, 1, "a|b\n^^\n"},
			}},
			"| \\# orders |\n| # id |\n| :---: |\n| a\\|b \\\\ \\^^ \\\\  |",
		},
		{
			&ltem.Table{Rows: 2, Cols: 3, HeaderRows: 1, Align: []ltem.Align{ltem.AlignLeft, ltem.AlignRight, 0},
				Cells: []ltem.Cell{{0, 0, 2, 1, ""}, {0, 1, 1, 2, ":--"}, {1, 1, 1, 2, "{r:1}"}},
			},
			"",
		},
		{
			&ltem.Table{Rows: 3, Cols: 3, HeaderRows: 1, Align: []ltem.Align{ltem.AlignLeft, ltem.AlignRight, 0},
				Cells: []ltem.Cell{{0, 0, 1, 1, ""}, {0, 1, 1, 2, ":--"}, {1, 0, 2, 2, "{r:1}"}, {1, 2, 2, 1, "x"}},
			},
			"|  | :-- | << |\n| :--- | ---: | --- |\n| \\{r:1} | << | x |\n| ^^ | << | ^^ |",
		},
	}
	for _, c := range cases {
		got, err := ltem.Write(c.table)
		if c.want == "" {
			var modelErr *ltem.ModelError
			if !errors.As(err, &modelErr) {
				t.Errorf("Write(%+v) = %q, %v; want a *ModelError", c.table, got, err)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("Write(%+v) = %q, %v\nwant %q", c.table, got, err, c.want)
		}
	}
}

func TestCheck(t *testing.T) {
	valid := ltem.Table{Rows: 1, Cols: 1, HeaderRows: 1, Align: []ltem.Align{0}, Cells: []ltem.Cell{{0, 0, 1, 1, "a"}}}
	if err := valid.Check(); err != nil {
		t.Fatal(err)
	}
	broken := []ltem.Table{
		{Rows: 0, Cols: 0, HeaderRows: 0},
		{Rows: 1, Cols: 1, HeaderRows: 1, Align: nil, Cells: []ltem.Cell{{0, 0, 1, 1, "a"}}},
		{Rows: 1, Cols: 1, HeaderRows: 1, Align: []ltem.Align{9}, Cells: []ltem.Cell{{0, 0, 1, 1, "a"}}},
		{Rows: 1, Cols: 1, HeaderRows: 2, Align: []ltem.Align{0}, Cells: []ltem.Cell{{0, 0, 1, 1, "a"}}},
		{Rows: 1, Cols: 1, HeaderRows: 1, Align: []ltem.Align{0}},
		{Rows: 1, Cols: 1, HeaderRows: 1, Align: []ltem.Align{0}, Cells: []ltem.Cell{{0, 0, 1, 2, "a"}}},
		{Rows: 1, Cols: 1, HeaderRows: 1, Align: []ltem.Align{0}, Cells: []ltem.Cell{{0, 0, 1, 1, `a \\ b`}}},
		{Rows: 1, Cols: 2, HeaderRows: 1, Align: []ltem.Align{0, 0}, Cells: []ltem.Cell{{0, 1, 1, 1, "b"}, {0, 0, 1, 1, "a"}}},
		{Rows: 1, Cols: 2, HeaderRows: 1, Align: []ltem.Align{0, 0}, Cells: []ltem.Cell{{0, 0, 1, 2, "a"}, {0, 1, 1, 1, "b"}}},
		{Rows: 2, Cols: 1, HeaderRows: 1, Align: []ltem.Align{0}, Cells: []ltem.Cell{{0, 0, 2, 1, "a"}}},
		{Rows: 1, Cols: 1, HeaderRows: 1, Align: []ltem.Align{0}, Cells: []ltem.Cell{{-1, 0, 1, 1, "a"}}},
	}
	for _, table := range broken {
		if table.Check() == nil {
			t.Errorf("%+v is not a valid model", table)
		}
		if _, err := ltem.Write(&table); err == nil {
			t.Errorf("Write(%+v) succeeded", table)
		}
	}
}

func TestFormat(t *testing.T) {
	doc := "# Title\n\n- item\n  | A {c:2} |\n  |:-|-:|\n  | 1 | 2 |\n\n```\n| x |\n|---|\n```\n\ntext\r\n| a |\n|---|\n"
	want := "# Title\n\n- item\n  | A | << |\n  | :--- | ---: |\n  | 1 | 2 |\n\n```\n| x |\n|---|\n```\n\ntext\n| a |\n| --- |\n"
	if got := ltem.Format(doc); got != want {
		t.Errorf("Format:\n got %q\nwant %q", got, want)
	}
}
