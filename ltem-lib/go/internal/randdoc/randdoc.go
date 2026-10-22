// Package randdoc generates random LTEM documents for the differential tests of this
// module. The documents mix tables, malformed tables and other Markdown, and cover
// markers, span attributes in grid and compact rows, escapes, line breaks in cells,
// alignment, several header rows, invalid tables, tabs and ideographic spaces.
package randdoc

import (
	"math/rand/v2"
	"strings"
)

// Generator makes random documents from a fixed seed.
type Generator struct {
	r *rand.Rand
}

// New returns a generator whose documents depend only on seed.
func New(seed uint64) *Generator {
	return &Generator{r: rand.New(rand.NewPCG(seed, 0x4c54454d))}
}

// Cells is the vocabulary of cell sources.
var Cells = []string{
	"a", "b", "Q1", "100", "Revenue", "", "", "", "<<", "<<", "<<", "^^", "^^", "^^",
	"{c:2}", "x {c:2}", "y {r:2}", "z {c:2,r:2}", "w {r:3,c:1}", "{r:2}", "{c:3}",
	"{c:0}", "v {c:0,c:3}", "u {r:1}", "t {c:1}", "{c:5}", "s {r:9}", "x{c:2}", "{c: 2}", "{c:007}", "q\t{r:2}",
	`\<<`, `\^^`, `x \{c:2}`, `\{r:2}`, `p \\ q`, `\\`, `a \\ \<<`, `a \| b`, `\|`, `a\\|b`, `\\\|`, `x \\ {c:2}`,
	"**x**", "`c\\|d`", "*e*", "[l](u)", "<http://x.y>", "　z", "　", "a << b", "«", "&amp;", "<b>", `"q"`,
	"$5", "-", "---", ":-:", ":--", "#", "# x", "1.", "a\tb", `\`, `x \`, "|", "^", "{", "}",
}

func (g *Generator) pick(items []string) string { return items[g.r.IntN(len(items))] }

// IntN returns a random number in [0, n).
func (g *Generator) IntN(n int) int { return g.r.IntN(n) }

func (g *Generator) chance(p float64) bool { return g.r.Float64() < p }

// Row returns a row with n cells, written in one of the forms GFM allows.
func (g *Generator) Row(cells []string) string {
	var b strings.Builder
	b.WriteString(g.indent())
	lead := g.chance(0.85) || len(cells) == 1 && cells[0] == ""
	if lead {
		b.WriteString("|")
	}
	for i, cell := range cells {
		if i > 0 {
			b.WriteString(g.pick([]string{"|", "|", "|", "\t|", "|\t"}))
		}
		pad := g.pick([]string{" ", " ", "", "  ", "\t"})
		b.WriteString(pad + cell + pad)
	}
	if g.chance(0.8) || !lead && len(cells) == 1 {
		b.WriteString("|")
	}
	if g.chance(0.1) {
		b.WriteString(g.pick([]string{" ", "\t", "  "}))
	}
	return b.String()
}

func (g *Generator) indent() string {
	switch n := g.r.IntN(40); {
	case n < 30:
		return ""
	case n < 37:
		return strings.Repeat(" ", 1+g.r.IntN(3))
	case n < 39:
		return "    "
	default:
		return "\t"
	}
}

// cells returns n random cell sources.
func (g *Generator) cells(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = g.pick(Cells)
	}
	return out
}

// Delimiter returns a delimiter row with cols cells, sometimes malformed.
func (g *Generator) Delimiter(cols int) string {
	if g.chance(0.04) {
		return g.pick([]string{":--", "- | -", "|-- -|", "|x|", "|:|", "|---||", "    |---|", "-|-", "|---|---|", "--- | ---"})
	}
	cells := make([]string, cols)
	for i := range cells {
		cells[i] = g.pick([]string{"---", "---", ":--", "--:", ":-:", "-", "---:", ":-"})
	}
	return g.Row(cells)
}

// Noise is a vocabulary of lines that are not table rows.
var Noise = []string{
	"Some text", "text with $5 and *emphasis*", "| # id |", "| # orders |", "　", "***", "# Heading",
	"    indented", "\tindented", "> quote", "> | a | b |", "- item", "2. x", "1. y", "---", "===", "--",
	"<div>", "* ", "+", "-", "1)", "  | a |", "|", "| a | b |", "a | b", "Total", ":--", "- | -", "|---|",
	" \t", "&copy;", "[ref]: /url", "Revenue\n===",
}

// Table returns the lines of a random table-like block: header rows, a delimiter row
// and body rows, sometimes with paragraph lines before it or another line after it.
func (g *Generator) Table() []string {
	cols := 1 + g.r.IntN(4)
	var lines []string
	if g.chance(0.2) {
		lines = append(lines, g.pick(Noise))
	}
	for range 1 + g.r.IntN(3) {
		lines = append(lines, g.Row(g.cells(max(1, cols+g.r.IntN(5)-2))))
		if g.chance(0.05) {
			lines = append(lines, g.pick(Noise))
		}
	}
	lines = append(lines, g.Delimiter(cols))
	for range g.r.IntN(6) {
		if g.chance(0.06) {
			lines = append(lines, g.pick(Noise))
		} else {
			lines = append(lines, g.Row(g.cells(max(1, cols+g.r.IntN(5)-2))))
		}
	}
	if g.chance(0.1) {
		lines = append(lines, g.pick(Noise))
	}
	return lines
}

// Document returns a random document: blocks of table lines, other lines and fenced
// code, separated by blank lines, with "\n", "\r\n" or "\r" line endings.
func (g *Generator) Document() string {
	var blocks []string
	for range 1 + g.r.IntN(4) {
		var lines []string
		switch n := g.r.IntN(10); {
		case n < 7:
			lines = g.Table()
		case n < 9:
			for range 1 + g.r.IntN(5) {
				if g.chance(0.5) {
					lines = append(lines, g.pick(Noise))
				} else {
					lines = append(lines, g.Row(g.cells(1+g.r.IntN(4))))
				}
			}
		default:
			fence := g.pick([]string{"```", "~~~", "````", "``` x"})
			lines = append(lines, fence)
			lines = append(lines, g.Table()...)
			if g.chance(0.8) {
				lines = append(lines, strings.Fields(fence)[0])
			}
		}
		blocks = append(blocks, strings.Join(lines, "\n"))
	}
	doc := strings.Join(blocks, g.pick([]string{"\n\n", "\n\n", "\n \t\n", "\n"})) + g.pick([]string{"\n", "\n", ""})
	switch n := g.r.IntN(20); {
	case n == 0:
		doc = strings.ReplaceAll(doc, "\n", "\r\n")
	case n == 1:
		doc = strings.ReplaceAll(doc, "\n", "\r")
	}
	return doc
}

// Documents returns n random documents.
func (g *Generator) Documents(n int) []string {
	docs := make([]string, n)
	for i := range docs {
		docs[i] = g.Document()
	}
	return docs
}

// comparableCells are Cells without "\\|" (see comparableRow).
var comparableCells = func() []string {
	var out []string
	for _, c := range Cells {
		if !strings.Contains(c, `\\|`) {
			out = append(out, c)
		}
	}
	return out
}()

// comparableRow returns a row with a leading pipe and an indentation of at most three
// spaces, so that it never begins another block. Every cell is followed by a space or
// a tab: a backslash at the end of a cell right before a pipe would make "\\|", which
// goldmark's inline parser reads differently from the model text (see the
// goldmarkltem README).
func (g *Generator) comparableRow(n int) string {
	var b strings.Builder
	b.WriteString(strings.Repeat(" ", g.r.IntN(4)) + "|")
	for i := range n {
		if i > 0 {
			b.WriteString("|")
		}
		b.WriteString(g.pick([]string{" ", "", "\t", "  "}) + g.pick(comparableCells) + g.pick([]string{" ", "\t", "  "}))
	}
	if g.chance(0.8) {
		b.WriteString("|")
	}
	return b.String()
}

// endings are lines that end a table body and the block they are in.
var endings = []string{"    indented", "# Heading", "***", "> quote", "- item", "2. x", "```\ncode\n```", "---"}

// ComparableBlock returns the lines of a block that a Markdown parser with LTEM and
// the light scan of the core read alike: optional paragraph lines, then header rows,
// a delimiter row and body rows that never begin another block, and at the end, maybe,
// a line that ends the table and the block.
func (g *Generator) ComparableBlock() []string {
	cols := 1 + g.r.IntN(4)
	var lines []string
	if g.chance(0.2) {
		lines = append(lines, g.pick([]string{"Some text", "text with $5 and *emphasis*", "Revenue {c:2}", "　x"}))
	}
	for range 1 + g.r.IntN(3) {
		lines = append(lines, g.comparableRow(max(1, cols+g.r.IntN(5)-2)))
	}
	if g.chance(0.05) {
		lines = append(lines, g.pick([]string{":--", "|-- -|", "|x|", "|:|", "|---||", "-|-", "--- | ---", "    |---|"}))
	} else {
		cells := make([]string, cols)
		for i := range cells {
			cells[i] = g.pick([]string{"---", ":--", "--:", ":-:", "-"})
		}
		lines = append(lines, strings.Repeat(" ", g.r.IntN(4))+"|"+strings.Join(cells, "|")+g.pick([]string{"|", ""}))
	}
	for range g.r.IntN(6) {
		if g.chance(0.05) {
			lines = append(lines, g.pick([]string{"===", "--", "　", "Total", "a | b"}))
		} else {
			lines = append(lines, g.comparableRow(max(1, cols+g.r.IntN(5)-2)))
		}
	}
	if g.chance(0.2) {
		lines = append(lines, g.pick(endings))
	}
	return lines
}

// Container returns a block wrapped in a random container: none, a block quote, a
// list item or a block quote in a list item. Every line gets the container's prefix,
// so no line is a lazy continuation line. The first line must not start with a tab.
func (g *Generator) Container(lines []string) []string {
	var first, rest string
	switch g.r.IntN(5) {
	case 0, 1:
		return lines
	case 2:
		first, rest = "> ", "> "
	case 3:
		// The spaces at the start of the first line belong to the list marker, and set
		// the indentation of the item's content (CommonMark 5.2).
		first, rest = "- ", strings.Repeat(" ", 2+len(lines[0])-len(strings.TrimLeft(lines[0], " ")))
	default:
		first, rest = "1. > ", "   > "
	}
	out := make([]string, 0, len(lines))
	for i, block := range lines {
		for j, line := range strings.Split(block, "\n") {
			if i == 0 && j == 0 {
				out = append(out, first+line)
			} else {
				out = append(out, rest+line)
			}
		}
	}
	return out
}

// plainCells are cell sources without LTEM notation.
var plainCells = []string{
	"a", "b", "Q1", "100", "Revenue", "", "**x**", "`code`", "*e*", "[l](u)", "<http://x.y>", "&amp;", `"q"`,
	"$5", `a \| b`, "`c\\|d`", "　z", `x \ y`, "1.", "#", "- x", "a\tb", "<b>", "~~s~~", "www.example.com",
}

// PlainTable returns the lines of a GFM table without LTEM notation: one header row
// with as many cells as columns, a delimiter row and body rows, preceded by an
// optional line of text.
func (g *Generator) PlainTable() []string {
	cols := 1 + g.r.IntN(4)
	row := func(n int) string {
		cells := make([]string, n)
		for i := range cells {
			cells[i] = g.pick(plainCells)
		}
		line := strings.Repeat(" ", g.r.IntN(4)) + "| " + strings.Join(cells, g.pick([]string{" | ", "|", " |\t"}))
		if cells[n-1] == "" { // an empty last cell needs the closing pipe
			return line + " |"
		}
		return line + g.pick([]string{" |", "", " "})
	}
	var lines []string
	if g.chance(0.3) {
		lines = append(lines, g.pick([]string{"Some text", "A *table*:", "Total"}))
	}
	lines = append(lines, row(cols))
	aligned := false
	cells := make([]string, cols)
	for i := range cells {
		cells[i] = g.pick([]string{"---", ":--", "--:", ":-:", "-", "---"})
		aligned = aligned || strings.Contains(cells[i], ":")
	}
	lines = append(lines, "|"+strings.Join(cells, "|")+"|")
	for range g.r.IntN(5) {
		n := cols + g.r.IntN(3)
		if !aligned {
			n = max(1, cols+g.r.IntN(4)-2)
		}
		lines = append(lines, row(n))
	}
	if g.chance(0.2) {
		lines = append(lines, g.pick([]string{"# Heading", "***", "> quote", "- item", "```\ncode\n```", "<div>"}))
	}
	return lines
}
