package ltem

import (
	"fmt"
	"strconv"
)

// origin is a cell placed in the grid.
type origin struct {
	row, col         int
	rowspan, colspan int
	// text is the cell's text without its span attribute.
	text string
	// source is the index of the cell in its row's text, or -1 if the cell was added
	// because the row was short (V14).
	source int
	// fixedCols and fixedRows are set when the span attribute gives the colspan or
	// rowspan: markers may not extend it (spec 3.4).
	fixedCols, fixedRows bool
}

// undo is one change recorded while a compact row is tried.
type undo struct {
	kind  undoKind
	index int // position for undoOwner, origin for undoColspan and undoRowspan
	owner int // previous owner for undoOwner
}

type undoKind uint8

const (
	undoOwner undoKind = iota
	undoColspan
	undoRowspan
	undoOrigin
)

// grid places the cells of a table row by row, as spec Section 3 describes.
type grid struct {
	cols, headerRows, rows int
	// owner holds, for each position (row-major), the index in origins of the cell
	// that owns it, or -1.
	owner    []int
	origins  []origin
	problems []Problem
	// journal records changes while a compact row is tried; nil otherwise.
	journal *[]undo
}

func newGrid(cols, headerRows, rows int) *grid {
	g := &grid{cols: cols, headerRows: headerRows, rows: rows, owner: make([]int, rows*cols)}
	for i := range g.owner {
		g.owner[i] = -1
	}
	return g
}

func (g *grid) report(rule Rule, row, col int, message string) {
	g.problems = append(g.problems, Problem{Rule: rule, Row: row, Col: col, Message: message})
}

func (g *grid) ownerAt(r, c int) int { return g.owner[r*g.cols+c] }

// free reports whether no cell owns a position in rows [r0, r1) and columns [c0, c1),
// cut at the edges of the grid.
func (g *grid) free(r0, r1, c0, c1 int) bool {
	for r := r0; r < min(r1, g.rows); r++ {
		for c := c0; c < min(c1, g.cols); c++ {
			if g.ownerAt(r, c) >= 0 {
				return false
			}
		}
	}
	return true
}

func (g *grid) record(u undo) {
	if g.journal != nil {
		*g.journal = append(*g.journal, u)
	}
}

// cover gives the positions in rows [r0, r1) and columns [c0, c1) to origin o.
func (g *grid) cover(o, r0, r1, c0, c1 int) {
	for r := r0; r < min(r1, g.rows); r++ {
		for c := c0; c < min(c1, g.cols); c++ {
			i := r*g.cols + c
			g.record(undo{kind: undoOwner, index: i, owner: g.owner[i]})
			g.owner[i] = o
		}
	}
}

// extendLeft applies a "<<" at (r, c): it extends the cell to its left (spec 3.4).
func (g *grid) extendLeft(r, c int) bool {
	i := -1
	if c > 0 {
		i = g.ownerAt(r, c-1)
	}
	if i < 0 || g.origins[i].row != r || g.origins[i].col+g.origins[i].colspan != c || g.origins[i].fixedCols {
		g.report(V13, r, c, "'<<' has no cell to extend")
		return false
	}
	o := &g.origins[i]
	if !g.free(r+1, o.row+o.rowspan, c, c+1) {
		g.report(V4, r, c, "'<<' would make two cells overlap")
		return false
	}
	o.colspan++
	g.record(undo{kind: undoColspan, index: i})
	g.cover(i, o.row, o.row+o.rowspan, c, c+1)
	return true
}

// extendUp applies a "^^" at (r, c): it extends the cell above it (spec 3.4).
func (g *grid) extendUp(r, c int) bool {
	i := -1
	if r > 0 {
		i = g.ownerAt(r-1, c)
	}
	if i < 0 || g.origins[i].col != c || g.origins[i].row+g.origins[i].rowspan != r || g.origins[i].fixedRows {
		g.report(V13, r, c, "'^^' has no cell to extend")
		return false
	}
	o := &g.origins[i]
	if o.row < g.headerRows && g.headerRows <= r {
		g.report(V7, r, c, "'^^' would extend a header cell into the body")
		return false
	}
	if !g.free(r, r+1, c+1, o.col+o.colspan) {
		g.report(V4, r, c, "'^^' would make two cells overlap")
		return false
	}
	o.rowspan++
	g.record(undo{kind: undoRowspan, index: i})
	g.cover(i, r, r+1, o.col, o.col+o.colspan)
	return true
}

// place places a cell at (r, c), which is not covered (spec 3.3). source is the
// cell's index in its row's text, or -1.
func (g *grid) place(r, c int, text string, source int) {
	if text == colspanMarker && g.extendLeft(r, c) {
		return
	}
	if text == rowspanMarker && g.extendUp(r, c) {
		return
	}
	colspan, rowspan := 1, 1
	shownCols, shownRows := "", ""
	fixedCols, fixedRows := false, false
	if text != colspanMarker && text != rowspanMarker { // an unusable marker stays text (V13)
		var attr *spanAttribute
		text, attr = splitAttribute(text)
		if attr != nil {
			for _, message := range attr.problems {
				g.report(V1, r, c, message)
			}
			if v := attr.colspan; v != nil {
				colspan, shownCols, fixedCols = v.n, v.digits, true
			}
			if v := attr.rowspan; v != nil {
				rowspan, shownRows, fixedRows = v.n, v.digits, true
			}
		}
	}
	// V2, V3: the span is cut at the right or bottom edge (spec 3.6).
	if colspan > g.cols-c {
		g.report(V2, r, c, "colspan "+shown(shownCols, colspan)+" reaches past the last column")
		colspan = g.cols - c
	}
	if rowspan > g.rows-r {
		g.report(V3, r, c, "rowspan "+shown(shownRows, rowspan)+" reaches past the last row")
		rowspan = g.rows - r
	}
	// V7: a header cell's rowspan is cut at the last header row.
	if r < g.headerRows && g.headerRows < r+rowspan {
		g.report(V7, r, c, "a header cell spans into the body")
		rowspan = g.headerRows - r
	}
	// V4: the span is cut to the largest rectangle that overlaps no other cell,
	// columns first and then rows.
	k := 1
	for k < colspan && g.ownerAt(r, c+k) < 0 {
		k++
	}
	j := 1
	for j < rowspan && g.free(r+j, r+j+1, c, c+k) {
		j++
	}
	if k != colspan || j != rowspan {
		g.report(V4, r, c, fmt.Sprintf("span cut from %dx%d to %dx%d to avoid an overlap", colspan, rowspan, k, j))
		colspan, rowspan = k, j
	}
	g.origins = append(g.origins, origin{
		row: r, col: c, rowspan: rowspan, colspan: colspan, text: text, source: source,
		fixedCols: fixedCols, fixedRows: fixedRows,
	})
	g.record(undo{kind: undoOrigin})
	g.cover(len(g.origins)-1, r, r+rowspan, c, c+colspan)
}

// shown is a span value for a message: as written in the attribute (without leading
// zeros), or the number.
func shown(digits string, n int) string {
	for len(digits) > 1 && digits[0] == '0' {
		digits = digits[1:]
	}
	if digits == "" {
		return strconv.Itoa(n)
	}
	return digits
}

// tryCompact places row r as a compact row if its cells fill exactly the positions
// that are not covered, and leftover cells are empty (spec 3.2). Otherwise it leaves
// the grid as it was, problems included, and returns false. Every change is
// journaled and undone if the row does not fit, which gives the same result as trying
// the row on a copy of the grid.
func (g *grid) tryCompact(r int, texts []string) bool {
	problems := len(g.problems)
	var journal []undo
	g.journal = &journal
	used := 0
	fits := true
	for c := 0; c < g.cols; c++ {
		if g.ownerAt(r, c) >= 0 {
			continue
		}
		if used == len(texts) {
			fits = false
			break
		}
		g.place(r, c, texts[used], used)
		used++
	}
	g.journal = nil
	for _, text := range texts[used:] {
		fits = fits && text == ""
	}
	if fits {
		return true
	}
	for i := len(journal) - 1; i >= 0; i-- {
		switch u := journal[i]; u.kind {
		case undoOwner:
			g.owner[u.index] = u.owner
		case undoColspan:
			g.origins[u.index].colspan--
		case undoRowspan:
			g.origins[u.index].rowspan--
		case undoOrigin:
			g.origins = g.origins[:len(g.origins)-1]
		}
	}
	g.problems = g.problems[:problems]
	return false
}

// addRow places row r, given the texts of its cells (spec 3.2).
func (g *grid) addRow(r int, texts []string) RowForm {
	n := len(texts)
	if n != g.cols && g.tryCompact(r, texts) {
		return CompactRow
	}
	form := GridRow
	if n != g.cols {
		g.report(V14, r, -1, fmt.Sprintf("row has %d cells; it fits neither as a grid row (%d cells) "+
			"nor as a compact row", n, g.cols))
		texts = append(texts[:min(n, g.cols):min(n, g.cols)], make([]string, max(g.cols-n, 0))...)
		form = PaddedRow
	}
	for c, text := range texts {
		if i := g.ownerAt(r, c); i >= 0 {
			// A placeholder in a grid row: its text is dropped (V5, V6).
			if text != "" && text != colspanMarker && text != rowspanMarker {
				rule := V6
				if g.origins[i].row < r {
					rule = V5
				}
				g.report(rule, r, c, fmt.Sprintf("a covered position holds text %q; it is dropped", text))
			}
			continue
		}
		source := -1
		if c < n {
			source = c
		}
		g.place(r, c, text, source)
	}
	return form
}
