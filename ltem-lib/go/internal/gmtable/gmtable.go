// Package gmtable holds the parts of the goldmark extensions for LTEM that do not
// depend on the goldmark version: where a table begins and ends, and how its cells map
// to its lines. The extensions for goldmark v1 and v2 turn the result into nodes.
//
// Lines are given as values: the text of a line as goldmark holds it, with spaces for
// a tab that a container used in part, without the line ending.
package gmtable

import (
	"regexp"
	"strings"

	"github.com/hugman/ltem/ltem-lib/go/ltem"
)

// Start reports whether line continues a paragraph of n lines as the delimiter row
// of a table (spec 2.3); value(i) returns line i of the paragraph. If it does, Start
// returns the index of the paragraph line that is the table's first header row.
//
// Only the lines that can be header rows are read: the last line, the run of
// pipe-led lines above it, and the line above that run. So a paragraph with many
// lines that look like delimiter rows is read in linear time.
func Start(n int, value func(i int) string, line string) (int, bool) {
	if n == 0 || !ltem.IsDelimiterRow(line) {
		return 0, false
	}
	first := n - 1
	if !ltem.IsDelimiterRow(value(first)) {
		for first > 0 && ltem.IsUpperHeaderRow(value(first-1)) {
			first--
		}
	}
	from := max(first-1, 0) // the line above tells whether the last one is a setext underline
	lines := make([]string, 0, n-from+1)
	for i := from; i < n; i++ {
		lines = append(lines, value(i))
	}
	r := ltem.TableAt(append(lines, line), n-from, 0)
	return from + r.Start, r.Table != nil
}

// Ends reports whether a table body ends before a line: the line ends it by the rules
// of LTEM (spec 2.4), or goldmark starts an HTML block that interrupts a paragraph
// there, as goldmark's table extension ends a table there too.
func Ends(line string) bool {
	return ltem.EndsTableBody(line) || startsHTMLBlock(line)
}

// Layout is a parsed table, ready to become goldmark nodes.
type Layout struct {
	// Plain is set for a table with one header row and no merged cells, which the
	// extensions build from goldmark's own table nodes.
	Plain bool
	// Rows and HeaderRows count the grid rows and the header rows.
	Rows, HeaderRows int
	// Align holds the alignment of each column.
	Align []ltem.Align
	// Cells holds the cells in row and column order.
	Cells []Cell
}

// Cell is a cell of a Layout.
type Cell struct {
	// Row, Col, Rowspan and Colspan place the cell in the grid.
	Row, Col, Rowspan, Colspan int
	// Line is the index of the line of the cell's source among the table's lines, and
	// Start the byte offset of the source in that line.
	Line, Start int
	// Lines holds the lines of the cell's text (spec 4.2) as byte ranges of its line:
	// the source as written, with any \| and LTEM escape. goldmark parses each line as
	// inlines; a CommonMark backslash escape renders the character it escapes.
	Lines []ltem.Span
	// EscapedPipe is set when the cell's source holds a \|. Every | in a cell's source
	// is escaped, since a | without a backslash would end the cell.
	EscapedPipe bool
}

// Parse lays out the table whose lines are given: headerRows header rows, the
// delimiter row and the body rows, as Start and Ends found them.
func Parse(lines []string, headerRows int) Layout {
	r := ltem.TableAt(lines, headerRows, 0)
	t := r.Table
	l := Layout{Plain: t.HeaderRows == 1, Rows: t.Rows, HeaderRows: t.HeaderRows, Align: t.Align}
	for i, c := range t.Cells {
		s := r.Sources[i]
		source := lines[s.Line][s.Start:s.End]
		spans := ltem.CellLineSpans(source)
		for j := range spans {
			spans[j].Start += s.Start
			spans[j].End += s.Start
		}
		l.Cells = append(l.Cells, Cell{
			Row: c.Row, Col: c.Col, Rowspan: c.Rowspan, Colspan: c.Colspan,
			Line: s.Line, Start: s.Start, Lines: spans, EscapedPipe: strings.Contains(source, "|"),
		})
		l.Plain = l.Plain && c.Rowspan == 1 && c.Colspan == 1
	}
	return l
}

// RowLine returns the index of the line of grid row r: header rows come first, body
// rows after the delimiter row.
func (l Layout) RowLine(r int) int {
	if r >= l.HeaderRows {
		return r + 1
	}
	return r
}

// The starts of the HTML blocks that can interrupt a paragraph (CommonMark types 1
// to 6), as goldmark's HTML block parser matches them.
var (
	htmlBlockStarts = []*regexp.Regexp{
		regexp.MustCompile(`(?i)^[ ]{0,3}<(script|pre|style|textarea)(?:\s.*|>.*|/>.*|)$`),
		regexp.MustCompile(`^[ ]{0,3}<!\-\-`),
		regexp.MustCompile(`^[ ]{0,3}<\?`),
		regexp.MustCompile(`^[ ]{0,3}<![A-Z]+.*$`),
		regexp.MustCompile(`^[ ]{0,3}<\!\[CDATA\[`),
	}
	// A line that is one tag, and a line that begins with a tag name.
	htmlTagOnly = regexp.MustCompile(`^[ ]{0,3}<(?:/[ ]*)?([a-zA-Z]+[a-zA-Z0-9\-]*)` +
		`(?:[\r\n \t]+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:[\r\n \t]*=[\r\n \t]*(?:[^\"'=<>` + "`" + `\x00-\x20]+|'[^']*'|"[^"]*"))?)*` +
		`[ ]*(?:>|/>)[ ]*$`)
	htmlTagStart = regexp.MustCompile(`^[ ]{0,3}<(?:/[ ]*)?([a-zA-Z]+[a-zA-Z0-9\-]*)(?:[ ].*|>.*|/>.*|)$`)
	htmlTags     = map[string]bool{}
)

func init() {
	for _, tag := range strings.Fields(`address article aside base basefont blockquote body caption center col
		colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3
		h4 h5 h6 head header hr html iframe legend li link main menu menuitem meta nav noframes ol optgroup
		option p param search section summary table tbody td tfoot th thead title tr track ul`) {
		htmlTags[tag] = true
	}
}

// startsHTMLBlock reports whether goldmark starts an HTML block at a line that
// follows a paragraph.
func startsHTMLBlock(line string) bool {
	for _, re := range htmlBlockStarts {
		if re.MatchString(line) {
			return true
		}
	}
	for _, re := range []*regexp.Regexp{htmlTagOnly, htmlTagStart} {
		if m := re.FindStringSubmatch(line); m != nil && htmlTags[strings.ToLower(m[1])] {
			return true
		}
	}
	return false
}
