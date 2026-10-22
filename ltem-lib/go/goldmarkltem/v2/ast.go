package goldmarkltem

import (
	gast "github.com/yuin/goldmark/v2/ast"
	extast "github.com/yuin/goldmark/v2/extension/ast"
)

// The node kinds of LTEM tables with merged cells or several header rows.
var (
	KindTable     = gast.NewNodeKind("LTEMTable")
	KindTableHead = gast.NewNodeKind("LTEMTableHead")
	KindTableBody = gast.NewNodeKind("LTEMTableBody")
	KindTableRow  = gast.NewNodeKind("LTEMTableRow")
	KindTableCell = gast.NewNodeKind("LTEMTableCell")
)

// Table is an LTEM table that has merged cells or several header rows. Its children
// are a [TableHead] and, if the table has body rows, a [TableBody].
//
// A table without merged cells and with one header row is built from the nodes of
// goldmark's table extension instead (extension/ast.Table, TableHeader, TableBody,
// TableRow and TableCell), exactly as that extension builds it.
type Table struct {
	gast.BaseBlock
	// Alignments holds the alignment of each column.
	Alignments []extast.Alignment
}

// Kind implements ast.Node.
func (n *Table) Kind() gast.NodeKind { return KindTable }

// Dump implements ast.Node.
func (n *Table) Dump(_ []byte) *gast.NodeDump {
	alignments := make([]string, len(n.Alignments))
	for i, a := range n.Alignments {
		alignments[i] = a.String()
	}
	return gast.NewNodeDump(n, map[string]any{"Alignments": alignments})
}

// NewTable returns a Table with the given column alignments.
func NewTable(alignments []extast.Alignment) *Table {
	n := &Table{Alignments: alignments}
	n.Init(n)
	return n
}

// TableHead holds the header rows of a [Table], each a [TableRow].
type TableHead struct {
	gast.BaseBlock
}

// Kind implements ast.Node.
func (n *TableHead) Kind() gast.NodeKind { return KindTableHead }

// Dump implements ast.Node.
func (n *TableHead) Dump(_ []byte) *gast.NodeDump { return gast.NewNodeDump(n, nil) }

// NewTableHead returns an empty TableHead.
func NewTableHead() *TableHead {
	n := &TableHead{}
	n.Init(n)
	return n
}

// TableBody holds the body rows of a [Table], each a [TableRow].
type TableBody struct {
	gast.BaseBlock
}

// Kind implements ast.Node.
func (n *TableBody) Kind() gast.NodeKind { return KindTableBody }

// Dump implements ast.Node.
func (n *TableBody) Dump(_ []byte) *gast.NodeDump { return gast.NewNodeDump(n, nil) }

// NewTableBody returns an empty TableBody.
func NewTableBody() *TableBody {
	n := &TableBody{}
	n.Init(n)
	return n
}

// TableRow is a row of a [TableHead] or [TableBody]. Its children are the cells whose
// origin is in the row, in column order; a row whose positions are all covered by
// cells of rows above it has none.
type TableRow struct {
	gast.BaseBlock
}

// Kind implements ast.Node.
func (n *TableRow) Kind() gast.NodeKind { return KindTableRow }

// Dump implements ast.Node.
func (n *TableRow) Dump(_ []byte) *gast.NodeDump { return gast.NewNodeDump(n, nil) }

// NewTableRow returns an empty TableRow.
func NewTableRow() *TableRow {
	n := &TableRow{}
	n.Init(n)
	return n
}

// TableCell is a cell of an LTEM table. Its children are the inlines of the cell's
// text; the lines of a cell are separated by hard line breaks.
type TableCell struct {
	gast.BaseBlock
	// Row and Col are the grid position of the cell's origin, counting from 0 and
	// counting header rows and body rows together.
	Row, Col int
	// Rowspan and Colspan are the numbers of rows and columns the cell spans.
	Rowspan, Colspan int
	// Alignment is the alignment of the cell's origin column.
	Alignment extast.Alignment
	// Header is set for a cell whose origin is in a header row (<th>).
	Header bool
}

// Kind implements ast.Node.
func (n *TableCell) Kind() gast.NodeKind { return KindTableCell }

// Dump implements ast.Node.
func (n *TableCell) Dump(_ []byte) *gast.NodeDump {
	return gast.NewNodeDump(n, map[string]any{
		"Row": n.Row, "Col": n.Col, "Rowspan": n.Rowspan, "Colspan": n.Colspan,
		"Alignment": n.Alignment.String(), "Header": n.Header,
	})
}

// NewTableCell returns an empty TableCell.
func NewTableCell() *TableCell {
	n := &TableCell{Rowspan: 1, Colspan: 1, Alignment: extast.AlignNone}
	n.Init(n)
	return n
}

// kindCellLine and kindTableBlock exist only while a document is parsed.
var (
	kindCellLine   = gast.NewNodeKind("LTEMCellLine")
	kindTableBlock = gast.NewNodeKind("LTEMTableBlock")
)

// cellLine holds one line of a cell with several lines, so that goldmark parses each
// line as inlines on its own (spec 4.2). The AST transformer moves its inlines into
// the cell.
type cellLine struct {
	gast.BaseBlock
}

func (n *cellLine) Kind() gast.NodeKind { return kindCellLine }

func (n *cellLine) Dump(_ []byte) *gast.NodeDump { return gast.NewNodeDump(n, nil) }

func newCellLine() *cellLine {
	n := &cellLine{}
	n.Init(n)
	return n
}

// tableBlock is a table while its lines are read. When it is closed, it is replaced
// by the table's nodes.
type tableBlock struct {
	gast.BaseBlock
	headerRows int
	// start is the offset of the first header row. goldmark sets the position of a
	// block to the line that opens it, which is the delimiter row.
	start int
}

func (n *tableBlock) Kind() gast.NodeKind { return kindTableBlock }

func (n *tableBlock) Dump(_ []byte) *gast.NodeDump { return gast.NewNodeDump(n, nil) }

func newTableBlock(headerRows, start int) *tableBlock {
	n := &tableBlock{headerRows: headerRows, start: start}
	n.Init(n)
	return n
}
