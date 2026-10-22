package goldmarkltem

import (
	"bytes"
	"strings"

	gast "github.com/yuin/goldmark/v2/ast"
	extast "github.com/yuin/goldmark/v2/extension/ast"
	"github.com/yuin/goldmark/v2/parser"
	"github.com/yuin/goldmark/v2/text"
	"github.com/yuin/goldmark/v2/util"

	"github.com/hugman/ltem/ltem-lib/go/internal/gmtable"
	"github.com/hugman/ltem/ltem-lib/go/ltem"
)

// Context keys of a parse.
var (
	// pendingKey holds a table whose paragraph above had to be closed before the
	// table could be opened (see tableParser.Open).
	pendingKey = parser.NewContextKey()
	// linesKey holds the lines of the open paragraph as written (see paragraphLines).
	linesKey = parser.NewContextKey()
	// cellsKey holds the cells that the AST transformer finishes.
	cellsKey = parser.NewContextKey()
)

// pendingTable is a table found at the line whose segment starts at start.
type pendingTable struct {
	node  *tableBlock
	start int
}

// paragraphLines holds the continuation lines of the open paragraph as written, by
// the offset of their end. goldmark v2 removes the spaces at the start of each
// paragraph line, and LTEM needs them: a line indented by four or more columns cannot
// be a header row.
type paragraphLines struct {
	paragraph *gast.Paragraph
	byStop    map[int]text.Segment
}

// tableParser reads LTEM tables. A table begins when a line with the form of a
// delimiter row continues a paragraph whose last lines are header rows that fit
// (spec 2.3): those lines move from the paragraph into the table. Body rows follow
// until a line ends the table (spec 2.4), or a line where goldmark starts an HTML
// block that can interrupt a paragraph, as goldmark's own table would end there.
//
// The parser has no trigger characters and accepts indented lines, so that it sees
// every line that continues a paragraph, and records it as written.
type tableParser struct{}

func (tableParser) Trigger() []byte { return nil }

func (tableParser) CanInterruptParagraph() bool { return true }

func (tableParser) CanAcceptIndentedLine() bool { return true }

func (tableParser) Open(parent gast.Node, reader text.Reader, pc parser.Context) (gast.Node, parser.State) {
	_, segment := reader.PeekLine()
	if pending, ok := pc.Get(pendingKey).(*pendingTable); ok && pending != nil {
		pc.Set(pendingKey, nil)
		if pending.start == segment.Start {
			return pending.node, parser.NoChildren
		}
	}
	paragraph, ok := pc.LastOpenedBlock().Node.(*gast.Paragraph)
	if !ok {
		return nil, parser.NoChildren
	}
	written, _ := pc.Get(linesKey).(*paragraphLines)
	if written == nil || written.paragraph != paragraph {
		written = &paragraphLines{paragraph: paragraph, byStop: map[int]text.Segment{}}
		pc.Set(linesKey, written)
	}
	written.byStop[segment.Stop] = segment
	if paragraph.Parent() != parent { // a lazy continuation line
		return nil, parser.NoChildren
	}

	source := reader.Source()
	segments := paragraph.Source()
	original := func(i int) text.Segment {
		if s, ok := written.byStop[segments[i].Stop]; ok {
			return s
		}
		return segments[i] // the first line, whose indentation is at most three columns
	}
	n := len(segments)
	top, ok := gmtable.Start(n, func(i int) string { return lineValue(original(i), source) }, lineValue(segment, source))
	if !ok {
		return nil, parser.NoChildren
	}

	// The header rows leave the paragraph for the table.
	node := newTableBlock(n-top, original(top).Start)
	for i := top; i < n; i++ {
		node.AppendSource(original(i))
	}
	node.AppendSource(segment)
	if top == 0 {
		// goldmark closes the paragraph, which is no longer in the document, without
		// transforming it. It keeps its lines: goldmark v2 closes a paragraph without
		// lines by removing it from its parent, which it no longer has.
		parent.RemoveChild(paragraph)
		return node, parser.NoChildren
	}
	paragraph.SetSource(segments[:top:top])
	// The rest of the paragraph is closed first, so that its paragraph transformers
	// run (link reference definitions, for example). If they remove the paragraph,
	// goldmark tries this line again, and the table is opened then.
	pc.Set(pendingKey, &pendingTable{node: node, start: segment.Start})
	return node, parser.NoChildren | parser.RequireParagraph
}

func (tableParser) Continue(node gast.Node, reader text.Reader, pc parser.Context) parser.State {
	line, segment := reader.PeekLine()
	if util.IsBlank(line) || gmtable.Ends(lineValue(segment, reader.Source())) {
		return parser.Close
	}
	node.(*tableBlock).AppendSource(segment)
	reader.AdvanceToEOL()
	return parser.Continue | parser.NoChildren
}

func (tableParser) Close(node gast.Node, reader text.Reader, pc parser.Context) {
	block := node.(*tableBlock)
	source := reader.Source()
	segments := block.Source()
	lines := make([]string, len(segments))
	for i, s := range segments {
		lines[i] = lineValue(s, source)
	}
	table, cells := build(gmtable.Parse(lines, block.headerRows), segments)
	table.SetPos(block.start)
	table.SetBlankPreviousLines(block.HasBlankPreviousLines())
	block.Parent().ReplaceChild(block, table)
	if len(cells) > 0 {
		pending, _ := pc.Get(cellsKey).([]gast.Node)
		pc.Set(cellsKey, append(pending, cells...))
	}
}

// lineValue returns a line as the LTEM core reads it: its text, with spaces for a tab
// that a container used in part, without the line ending ("\n" or "\r\n").
func lineValue(segment text.Segment, source []byte) string {
	return strings.TrimRight(strings.TrimSuffix(segment.Str(source), "\n"), "\r")
}

// sourceOffset maps byte i of lineValue(segment, source) to its offset in source.
func sourceOffset(segment text.Segment, i int) int {
	return segment.Start + max(i-segment.Padding, 0)
}

// build returns the nodes of a table, and its cells that the AST transformer has to
// finish. A plain table gets the nodes of goldmark's table extension, other tables get
// LTEM table nodes.
func build(l gmtable.Layout, segments []text.Segment) (gast.BlockNode, []gast.Node) {
	alignments := make([]extast.Alignment, len(l.Align))
	for i, a := range l.Align {
		alignments[i] = alignment(a)
	}
	rows := make([]gast.BlockNode, l.Rows)
	for r := range rows {
		if l.Plain && r == 0 {
			rows[r] = extast.NewTableHeader()
		} else if l.Plain {
			rows[r] = extast.NewTableRow()
		} else {
			rows[r] = NewTableRow()
		}
		rows[r].SetPos(segments[l.RowLine(r)].Start)
	}
	var unfinished []gast.Node
	for _, c := range l.Cells {
		var cell gast.BlockNode
		if l.Plain {
			cell = extast.NewTableCell(alignments[c.Col])
		} else {
			lc := NewTableCell()
			lc.Row, lc.Col, lc.Rowspan, lc.Colspan = c.Row, c.Col, c.Rowspan, c.Colspan
			lc.Alignment, lc.Header = alignments[c.Col], c.Row < l.HeaderRows
			cell = lc
		}
		line := segments[c.Line]
		cell.SetPos(sourceOffset(line, c.Start))
		if addLines(cell, line, c.Lines) || c.EscapedPipe {
			unfinished = append(unfinished, cell)
		}
		rows[c.Row].AppendChild(cell)
	}

	var table, head, body gast.BlockNode
	if l.Plain {
		table, head, body = extast.NewTable(), rows[0], extast.NewTableBody()
	} else {
		table, head, body = NewTable(alignments), NewTableHead(), NewTableBody()
		head.SetPos(rows[0].Pos())
		for _, row := range rows[:l.HeaderRows] {
			head.AppendChild(row)
		}
	}
	table.AppendChild(head)
	if l.Rows > l.HeaderRows {
		body.SetPos(rows[l.HeaderRows].Pos())
		for _, row := range rows[l.HeaderRows:] {
			body.AppendChild(row)
		}
		table.AppendChild(body)
	}
	return table, unfinished
}

// addLines gives a cell the lines of its text, and reports whether it has several. A
// cell with one line gets it as its own line; a cell with several lines gets one
// cellLine child per line, so that each line is parsed as inlines on its own
// (spec 4.2), and the AST transformer joins them.
func addLines(cell gast.BlockNode, line text.Segment, spans []ltem.Span) bool {
	segment := func(s ltem.Span) text.Segment {
		return text.NewSegment(sourceOffset(line, s.Start), sourceOffset(line, s.End))
	}
	if len(spans) == 1 {
		if s := segment(spans[0]); !s.IsEmpty() {
			cell.AppendSource(s)
		}
		return false
	}
	for _, span := range spans {
		l := newCellLine()
		s := segment(span)
		l.SetPos(s.Start)
		if !s.IsEmpty() {
			l.AppendSource(s)
		}
		cell.AppendChild(l)
	}
	return true
}

// alignment converts an LTEM alignment to goldmark's.
func alignment(a ltem.Align) extast.Alignment {
	switch a {
	case ltem.AlignLeft:
		return extast.AlignLeft
	case ltem.AlignCenter:
		return extast.AlignCenter
	case ltem.AlignRight:
		return extast.AlignRight
	}
	return extast.AlignNone
}

// cellTransformer finishes the cells of LTEM tables after the inlines are parsed:
// it joins the lines of a cell with hard line breaks, and removes the backslash of
// \| in code spans, as goldmark's table extension does.
type cellTransformer struct{}

func (cellTransformer) Transform(_ *gast.Document, reader text.Reader, pc parser.Context) {
	cells, _ := pc.Get(cellsKey).([]gast.Node)
	pc.Set(cellsKey, nil)
	for _, cell := range cells {
		joinLines(cell, reader.Decoder())
		unescapePipes(cell, reader.Source())
	}
}

// joinLines moves the inlines of a cell's lines into the cell, with a hard line break
// between two lines.
func joinLines(cell gast.Node, decoder text.Decoder) {
	if _, ok := cell.FirstChild().(*cellLine); !ok {
		return
	}
	var lines []gast.Node
	for c := cell.FirstChild(); c != nil; c = c.NextSibling() {
		lines = append(lines, c)
	}
	cell.RemoveChildren()
	for i, line := range lines {
		if i > 0 {
			br := gast.NewText(text.NewSingleLineValueFromSegment(text.NewSegment(line.Pos(), line.Pos()), decoder))
			br.SetHardLineBreak(true)
			cell.AppendChild(br)
		}
		for c := line.FirstChild(); c != nil; {
			next := c.NextSibling()
			cell.AppendChild(c)
			c = next
		}
	}
}

// unescapePipes removes the backslash before each | in the code spans of a cell.
func unescapePipes(cell gast.Node, source []byte) {
	_ = gast.Walk(cell, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if cs, ok := n.(*gast.CodeSpan); ok && entering {
			if raw := cs.Value.Bytes(source); bytes.Contains(raw, []byte(`\|`)) {
				fixed := bytes.ReplaceAll(raw, []byte(`\|`), []byte(`|`))
				cs.Value = text.NewMultiLineValueFromString(string(fixed), text.IdentityDecoder)
			}
		}
		return gast.WalkContinue, nil
	})
}
