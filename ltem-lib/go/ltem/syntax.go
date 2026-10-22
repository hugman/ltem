package ltem

import (
	"math"
	"strings"
)

// The markers of spec 2.5.
const (
	colspanMarker = "<<"
	rowspanMarker = "^^"
)

func isSpaceOrTab(b byte) bool { return b == ' ' || b == '\t' }

func isDigit(b byte) bool { return '0' <= b && b <= '9' }

// trim removes leading and trailing spaces and tabs, and no other whitespace: the
// "trim" of spec 2.1.
func trim(s string) string { return strings.Trim(s, " \t") }

func trimRight(s string) string { return strings.TrimRight(s, " \t") }

// leadingSpaces counts the spaces (not tabs) at the start of s.
func leadingSpaces(s string) int {
	n := 0
	for n < len(s) && s[n] == ' ' {
		n++
	}
	return n
}

// CellSpan is a cell of a row, as [SplitRowSpans] finds it.
type CellSpan struct {
	// Text is the cell's text, trimmed of spaces and tabs, with each \| read as |.
	Text string
	// Start and End are byte offsets in the line, so line[Start:End] is the cell's
	// source without the spaces and tabs around it. For an empty cell both are the
	// end of its space between the pipes.
	Start, End int
}

// SplitRowSpans splits a row into cells as GFM does (spec 2.1), keeping where each
// cell is in the line.
//
// A leading and a trailing pipe are optional. A pipe preceded by a backslash does not
// split cells and becomes a literal pipe.
func SplitRowSpans(line string) []CellSpan {
	b, e := 0, len(line)
	for b < e && isSpaceOrTab(line[b]) {
		b++
	}
	for e > b && isSpaceOrTab(line[e-1]) {
		e--
	}
	if b < e && line[b] == '|' {
		b++
	}
	if e > b && line[e-1] == '|' && !(e-2 >= b && line[e-2] == '\\') {
		e--
	}
	var cells []CellSpan
	var text strings.Builder
	start := b
	for i := b; i < e; {
		switch {
		case line[i] == '\\' && i+1 < e && line[i+1] == '|':
			text.WriteByte('|')
			i += 2
		case line[i] == '|':
			cells = append(cells, cellSpan(line, start, i, text.String()))
			text.Reset()
			i++
			start = i
		default:
			text.WriteByte(line[i])
			i++
		}
	}
	return append(cells, cellSpan(line, start, e, text.String()))
}

func cellSpan(line string, start, end int, text string) CellSpan {
	for start < end && isSpaceOrTab(line[start]) {
		start++
	}
	for end > start && isSpaceOrTab(line[end-1]) {
		end--
	}
	return CellSpan{Text: trim(text), Start: start, End: end}
}

// SplitRow splits a row into trimmed cell texts as GFM does (spec 2.1). See
// [SplitRowSpans].
func SplitRow(line string) []string {
	spans := SplitRowSpans(line)
	texts := make([]string, len(spans))
	for i, s := range spans {
		texts[i] = s.Text
	}
	return texts
}

// Indentation returns the width of the spaces and tabs at the start of a line, with
// tab stops every four columns (spec 2.1).
func Indentation(line string) int {
	width := 0
	for i := 0; i < len(line); i++ {
		switch line[i] {
		case ' ':
			width++
		case '\t':
			width += 4 - width%4
		default:
			return width
		}
	}
	return width
}

// isDelimiterCell reports whether a trimmed cell is hyphens with an optional colon
// at either end (spec 2.2).
func isDelimiterCell(cell string) bool {
	start, end := 0, len(cell)
	if end > 0 && cell[0] == ':' {
		start = 1
	}
	if end > start && cell[end-1] == ':' {
		end--
	}
	return start < end && strings.Count(cell[start:end], "-") == end-start
}

// isListDash reports whether a line begins a list item with a dash, such as "- | -".
func isListDash(line string) bool {
	n := leadingSpaces(line)
	return n <= 3 && n+1 < len(line) && line[n] == '-' && isSpaceOrTab(line[n+1])
}

// IsDelimiterRow reports whether a line has the form of a delimiter row (spec 2.2):
// it contains a pipe, is indented by at most three columns, does not begin a list
// item, and each of its cells is hyphens with an optional colon at either end.
func IsDelimiterRow(line string) bool {
	if !strings.Contains(line, "|") || Indentation(line) >= 4 || isListDash(line) {
		return false
	}
	for _, cell := range SplitRow(line) {
		if !isDelimiterCell(cell) {
			return false
		}
	}
	return true
}

// isPipeLed reports whether a line begins with a pipe after at most three spaces.
func isPipeLed(line string) bool {
	n := leadingSpaces(line)
	return n <= 3 && n < len(line) && line[n] == '|'
}

// isIdentifierRow reports whether a line is a reserved identifier line (spec
// Section 9): "| # identifier |", with optional spaces and tabs.
func isIdentifierRow(line string) bool {
	i := leadingSpaces(line)
	blanks := func() int {
		start := i
		for i < len(line) && isSpaceOrTab(line[i]) {
			i++
		}
		return i - start
	}
	if i > 3 || i >= len(line) || line[i] != '|' {
		return false
	}
	i++
	blanks()
	if i >= len(line) || line[i] != '#' {
		return false
	}
	i++
	if blanks() == 0 || i >= len(line) || !isIdentifierStart(line[i]) {
		return false
	}
	for i++; i < len(line) && (isIdentifierStart(line[i]) || isDigit(line[i])); i++ {
	}
	blanks()
	if i >= len(line) || line[i] != '|' {
		return false
	}
	i++
	blanks()
	return i == len(line)
}

func isIdentifierStart(b byte) bool {
	return 'a' <= b && b <= 'z' || 'A' <= b && b <= 'Z' || b == '_'
}

// IsUpperHeaderRow reports whether a line can be a header row above the last one
// (spec 2.3, Section 9): it begins with a pipe after at most three spaces, does not
// have the form of a delimiter row, and is not a reserved identifier line.
func IsUpperHeaderRow(line string) bool {
	return isPipeLed(line) && !isIdentifierRow(line) && !IsDelimiterRow(line)
}

// isSetextUnderline reports whether a line is a setext heading underline: one or
// more "=" or one or more "-" after at most three spaces, then only spaces and tabs.
func isSetextUnderline(line string) bool {
	n := leadingSpaces(line)
	if n > 3 {
		return false
	}
	body := trimRight(line[n:])
	if body == "" || body[0] != '=' && body[0] != '-' {
		return false
	}
	return strings.Count(body, body[:1]) == len(body)
}

// StartsBlock reports whether a line begins a block (spec 2.3): after at most three
// spaces it starts a block quote, an ATX heading, a fenced code block, a thematic
// break or a list item. The test looks at the line alone.
func StartsBlock(line string) bool {
	n := leadingSpaces(line)
	if n > 3 || n == len(line) {
		return false
	}
	rest := line[n:]
	first := rest[0]
	run := 1
	for run < len(rest) && rest[run] == first {
		run++
	}
	switch first {
	case '>':
		return true
	case '#':
		return run <= 6 && spaceOrEnd(rest, run)
	case '`', '~':
		return run >= 3
	}
	return isThematicBreak(rest) || isListMarker(rest)
}

// spaceOrEnd reports whether s has a space or tab at index i, or ends there.
func spaceOrEnd(s string, i int) bool {
	return i == len(s) || isSpaceOrTab(s[i])
}

// isThematicBreak reports whether s is three or more "-", "*" or "_" of one kind,
// possibly separated by spaces and tabs, and nothing else.
func isThematicBreak(s string) bool {
	c := s[0]
	if c != '-' && c != '*' && c != '_' {
		return false
	}
	count := 0
	for i := 0; i < len(s); i++ {
		switch {
		case s[i] == c:
			count++
		case !isSpaceOrTab(s[i]):
			return false
		}
	}
	return count >= 3
}

// isListMarker reports whether s starts with a bullet ("-", "+", "*") or an ordered
// list marker (one to nine digits and "." or ")"), followed by a space, a tab or the
// end of s.
func isListMarker(s string) bool {
	switch s[0] {
	case '-', '+', '*':
		return spaceOrEnd(s, 1)
	}
	digits := 0
	for digits < len(s) && isDigit(s[digits]) {
		digits++
	}
	return digits >= 1 && digits <= 9 && digits < len(s) &&
		(s[digits] == '.' || s[digits] == ')') && spaceOrEnd(s, digits+1)
}

// EndsTableBody reports whether a table body ends before this line (spec 2.4): the
// line is blank, indented by four or more columns, or begins a block.
func EndsTableBody(line string) bool {
	return trim(line) == "" || Indentation(line) >= 4 || StartsBlock(line)
}

// alignment returns the alignment a delimiter cell sets (spec 2.2).
func alignment(cell string) Align {
	left, right := strings.HasPrefix(cell, ":"), strings.HasSuffix(cell, ":")
	switch {
	case left && right:
		return AlignCenter
	case right:
		return AlignRight
	case left:
		return AlignLeft
	}
	return AlignNone
}

// spanValue is one value of a span attribute.
type spanValue struct {
	n      int    // the value, saturated at math.MaxInt
	digits string // the value as written, for messages
}

// spanAttribute is a parsed span attribute (spec 2.6).
type spanAttribute struct {
	colspan, rowspan *spanValue
	problems         []string // V1 problems
}

// attributeBrace returns the index of the "{" of a suffix of text that has the form
// of a span attribute, {c:N} or {r:M,c:N} and so on, or -1. It does not look at what
// comes before the "{".
func attributeBrace(text string) int {
	if !strings.HasSuffix(text, "}") {
		return -1
	}
	open := strings.LastIndexByte(text, '{')
	if open < 0 {
		return -1
	}
	for _, item := range strings.Split(text[open+1:len(text)-1], ",") {
		if len(item) < 3 || item[0] != 'c' && item[0] != 'r' || item[1] != ':' {
			return -1
		}
		for i := 2; i < len(item); i++ {
			if !isDigit(item[i]) {
				return -1
			}
		}
	}
	return open
}

// findSpanAttribute returns the index where a trailing span attribute begins, or -1.
// The attribute ends the text and is the whole text or follows a space or tab
// (spec 2.6).
func findSpanAttribute(text string) int {
	open := attributeBrace(text)
	if open > 0 && !isSpaceOrTab(text[open-1]) {
		return -1
	}
	return open
}

// splitAttribute removes a trailing span attribute from a content cell (spec 2.6). It
// returns the remaining text and the attribute, or the text and nil.
func splitAttribute(text string) (string, *spanAttribute) {
	open := findSpanAttribute(text)
	if open < 0 {
		return text, nil
	}
	attr := &spanAttribute{}
	for _, item := range strings.Split(text[open+1:len(text)-1], ",") {
		key, digits := item[0], item[2:]
		value := &spanValue{n: parseSpan(digits), digits: digits}
		if value.n < 1 {
			attr.problems = append(attr.problems, "span value must be a positive integer, got "+digits)
			value = &spanValue{n: 1, digits: "1"}
		}
		slot := &attr.colspan
		if key == 'r' {
			slot = &attr.rowspan
		}
		if *slot != nil {
			attr.problems = append(attr.problems, "'"+string(key)+"' appears more than once")
			continue
		}
		*slot = value
	}
	return trimRight(text[:open]), attr
}

// parseSpan reads decimal digits, saturating at math.MaxInt.
func parseSpan(digits string) int {
	n := 0
	for i := 0; i < len(digits); i++ {
		d := int(digits[i] - '0')
		if n > (math.MaxInt-d)/10 {
			return math.MaxInt
		}
		n = n*10 + d
	}
	return n
}

// unescape removes the backslash of an LTEM escape (spec 4.3) from one trimmed line
// of a cell: a line "\<<" or "\^^", or a "\" before a span attribute at the end of the
// line that is the first character or follows a space or tab.
func unescape(line string) string {
	if line == `\`+colspanMarker || line == `\`+rowspanMarker {
		return line[1:]
	}
	if open := attributeBrace(line); open >= 1 && line[open-1] == '\\' &&
		(open == 1 || isSpaceOrTab(line[open-2])) {
		return line[:open-1] + line[open:]
	}
	return line
}

// cellText turns the text of a cell, without its span attribute, into model text
// (spec Section 7): it is split at each \\, and each line is trimmed and unescaped.
func cellText(text string) string {
	lines := strings.Split(text, `\\`)
	for i, line := range lines {
		lines[i] = unescape(trim(line))
	}
	return strings.Join(lines, "\n")
}

// Span is a range of bytes [Start, End).
type Span struct {
	Start, End int
}

// CellLineSpans splits the source of one cell into the lines of its text (spec 4.2)
// and returns, for each line, where it is in source.
//
// source is a cell's source as [CellSource] or [SplitRowSpans] locate it. Each span
// excludes the spaces and tabs around the line, the \\ line breaks and the span
// attribute. The line of model text is the span's source with each \| read as | and
// the backslash of an LTEM escape (spec 4.3) removed. A Markdown parser integration
// can give the spans to its inline parser, so that positions stay in the document.
func CellLineSpans(source string) []Span {
	// The cell's text with, for each byte, where it starts in source: a \| becomes
	// a | that starts at its backslash.
	text := make([]byte, 0, len(source))
	from := make([]int, 0, len(source)+1)
	for i := 0; i < len(source); i++ {
		from = append(from, i)
		if source[i] == '\\' && i+1 < len(source) && source[i+1] == '|' {
			i++
		}
		text = append(text, source[i])
	}
	from = append(from, len(source))

	start, end := 0, len(text)
	for start < end && isSpaceOrTab(text[start]) {
		start++
	}
	for end > start && isSpaceOrTab(text[end-1]) {
		end--
	}
	if open := findSpanAttribute(string(text[start:end])); open >= 0 {
		end = start + open
		for end > start && isSpaceOrTab(text[end-1]) {
			end--
		}
	}
	var spans []Span
	add := func(a, b int) {
		for a < b && isSpaceOrTab(text[a]) {
			a++
		}
		for b > a && isSpaceOrTab(text[b-1]) {
			b--
		}
		spans = append(spans, Span{from[a], from[b]})
	}
	part := start
	for i := start; i+1 < end; i++ {
		if text[i] == '\\' && text[i+1] == '\\' {
			add(part, i)
			i++
			part = i + 1
		}
	}
	add(part, end)
	return spans
}
