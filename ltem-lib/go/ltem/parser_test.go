package ltem_test

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/hugman/ltem/ltem-lib/go/internal/gmtest"
	"github.com/hugman/ltem/ltem-lib/go/internal/randdoc"
	"github.com/hugman/ltem/ltem-lib/go/ltem"
)

func TestSourcesOfCompactAttributeEscapeAndPadding(t *testing.T) {
	src := "intro\n| R {c:2} |\n| a   | \\| b |\n|---|---|\n| x | y |\n| z |"
	r := ltem.ParseTable(src)
	lines := strings.Split(src, "\n")
	type got struct {
		Row, Col, Rowspan, Colspan, Line int
		Text                             string
	}
	var have []got
	for _, s := range r.Sources {
		have = append(have, got{s.Row, s.Col, s.Rowspan, s.Colspan, s.Line, lines[s.Line][s.Start:s.End]})
	}
	want := []got{{0, 0, 1, 2, 1, "R {c:2}"}, {1, 0, 1, 1, 2, "a"}, {1, 1, 1, 1, 2, `\| b`},
		{2, 0, 1, 1, 4, "x"}, {2, 1, 1, 1, 4, "y"}, {3, 0, 1, 1, 5, "z"}, {3, 1, 1, 1, 5, ""}}
	if !reflect.DeepEqual(have, want) {
		t.Errorf("got %+v\nwant %+v", have, want)
	}
	if padded := r.Sources[len(r.Sources)-1]; padded.Start != len(lines[5]) || padded.End != len(lines[5]) {
		t.Errorf("padded cell at %d..%d", padded.Start, padded.End)
	}
	if r.Start != 1 || r.End != 6 || !reflect.DeepEqual(r.Forms, []ltem.RowForm{ltem.CompactRow, ltem.GridRow, ltem.GridRow, ltem.PaddedRow}) {
		t.Errorf("start %d end %d forms %v", r.Start, r.End, r.Forms)
	}
}

func TestSourcesUseDocumentLinesAndBytes(t *testing.T) {
	doc := "# Title\r\n\r\n| 가 | << |\r|---|---|\n| 1 | 　2 |\n"
	results := ltem.FindTables(doc)
	if len(results) != 1 {
		t.Fatalf("found %d tables", len(results))
	}
	lines := strings.Split(strings.NewReplacer("\r\n", "\n", "\r", "\n").Replace(doc), "\n")
	var got []string
	for _, s := range results[0].Sources {
		got = append(got, lines[s.Line][s.Start:s.End])
	}
	if want := []string{"가", "1", "　2"}; !reflect.DeepEqual(got, want) {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestParseTableFindsTablesInParagraphs(t *testing.T) {
	cases := []struct {
		block      string
		start, end int
		headerRows int
	}{
		{"Quarterly revenue\n| Region | Q1 |\n|---|---|\n| Asia | 1 |", 1, 4, 1},
		{"| # orders |\n| ID | C |\n|---|---|\n| 1 | A |", 1, 4, 1},
		{"| a | b |\n|---|\n| c |\n|:-:|", 2, 4, 1},
		{"Note\n| a | b |\n|---|\n|---|", 2, 4, 1},
		{"| a |\n| b |\n| c |\n|---|\n| 1 |\n    code\n| 2 |", 0, 5, 3},
		{"| a |\n|---|\n| 1 |\n2. x", 0, 3, 1},
		{"| a |\n|---|\n| 1 |\n===\n--", 0, 5, 1},
		{"| a |\n|---|\n|---|", 0, 3, 1},
		{"x\n===\n|---|\n| 1 |", 0, 0, 0},
		{"# | a |\n--|--", 0, 0, 0},
		{"| a | b |\n    |---|---|", 0, 0, 0},
		{"Size | Price\n- | -", 0, 0, 0},
		{"Total\n:--", 0, 0, 0},
		{"| a |\r\n|---|\r\n| 1 |\r", 0, 3, 1},
		{"- x\n|---|", 0, 0, 0},
		{"| a | b | |\n|---|---|", 0, 2, 1},
		{"| a | b | c |\n|---|---|", 0, 0, 0},
	}
	for _, c := range cases {
		r := ltem.ParseTable(c.block)
		if c.headerRows == 0 {
			if r.Table != nil {
				t.Errorf("%q: found a table %+v", c.block, r.Table)
			}
			continue
		}
		if r.Table == nil || r.Start != c.start || r.End != c.end || r.Table.HeaderRows != c.headerRows {
			t.Errorf("%q: got table %v start %d end %d, want %d..%d with %d header rows",
				c.block, r.Table != nil, r.Start, r.End, c.start, c.end, c.headerRows)
		}
	}
}

func TestFindTablesSkipsCode(t *testing.T) {
	doc := "```\n| a |\n|---|\n```\n\n    | b |\n    |---|\n\n~~~~\n| c |\n|---|\n~~~\n| d |\n|---|\n~~~~\n| e |\n|---|\n\n" +
		"``` x\n```y\n| f |\n|---|\n```\n| g |\n|---|\n| 1 |\n| h |\n|---|"
	var got []string
	for _, r := range ltem.FindTables(doc) {
		got = append(got, r.Table.Cells[0].Text)
	}
	if want := []string{"e", "g"}; !reflect.DeepEqual(got, want) {
		t.Errorf("got %q, want %q", got, want)
	}
	// A block holds several tables when a line that ends a table body is followed by
	// another table.
	got = nil
	for _, r := range ltem.FindTables("| a |\n|---|\n- x\n| b |\n|---|\n\t\n| c |\n|---|") {
		got = append(got, r.Table.Cells[0].Text)
	}
	if want := []string{"a", "b", "c"}; !reflect.DeepEqual(got, want) {
		t.Errorf("got %q, want %q", got, want)
	}
}

// TestTableAtMatchesParseLines checks the incremental use of TableAt that Markdown
// parser integrations make: trying each line that has the form of a delimiter row,
// from the top, finds the same table as ParseLines.
func TestTableAtMatchesParseLines(t *testing.T) {
	g := randdoc.New(7)
	for range 5000 {
		lines := g.Table()
		var incremental ltem.Result
		for d := 1; d < len(lines); d++ {
			if !ltem.IsDelimiterRow(lines[d]) {
				continue
			}
			if incremental = ltem.TableAt(lines[:d+1], d, 0); incremental.Table != nil {
				// The body runs to the first line that ends it.
				end := d + 1
				for end < len(lines) && !ltem.EndsTableBody(lines[end]) {
					end++
				}
				incremental = ltem.TableAt(lines[:end], d, 0)
				break
			}
		}
		whole := ltem.ParseLines(lines, 0)
		if (whole.Table == nil) != (incremental.Table == nil) ||
			whole.Table != nil && !reflect.DeepEqual(whole, incremental) {
			t.Fatalf("%q:\nParseLines %+v\nTableAt %+v", lines, whole, incremental)
		}
	}
}

func TestTableAtRejects(t *testing.T) {
	lines := []string{"| a |", "|---|", "| 1 |"}
	for _, d := range []int{-1, 0, 2, 3, 9} {
		if r := ltem.TableAt(lines, d, 5); r.Table != nil || r.Start != 5 || r.End != 5 {
			t.Errorf("TableAt(d=%d) = %+v", d, r)
		}
	}
	if r := ltem.TableAt(lines, 1, 5); r.Table == nil || r.Start != 5 || r.End != 8 || r.Sources[1].Line != 7 {
		t.Errorf("TableAt(d=1) = %+v", r)
	}
}

func TestProblemsAndJSON(t *testing.T) {
	r := ltem.ParseTable("| A {c:0,c:3} | B |\n|---|---|\n| << | 1 | 2 |\n| x |")
	var got []string
	for _, p := range r.Problems {
		got = append(got, p.String())
	}
	want := []string{
		"V1 at (0,0): span value must be a positive integer, got 0",
		"V1 at (0,0): 'c' appears more than once",
		"V14 at row 1: row has 3 cells; it fits neither as a grid row (2 cells) nor as a compact row",
		"V13 at (1,0): '<<' has no cell to extend",
		"V14 at row 2: row has 1 cells; it fits neither as a grid row (2 cells) nor as a compact row",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %q\nwant %q", got, want)
	}
	data, _ := json.Marshal(r.Problems[2:4])
	if string(data) != `[{"rule":"V14","row":1,"col":null,"severity":"warning"},{"rule":"V13","row":1,"col":0,"severity":"error"}]` {
		t.Errorf("got %s", data)
	}
	model, _ := json.Marshal(r.Table)
	wantModel := `{"version":"1.0","rows":3,"cols":2,"header_rows":1,"align":[null,null],"cells":[` +
		`{"row":0,"col":0,"rowspan":1,"colspan":1,"text":"A"},{"row":0,"col":1,"rowspan":1,"colspan":1,"text":"B"},` +
		`{"row":1,"col":0,"rowspan":1,"colspan":1,"text":"\u003c\u003c"},{"row":1,"col":1,"rowspan":1,"colspan":1,"text":"1"},` +
		`{"row":2,"col":0,"rowspan":1,"colspan":1,"text":"x"},{"row":2,"col":1,"rowspan":1,"colspan":1,"text":""}]}`
	if string(model) != wantModel {
		t.Errorf("got  %s\nwant %s", model, wantModel)
	}
	if byValue, _ := json.Marshal(*r.Table); string(byValue) != string(model) {
		t.Errorf("a table value marshals as %s", byValue)
	}
	var back ltem.Table
	if err := json.Unmarshal(model, &back); err != nil || !reflect.DeepEqual(&back, r.Table) {
		t.Errorf("read back %+v, %v", back, err)
	}
}

func TestUnmarshalRejects(t *testing.T) {
	for _, s := range []string{
		`{"version":"2.0","rows":1,"cols":1,"header_rows":1,"align":[null],"cells":[]}`,
		`{"rows":1,"cols":1,"header_rows":1,"align":[null],"cells":[]}`,
		`{"version":"1.0","rows":1,"cols":1,"header_rows":1,"align":[null],"cells":[],"x":1}`,
		`{"version":"1.0","rows":1,"cols":1,"header_rows":1,"align":["middle"],"cells":[]}`,
		`{"version":"1.0","rows":1,"cols":1,"header_rows":1,"align":[1],"cells":[]}`,
		`{"version":"1.0","rows":1,"cols":1,"header_rows":1,"align":[null],"cells":[{"row":0,"col":0,"rowspan":1,"colspan":1}]}`,
		`{"version":"1.0","rows":1,"cols":1,"header_rows":1,"align":[null],"cells":[{"row":0,"col":0,"rowspan":1,"colspan":1,"text":"a","x":0}]}`,
		`{"version":"1.0","rows":"1","cols":1,"header_rows":1,"align":[null],"cells":[]}`,
		`[]`,
	} {
		var table ltem.Table
		if err := json.Unmarshal([]byte(s), &table); err == nil {
			t.Errorf("%s was accepted", s)
		}
	}
}

func TestPlainInlineAndRenderHTML(t *testing.T) {
	if got := ltem.PlainInline(`a \* <b> & "q" 'x' \a \`); got != `a * &lt;b&gt; &amp; &quot;q&quot; 'x' \a \` {
		t.Errorf("PlainInline: %q", got)
	}
	table := &ltem.Table{Rows: 3, Cols: 2, HeaderRows: 2, Align: []ltem.Align{ltem.AlignLeft, ltem.AlignNone},
		Cells: []ltem.Cell{{0, 1, 2, 1, "b"}, {0, 0, 1, 1, "a\n*c*"}, {1, 0, 1, 1, ""}, {2, 0, 1, 2, "d"}}}
	want := "<table>\n<thead>\n<tr>\n<th align=\"left\">a<br />*c*</th>\n<th rowspan=\"2\">b</th>\n</tr>\n" +
		"<tr>\n<th align=\"left\"></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td colspan=\"2\" align=\"left\">d</td>\n</tr>\n</tbody>\n</table>"
	if got := ltem.RenderHTML(table, nil); got != want {
		t.Errorf("RenderHTML:\n got %q\nwant %q", got, want)
	}
	upper := func(s string) string { return strings.ToUpper(s) }
	if got := ltem.RenderHTML(&ltem.Table{Rows: 1, Cols: 1, HeaderRows: 1, Align: []ltem.Align{0},
		Cells: []ltem.Cell{{0, 0, 1, 1, "x\ny"}}}, upper); got != "<table>\n<thead>\n<tr>\n<th>X<br />Y</th>\n</tr>\n</thead>\n</table>" {
		t.Errorf("RenderHTML with an inline renderer: %q", got)
	}
}

// TestLinearTime checks that documents built to need quadratic time are parsed in
// time proportional to their size: ten times the lines take far less than a hundred
// times as long.
func TestLinearTime(t *testing.T) {
	if testing.Short() {
		t.Skip("skipped with -short")
	}
	measure := func(doc string) time.Duration {
		start := time.Now()
		ltem.FindTables(doc)
		ltem.Format(doc)
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
