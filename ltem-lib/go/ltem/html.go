package ltem

import (
	"sort"
	"strconv"
	"strings"
)

// InlineRenderer renders one line of cell text, which is inline Markdown, as HTML.
type InlineRenderer func(text string) string

// PlainInline renders inline text with CommonMark backslash escapes and HTML
// escaping only: emphasis, links and code are left as written. It is the default
// renderer of [RenderHTML].
func PlainInline(text string) string {
	var b strings.Builder
	for i := 0; i < len(text); i++ {
		c := text[i]
		if c == '\\' && i+1 < len(text) && isASCIIPunctuation(text[i+1]) {
			i++
			c = text[i]
		}
		switch c {
		case '&':
			b.WriteString("&amp;")
		case '<':
			b.WriteString("&lt;")
		case '>':
			b.WriteString("&gt;")
		case '"':
			b.WriteString("&quot;")
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}

func isASCIIPunctuation(c byte) bool {
	return '!' <= c && c <= '/' || ':' <= c && c <= '@' || '[' <= c && c <= '`' || '{' <= c && c <= '~'
}

// RenderHTML renders a table as HTML, in the format of the specification's examples
// (spec Section 6): a <thead> with every header row, a <tbody> with every body row if
// there are any, colspan and rowspan attributes, and alignment as align attributes.
//
// inline renders one line of cell text; the lines of a cell are joined with <br />.
// If inline is nil, [PlainInline] is used.
func RenderHTML(t *Table, inline InlineRenderer) string {
	if inline == nil {
		inline = PlainInline
	}
	byRow := make([][]Cell, t.Rows)
	for _, cell := range t.Cells {
		if cell.Row >= 0 && cell.Row < t.Rows {
			byRow[cell.Row] = append(byRow[cell.Row], cell)
		}
	}
	for _, cells := range byRow {
		sort.SliceStable(cells, func(i, j int) bool { return cells[i].Col < cells[j].Col })
	}
	var b strings.Builder
	row := func(r int) {
		tag := "td"
		if r < t.HeaderRows {
			tag = "th"
		}
		b.WriteString("<tr>\n")
		for _, cell := range byRow[r] {
			b.WriteString("<" + tag)
			if cell.Colspan > 1 {
				b.WriteString(` colspan="` + strconv.Itoa(cell.Colspan) + `"`)
			}
			if cell.Rowspan > 1 {
				b.WriteString(` rowspan="` + strconv.Itoa(cell.Rowspan) + `"`)
			}
			if cell.Col >= 0 && cell.Col < len(t.Align) && t.Align[cell.Col] != AlignNone {
				b.WriteString(` align="` + t.Align[cell.Col].String() + `"`)
			}
			b.WriteString(">")
			for i, line := range strings.Split(cell.Text, "\n") {
				if i > 0 {
					b.WriteString("<br />")
				}
				b.WriteString(inline(line))
			}
			b.WriteString("</" + tag + ">\n")
		}
		b.WriteString("</tr>\n")
	}
	b.WriteString("<table>\n<thead>\n")
	for r := 0; r < min(t.HeaderRows, t.Rows); r++ {
		row(r)
	}
	b.WriteString("</thead>\n")
	if t.Rows > t.HeaderRows {
		b.WriteString("<tbody>\n")
		for r := max(t.HeaderRows, 0); r < t.Rows; r++ {
			row(r)
		}
		b.WriteString("</tbody>\n")
	}
	b.WriteString("</table>")
	return b.String()
}
