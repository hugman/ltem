package ltem

import (
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestSplitRow(t *testing.T) {
	cases := map[string][]string{
		"| a | b |":     {"a", "b"},
		"a | b":         {"a", "b"},
		`| a \| b |`:    {"a | b"},
		`| a \|`:        {"a |"},
		`| a \\|`:       {`a \|`},
		"||":            {""},
		"|":             {""},
		"":              {""},
		"|　x |":         {"　x"},
		"|\ta\t|\t\t|":  {"a", ""},
		"  | a | b |  ": {"a", "b"},
		"| a |b|c":      {"a", "b", "c"},
	}
	for line, want := range cases {
		if got := SplitRow(line); !reflect.DeepEqual(got, want) {
			t.Errorf("SplitRow(%q) = %q, want %q", line, got, want)
		}
	}
}

func TestSplitRowSpans(t *testing.T) {
	line := `  | a | \| b |  |{c:2}|`
	var got [][2]string
	for _, s := range SplitRowSpans(line) {
		got = append(got, [2]string{s.Text, line[s.Start:s.End]})
	}
	want := [][2]string{{"a", "a"}, {"| b", `\| b`}, {"", ""}, {"{c:2}", "{c:2}"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %q, want %q", got, want)
	}
	if s := SplitRowSpans(line)[2]; s.Start != 16 || s.End != 16 {
		t.Errorf("empty cell at %d..%d, want the end of its space (16)", s.Start, s.End)
	}
	line = "가 |　x "
	s := SplitRowSpans(line)[1]
	if line[s.Start:s.End] != "　x" {
		t.Errorf("got %q", line[s.Start:s.End])
	}
}

func TestIndentation(t *testing.T) {
	cases := map[string]int{"x": 0, "  x": 2, "\tx": 4, "  \tx": 4, " \t \tx": 8, "    ": 4, "": 0}
	for line, want := range cases {
		if got := Indentation(line); got != want {
			t.Errorf("Indentation(%q) = %d, want %d", line, got, want)
		}
	}
}

func TestIsDelimiterRow(t *testing.T) {
	for _, line := range []string{"|---|:-:|--:|", "-|-", "|-|", "   |:--|", "| --- |", "|-", ":-:|", "|---|\t"} {
		if !IsDelimiterRow(line) {
			t.Errorf("%q is a delimiter row", line)
		}
	}
	for _, line := range []string{"- | -", "    |---|", "\t|---|", "|---|x|", "|:|", "---", ":--", "|---||", "|::|", "|-:-|", "| - - |", "-\t| -"} {
		if IsDelimiterRow(line) {
			t.Errorf("%q is not a delimiter row", line)
		}
	}
}

func TestStartsBlock(t *testing.T) {
	for _, line := range []string{
		"> q", "# h", "###### h", "#", "#\tx", "```", "~~~ x", "````x`", "- - -", "***", "___ ", "_ _ _",
		"- x", "-", "1. x", "123456789) x", "+", "*\tx", "   > q", "2. a | b", "1.", "* * x",
	} {
		if !StartsBlock(line) {
			t.Errorf("%q begins a block", line)
		}
	}
	for _, line := range []string{
		"####### h", "#h", "``", "~~", "-x", "1234567890. x", "    > q", "\t> q", "--", "1.x", "| a |",
		"", "   ", "=== x", "**", "*x", "a", "-1. x",
	} {
		if StartsBlock(line) {
			t.Errorf("%q does not begin a block", line)
		}
	}
}

func TestEndsTableBody(t *testing.T) {
	for _, line := range []string{"", " \t ", "    | a |", "\t| a |", "> | a |", "- x"} {
		if !EndsTableBody(line) {
			t.Errorf("%q ends a table body", line)
		}
	}
	for _, line := range []string{"　", "| a |", "a", "===", "--", "   | a |"} {
		if EndsTableBody(line) {
			t.Errorf("%q does not end a table body", line)
		}
	}
}

func TestIdentifierRows(t *testing.T) {
	for _, line := range []string{"| # orders |", "   |#\tx_1|  ", "|# _|"} {
		if !isIdentifierRow(line) {
			t.Errorf("%q is a reserved identifier line", line)
		}
	}
	for _, line := range []string{"| #orders |", "| # 1x |", "    | # x |", "| # x | y |", "| # x", "# x |", "| # x-y |"} {
		if isIdentifierRow(line) {
			t.Errorf("%q is not a reserved identifier line", line)
		}
	}
	if IsUpperHeaderRow("| # orders |") || IsUpperHeaderRow("|---|") || IsUpperHeaderRow("    | a |") ||
		!IsUpperHeaderRow("   | a |") || IsUpperHeaderRow("a | b") {
		t.Error("IsUpperHeaderRow")
	}
}

func TestSetextUnderline(t *testing.T) {
	for _, line := range []string{"=", "===", "---", "-", "   ==  ", "--\t"} {
		if !isSetextUnderline(line) {
			t.Errorf("%q is a setext underline", line)
		}
	}
	for _, line := range []string{"", "    ===", "=-=", "== =", "-- -", "|---|"} {
		if isSetextUnderline(line) {
			t.Errorf("%q is not a setext underline", line)
		}
	}
}

func TestSplitAttribute(t *testing.T) {
	text, attr := splitAttribute("Revenue {c:2,r:3}")
	if text != "Revenue" || attr == nil || attr.colspan.n != 2 || attr.rowspan.n != 3 || len(attr.problems) != 0 {
		t.Errorf("got %q %+v", text, attr)
	}
	for _, s := range []string{"x{c:2}", "x {c: 2}", "x {c:2} y", "{c:}", "{}", "{x:1}", "{c:2,}", "{c:2;r:1}", "{C:2}"} {
		if _, attr := splitAttribute(s); attr != nil {
			t.Errorf("%q has no span attribute", s)
		}
	}
	if text, attr := splitAttribute("a \t{r:1}"); text != "a" || attr == nil || attr.rowspan.n != 1 {
		t.Errorf("got %q %+v", text, attr)
	}
	if _, attr := splitAttribute("{c:0,c:3}"); attr == nil || len(attr.problems) != 2 || attr.colspan.n != 1 {
		t.Errorf("{c:0,c:3}: %+v", attr)
	}
	if _, attr := splitAttribute("{c:3,c:0}"); attr == nil || len(attr.problems) != 2 || attr.colspan.n != 3 {
		t.Errorf("{c:3,c:0}: %+v", attr)
	}
	_, attr = splitAttribute("{c:99999999999999999999999,r:007}")
	if attr.colspan.n != math.MaxInt || attr.rowspan.n != 7 {
		t.Errorf("got %+v", attr)
	}
}

func TestCellText(t *testing.T) {
	cases := map[string]string{
		`a \\ b`:      "a\nb",
		`\<<`:         "<<",
		`\^^`:         "^^",
		`x \{c:2}`:    "x {c:2}",
		`x\{c:2}`:     `x\{c:2}`,
		`\{c:2}`:      "{c:2}",
		`a\\\b`:       "a\n\\b",
		`a \\ \<< \\`: "a\n<<\n",
		`\<< x`:       `\<< x`,
		`a \{b}`:      `a \{b}`,
		`x \{c:2} y`:  `x \{c:2} y`,
	}
	for text, want := range cases {
		if got := cellText(text); got != want {
			t.Errorf("cellText(%q) = %q, want %q", text, got, want)
		}
	}
}

// lineText is the model text of one line from its source span (see CellLineSpans).
func lineText(source string, s Span) string {
	return unescape(strings.ReplaceAll(source[s.Start:s.End], `\|`, "|"))
}

func TestCellLineSpans(t *testing.T) {
	cases := map[string][]string{
		"":                {""},
		"a":               {"a"},
		`a \\ b`:          {"a", "b"},
		`a \| b {c:2}`:    {`a \| b`},
		`{c:2}`:           {""},
		`a \\ {r:2}`:      {"a", ""},
		`\<< \\ x \{c:2}`: {`\<<`, `x \{c:2}`},
		`a\\\|b`:          {"a", `\|b`},
		`a\\|b`:           {`a\\|b`},
		` a \\  \\ b `:    {"a", "", "b"},
		`p \\`:            {"p", ""},
	}
	for source, want := range cases {
		var got []string
		for _, s := range CellLineSpans(source) {
			got = append(got, source[s.Start:s.End])
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("CellLineSpans(%q) = %q, want %q", source, got, want)
		}
	}
}

// TestCellLineSpansMatchModelText checks on every cell of many rows that the spans give
// the model text.
func TestCellLineSpansMatchModelText(t *testing.T) {
	pieces := []string{"a", " ", "\t", `\|`, `\\`, `\`, "|", "{c:2}", "{r:1,c:3}", `\{c:2}`, `\<<`, "<<", "^^", "　", "x", "{"}
	for i := 0; i < 20000; i++ {
		var b strings.Builder
		for n := i; n > 0; n /= len(pieces) {
			b.WriteString(pieces[n%len(pieces)])
		}
		line := "| " + b.String() + " |"
		for _, cell := range SplitRowSpans(line) {
			source := line[cell.Start:cell.End]
			text := cell.Text
			if text != colspanMarker && text != rowspanMarker {
				text, _ = splitAttribute(text)
			}
			var lines []string
			for _, s := range CellLineSpans(source) {
				lines = append(lines, lineText(source, s))
			}
			if got, want := strings.Join(lines, "\n"), cellText(text); got != want {
				t.Fatalf("cell %q: spans give %q, model text is %q", source, got, want)
			}
		}
	}
}
