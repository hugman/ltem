package ltem

import (
	"sort"
	"strings"
)

// Result is the result of parsing a block of lines.
type Result struct {
	// Table is the table, or nil if the block holds no table.
	Table *Table
	// Problems holds the validation problems of the table (spec Section 5), in the
	// order they were found.
	Problems []Problem
	// Forms tells how each row was read.
	Forms []RowForm
	// Start is the index of the table's first line (its first header row) and End the
	// index just past its last line, both counted from the offset given to the parser.
	// Lines before Start stay a paragraph; lines from End on follow the table.
	Start, End int
	// Sources tells where each cell is, in the order of Table.Cells.
	Sources []CellSource
}

// ParseTable parses one block of text that may contain a table. The text is split
// at line feeds; see [ParseLines].
func ParseTable(block string) Result {
	return ParseLines(strings.Split(block, "\n"), 0)
}

// ParseLines parses one block of consecutive non-blank lines that may contain a
// table. A carriage return at the end of a line is ignored.
//
// A table may begin on any line of the block, as a GFM table may begin inside a
// paragraph. Delimiter rows are tried from the top, and the first one whose last
// header row fits makes the table (spec 2.3). The table ends before the first line
// that ends a table body (spec 2.4). Result.Start and Result.End give the table's
// lines, counted from offset; lines from Result.End on may hold another table.
func ParseLines(lines []string, offset int) Result {
	return parseLines(withoutCR(lines), offset)
}

// parseLines is ParseLines for lines without carriage returns.
func parseLines(lines []string, offset int) Result {
	for d := 1; d < len(lines); d++ {
		if result := tableAt(lines, d, offset); result.Table != nil {
			return result
		}
	}
	return Result{Start: offset, End: offset}
}

// TableAt parses the table whose delimiter row is lines[d], with header rows ending
// at lines[d-1] and body rows from lines[d+1]. Result.Table is nil if lines[d] is not
// the delimiter row of a table: it does not have the form of a delimiter row, the
// line above it cannot be the last header row (spec 2.3), or that row does not fit.
//
// Markdown parser integrations that see a paragraph's lines one at a time can call
// TableAt for each new line that has the form of a delimiter row; the first call that
// returns a table finds the same table as [ParseLines].
func TableAt(lines []string, d, offset int) Result {
	return tableAt(withoutCR(lines), d, offset)
}

// withoutCR returns the lines without the carriage returns at their ends, copying
// them only if there are any.
func withoutCR(lines []string) []string {
	for i, line := range lines {
		if strings.HasSuffix(line, "\r") {
			out := append([]string{}, lines...)
			for j := i; j < len(out); j++ {
				out[j] = strings.TrimRight(out[j], "\r")
			}
			return out
		}
	}
	return lines
}

// tableAt is TableAt for lines without carriage returns.
func tableAt(lines []string, d, offset int) Result {
	none := Result{Start: offset, End: offset}
	if d < 1 || d >= len(lines) {
		return none
	}
	// The last header row is a paragraph line, as in GFM: not indented as code, not
	// the start of another block such as a list item or heading, and not a setext
	// heading underline below another paragraph line (spec 2.3).
	if !IsDelimiterRow(lines[d]) || Indentation(lines[d-1]) >= 4 || StartsBlock(lines[d-1]) {
		return none
	}
	if d >= 2 && isSetextUnderline(lines[d-1]) && !StartsBlock(lines[d-2]) {
		return none
	}
	// Header rows: the line above the delimiter row, and the pipe-led lines above it.
	// A last header row in the form of a delimiter row is the only header row.
	top := d - 1
	if !IsDelimiterRow(lines[d-1]) {
		for top > 0 && IsUpperHeaderRow(lines[top-1]) {
			top--
		}
	}
	headerRows := d - top
	delimiter := SplitRow(lines[d])
	align := make([]Align, len(delimiter))
	for i, cell := range delimiter {
		align[i] = alignment(cell)
	}
	// The last header row must fit (spec 2.3). How it is read depends on the header
	// rows only, so they are tried on their own first: a block with many delimiter
	// rows that do not fit is then parsed in linear time.
	probe := newGrid(len(align), headerRows, headerRows)
	for r := range headerRows {
		if probe.addRow(r, SplitRow(lines[top+r])) == PaddedRow && r == headerRows-1 {
			return none
		}
	}

	end := d + 1
	for end < len(lines) && !EndsTableBody(lines[end]) {
		end++
	}
	// The cells of each row, with where they are in their line. Body rows follow the
	// delimiter row.
	rowLines := append(append([]int{}, seq(top, d)...), seq(d+1, end)...)
	spans := make([][]CellSpan, len(rowLines))
	g := newGrid(len(align), headerRows, len(rowLines))
	forms := make([]RowForm, len(rowLines))
	for r, line := range rowLines {
		spans[r] = SplitRowSpans(lines[line])
		texts := make([]string, len(spans[r]))
		for i, s := range spans[r] {
			texts[i] = s.Text
		}
		forms[r] = g.addRow(r, texts)
	}

	origins := g.origins
	sort.Slice(origins, func(i, j int) bool {
		return origins[i].row < origins[j].row || origins[i].row == origins[j].row && origins[i].col < origins[j].col
	})
	cells := make([]Cell, len(origins))
	sources := make([]CellSource, len(origins))
	for i, o := range origins {
		cells[i] = Cell{Row: o.row, Col: o.col, Rowspan: o.rowspan, Colspan: o.colspan, Text: cellText(o.text)}
		line := rowLines[o.row]
		start, stop := len(lines[line]), len(lines[line])
		if o.source >= 0 {
			start, stop = spans[o.row][o.source].Start, spans[o.row][o.source].End
		}
		sources[i] = CellSource{
			Row: o.row, Col: o.col, Rowspan: o.rowspan, Colspan: o.colspan,
			Line: offset + line, Start: start, End: stop,
		}
	}
	return Result{
		Table:    &Table{Rows: len(rowLines), Cols: len(align), HeaderRows: headerRows, Align: align, Cells: cells},
		Problems: g.problems,
		Forms:    forms,
		Start:    offset + top,
		End:      offset + end,
		Sources:  sources,
	}
}

// seq returns the integers from a up to, not including, b.
func seq(a, b int) []int {
	s := make([]int, 0, max(b-a, 0))
	for i := a; i < b; i++ {
		s = append(s, i)
	}
	return s
}

// FindTables finds the LTEM tables of a Markdown document.
//
// It is a light scan, not a full Markdown parser: it splits the text into blocks at
// blank lines (lines holding only spaces and tabs), skips fenced and indented code
// blocks and parses each block with [ParseLines]. It does not model containers such
// as block quotes and list items. Lines end at "\n", "\r\n" or "\r", as in CommonMark;
// Result.Start, Result.End and CellSource.Line count lines split that way. To render
// whole documents, use LTEM through a Markdown parser integration instead.
func FindTables(markdown string) []Result {
	var results []Result
	var block []string
	blockStart := 0
	fence := ""
	flush := func() {
		pending, offset := block, blockStart
		block = nil
		for len(pending) > 0 {
			result := parseLines(pending, offset)
			if result.Table == nil {
				return
			}
			results = append(results, result)
			pending, offset = pending[result.End-offset:], result.End
		}
	}
	for i, line := range splitLines(markdown) {
		if fence != "" {
			// A closing fence: the same character, at least as long, and nothing but
			// spaces and tabs after it (CommonMark).
			if run, after := fenceRun(line); run != "" && run[0] == fence[0] && len(run) >= len(fence) &&
				trim(line[after:]) == "" {
				fence = ""
			}
			continue
		}
		switch run, _ := fenceRun(line); {
		case run != "":
			flush()
			fence = run
		case trim(line) == "":
			flush()
		case len(block) == 0 && strings.HasPrefix(line, "    "):
			// an indented code block
		default:
			if len(block) == 0 {
				blockStart = i
			}
			block = append(block, line)
		}
	}
	flush()
	return results
}

// fenceRun returns the run of three or more backticks or tildes that opens a fenced
// code block after at most three spaces, and the index after it; or "" and 0.
func fenceRun(line string) (string, int) {
	n := leadingSpaces(line)
	if n > 3 || n == len(line) || line[n] != '`' && line[n] != '~' {
		return "", 0
	}
	end := n
	for end < len(line) && line[end] == line[n] {
		end++
	}
	if end-n < 3 {
		return "", 0
	}
	return line[n:end], end
}

// splitLines splits text at "\r\n", "\r" or "\n", the line endings of CommonMark.
func splitLines(text string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(text); i++ {
		switch text[i] {
		case '\n':
			lines = append(lines, text[start:i])
			start = i + 1
		case '\r':
			lines = append(lines, text[start:i])
			if i+1 < len(text) && text[i+1] == '\n' {
				i++
			}
			start = i + 1
		}
	}
	return append(lines, text[start:])
}
