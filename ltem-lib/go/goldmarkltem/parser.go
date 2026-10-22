package goldmarkltem

import (
	"strings"

	gast "github.com/yuin/goldmark/ast"
	extast "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"

	"github.com/hugman/ltem/ltem-lib/go/internal/gmtable"
	"github.com/hugman/ltem/ltem-lib/go/ltem"
)

// Context keys of a parse.
var (
	// pendingKey holds a table whose paragraph above had to be closed before the
	// table could be opened (see tableParser.Open).
	pendingKey = parser.NewContextKey()
	// cellsKey holds the cells that the AST transformer finishes.
	cellsKey = parser.NewContextKey()
)

// pendingTable is a table found at the line whose segment starts at start.
type pendingTable struct {
	node  *tableBlock
	start int
}

// tableParser reads LTEM tables. A table begins when a line with the form of a
// delimiter row continues a paragraph whose last lines are header rows that fit
// (spec 2.3): those lines move from the paragraph into the table. Body rows follow
// until a line ends the table (spec 2.4), or a line where goldmark starts an HTML
// block that can interrupt a paragraph, as goldmark's own table would end there.
type tableParser struct{}

func (tableParser) Trigger() []byte { return []byte{'|', ':', '-'} }

func (tableParser) CanInterruptParagraph() bool { return true }

func (tableParser) CanAcceptIndentedLine() bool { return false }

func (tableParser) Open(parent gast.Node, reader text.Reader, pc parser.Context) (gast.Node, parser.State) {
	_, segment := reader.PeekLine()
	if pending, ok := pc.Get(pendingKey).(*pendingTable); ok && pending != nil {
		pc.Set(pendingKey, nil)
		if pending.start == segment.Start {
			return pending.node, parser.NoChildren
		}
	}
	paragraph, ok := pc.LastOpenedBlock().Node.(*gast.Paragraph)
	if !ok || paragraph.Parent() != parent {
		return nil, parser.NoChildren
	}
	source := reader.Source()
	segments := paragraph.Lines()
	n := segments.Len()
	top, ok := gmtable.Start(n, func(i int) string { return lineValue(segments.At(i), source) }, lineValue(segment, source))
	if !ok {
		return nil, parser.NoChildren
	}

	// The header rows leave the paragraph for the table.
	node := &tableBlock{headerRows: n - top, start: segments.At(top).Start}
	for i := top; i < n; i++ {
		node.Lines().Append(segments.At(i))
	}
	node.Lines().Append(segment)
	segments.SetSliced(0, top)
	if top == 0 {
		// goldmark drops the emptied paragraph, which is no longer in the document,
		// without transforming it.
		parent.RemoveChild(parent, paragraph)
		return node, parser.NoChildren
	}
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
	node.Lines().Append(segment)
	reader.Advance(segment.Len() - 1)
	return parser.Continue | parser.NoChildren
}

func (tableParser) Close(node gast.Node, reader text.Reader, pc parser.Context) {
	block := node.(*tableBlock)
	source := reader.Source()
	segments := block.Lines()
	lines := make([]string, segments.Len())
	for i := range lines {
		lines[i] = lineValue(segments.At(i), source)
	}
	table, cells := build(gmtable.Parse(lines, block.headerRows), segments)
	table.SetPos(block.start)
	table.SetBlankPreviousLines(block.HasBlankPreviousLines())
	block.Parent().ReplaceChild(block.Parent(), block, table)
	if len(cells) > 0 {
		pending, _ := pc.Get(cellsKey).([]gast.Node)
		pc.Set(cellsKey, append(pending, cells...))
	}
}

// lineValue returns a line as the LTEM core reads it: its text, with spaces for a tab
// that a container used in part, without the line ending ("\n" or "\r\n").
func lineValue(segment text.Segment, source []byte) string {
	return strings.TrimRight(strings.TrimSuffix(string(segment.Value(source)), "\n"), "\r")
}

// sourceOffset maps byte i of lineValue(segment, source) to its offset in source.
func sourceOffset(segment text.Segment, i int) int {
	return segment.Start + max(i-segment.Padding, 0)
}

// build returns the nodes of a table, and its cells that the AST transformer has to
// finish. A plain table gets the nodes of goldmark's table extension, other tables get
// LTEM table nodes.
func build(l gmtable.Layout, segments *text.Segments) (gast.Node, []gast.Node) {
	alignments := make([]extast.Alignment, len(l.Align))
	for i, a := range l.Align {
		alignments[i] = alignment(a)
	}
	rows := make([]gast.Node, l.Rows)
	for r := range rows {
		if l.Plain {
			rows[r] = extast.NewTableRow(alignments)
		} else {
			rows[r] = NewTableRow()
		}
		rows[r].SetPos(segments.At(l.RowLine(r)).Start)
	}
	var unfinished []gast.Node
	for _, c := range l.Cells {
		var cell gast.Node
		if l.Plain {
			gc := extast.NewTableCell()
			gc.Alignment = alignments[c.Col]
			cell = gc
		} else {
			lc := NewTableCell()
			lc.Row, lc.Col, lc.Rowspan, lc.Colspan = c.Row, c.Col, c.Rowspan, c.Colspan
			lc.Alignment, lc.Header = alignments[c.Col], c.Row < l.HeaderRows
			cell = lc
		}
		line := segments.At(c.Line)
		cell.SetPos(sourceOffset(line, c.Start))
		if addLines(cell, line, c.Lines) || c.EscapedPipe {
			unfinished = append(unfinished, cell)
		}
		rows[c.Row].AppendChild(rows[c.Row], cell)
	}

	if l.Plain {
		table := extast.NewTable()
		table.Alignments = alignments
		table.AppendChild(table, extast.NewTableHeader(rows[0].(*extast.TableRow)))
		for _, row := range rows[1:] {
			table.AppendChild(table, row)
		}
		return table, unfinished
	}
	table := NewTable(alignments)
	head := NewTableHead()
	head.SetPos(rows[0].Pos())
	table.AppendChild(table, head)
	var section gast.Node = head
	for r, row := range rows {
		if r == l.HeaderRows {
			body := NewTableBody()
			body.SetPos(row.Pos())
			table.AppendChild(table, body)
			section = body
		}
		section.AppendChild(section, row)
	}
	return table, unfinished
}

// addLines gives a cell the lines of its text, and reports whether it has several. A
// cell with one line gets it as its own line; a cell with several lines gets one
// cellLine child per line, so that each line is parsed as inlines on its own
// (spec 4.2), and the AST transformer joins them.
func addLines(cell gast.Node, line text.Segment, spans []ltem.Span) bool {
	segment := func(s ltem.Span) text.Segment {
		return text.NewSegment(sourceOffset(line, s.Start), sourceOffset(line, s.End))
	}
	if len(spans) == 1 {
		if s := segment(spans[0]); !s.IsEmpty() {
			cell.Lines().Append(s)
		}
		return false
	}
	for _, span := range spans {
		l := &cellLine{}
		s := segment(span)
		l.SetPos(s.Start)
		if !s.IsEmpty() {
			l.Lines().Append(s)
		}
		cell.AppendChild(cell, l)
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
		joinLines(cell)
		unescapePipes(cell, reader.Source())
	}
}

// joinLines moves the inlines of a cell's lines into the cell, with a hard line break
// between two lines.
func joinLines(cell gast.Node) {
	if _, ok := cell.FirstChild().(*cellLine); !ok {
		return
	}
	var lines []gast.Node
	for c := cell.FirstChild(); c != nil; c = c.NextSibling() {
		lines = append(lines, c)
	}
	cell.RemoveChildren(cell)
	for i, line := range lines {
		if i > 0 {
			br := gast.NewTextSegment(text.NewSegment(line.Pos(), line.Pos()))
			br.SetHardLineBreak(true)
			cell.AppendChild(cell, br)
		}
		for c := line.FirstChild(); c != nil; {
			next := c.NextSibling()
			cell.AppendChild(cell, c)
			c = next
		}
	}
}

// unescapePipes removes the backslash before each | in the code spans of a cell.
func unescapePipes(cell gast.Node, source []byte) {
	_ = gast.Walk(cell, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if !entering || n.Kind() != gast.KindCodeSpan {
			return gast.WalkContinue, nil
		}
		for c := n.FirstChild(); c != nil; {
			next := c.NextSibling()
			if t, ok := c.(*gast.Text); ok {
				splitAtEscapedPipes(n, t, source)
			}
			c = next
		}
		return gast.WalkSkipChildren, nil
	})
}

// splitAtEscapedPipes replaces a text node of a code span by the pieces of its
// segment between the backslashes of escaped pipes.
func splitAtEscapedPipes(parent gast.Node, t *gast.Text, source []byte) {
	seg := t.Segment
	start := seg.Start
	for i := seg.Start; i+1 < seg.Stop; i++ {
		if source[i] == '\\' && source[i+1] == '|' {
			parent.InsertBefore(parent, t, gast.NewRawTextSegment(text.NewSegment(start, i)))
			start = i + 1
		}
	}
	if start != seg.Start {
		parent.InsertBefore(parent, t, gast.NewRawTextSegment(text.NewSegment(start, seg.Stop)))
		parent.RemoveChild(parent, t)
	}
}
