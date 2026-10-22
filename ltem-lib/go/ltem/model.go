package ltem

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// ModelVersion is the version of the table model (ast/table-model.md).
const ModelVersion = "1.0"

// Align is the alignment of a column, set by the delimiter row (spec 2.2).
type Align uint8

// Column alignments. AlignNone means that the delimiter row sets no alignment.
const (
	AlignNone Align = iota
	AlignLeft
	AlignCenter
	AlignRight
)

// String returns the model's name of the alignment: "left", "center", "right", or
// "" for AlignNone.
func (a Align) String() string {
	switch a {
	case AlignLeft:
		return "left"
	case AlignCenter:
		return "center"
	case AlignRight:
		return "right"
	}
	return ""
}

// MarshalJSON writes the alignment as in the table model: a name, or null.
func (a Align) MarshalJSON() ([]byte, error) {
	if a == AlignNone {
		return []byte("null"), nil
	}
	return json.Marshal(a.String())
}

// UnmarshalJSON reads "left", "center", "right" or null.
func (a *Align) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		*a = AlignNone
		return nil
	}
	var name string
	if err := json.Unmarshal(data, &name); err != nil {
		return fmt.Errorf("alignment must be a string or null: %w", err)
	}
	switch name {
	case "left":
		*a = AlignLeft
	case "center":
		*a = AlignCenter
	case "right":
		*a = AlignRight
	default:
		return fmt.Errorf("unknown alignment %q", name)
	}
	return nil
}

// Cell is a cell of a table. Its origin is its top-left grid position.
type Cell struct {
	// Row and Col are the position of the origin, counting from 0.
	Row int `json:"row"`
	Col int `json:"col"`
	// Rowspan and Colspan are the numbers of rows and columns the cell spans, at least 1.
	Rowspan int `json:"rowspan"`
	Colspan int `json:"colspan"`
	// Text is the cell's inline Markdown source. Lines are separated by "\n".
	Text string `json:"text"`
}

// Table is a resolved LTEM table: the table model of ast/table-model.md.
//
// Its JSON form ([Table.MarshalJSON]) is the table model itself.
type Table struct {
	// Rows is the number of grid rows: header rows first, then body rows.
	Rows int
	// Cols is the number of grid columns.
	Cols int
	// HeaderRows is the number of header rows.
	HeaderRows int
	// Align holds the alignment of each column.
	Align []Align
	// Cells holds the cells, sorted by row and then by column.
	Cells []Cell
}

// IsHeader reports whether a cell is a header cell: its origin is in a header row.
func (t *Table) IsHeader(c Cell) bool {
	return c.Row < t.HeaderRows
}

// OwnerGrid returns a Rows x Cols grid holding, for each position, the index in
// t.Cells of the cell that owns it, or -1 if no cell does.
func (t *Table) OwnerGrid() [][]int {
	grid := make([][]int, t.Rows)
	for r := range grid {
		grid[r] = make([]int, t.Cols)
		for c := range grid[r] {
			grid[r][c] = -1
		}
	}
	for i, cell := range t.Cells {
		for r := max(cell.Row, 0); r < min(cell.Row+cell.Rowspan, t.Rows); r++ {
			for c := max(cell.Col, 0); c < min(cell.Col+cell.Colspan, t.Cols); c++ {
				grid[r][c] = i
			}
		}
	}
	return grid
}

// ModelError reports a table model that breaks the rules of the table model
// (ast/table-model.md), so that it cannot be written.
type ModelError struct {
	// Problems describes each broken rule.
	Problems []string
}

// Error lists the broken rules.
func (e *ModelError) Error() string {
	return "invalid table model: " + strings.Join(e.Problems, "; ")
}

// maxPositions is the largest grid that [Table.Check] accepts, so that a table model
// read from untrusted input cannot make it allocate without limit.
const maxPositions = 1 << 28

// Check reports whether the table is a valid table model: the sizes are positive,
// align has one entry per column, the cells are sorted, lie inside the grid, cover
// every position exactly once, do not reach from the header rows into the body, and
// hold no two backslashes in a row. It returns nil or a *ModelError. A grid of more
// than 2^28 positions is reported as a problem too.
func (t *Table) Check() error {
	var problems []string
	if t.Rows < 1 || t.Cols < 1 {
		problems = append(problems, fmt.Sprintf("rows and cols must be at least 1, got %d and %d", t.Rows, t.Cols))
	} else if t.Rows > maxPositions/t.Cols {
		return &ModelError{Problems: []string{fmt.Sprintf("the grid of %d x %d positions is too large", t.Rows, t.Cols)}}
	}
	if len(t.Align) != t.Cols {
		problems = append(problems, fmt.Sprintf("align has %d entries, expected %d", len(t.Align), t.Cols))
	}
	for c, a := range t.Align {
		if a > AlignRight {
			problems = append(problems, fmt.Sprintf("align[%d] is not a known alignment", c))
		}
	}
	if t.HeaderRows < 1 || t.HeaderRows > t.Rows {
		problems = append(problems, fmt.Sprintf("header_rows %d is outside 1..%d", t.HeaderRows, t.Rows))
	}
	if !sort.SliceIsSorted(t.Cells, func(i, j int) bool { return cellBefore(t.Cells[i], t.Cells[j]) }) {
		problems = append(problems, "cells are not sorted by row and column")
	}
	seen := make([][]bool, max(t.Rows, 0))
	for r := range seen {
		seen[r] = make([]bool, max(t.Cols, 0))
	}
	for _, c := range t.Cells {
		if c.Row < 0 || c.Col < 0 || c.Rowspan < 1 || c.Colspan < 1 ||
			c.Rowspan > t.Rows-c.Row || c.Colspan > t.Cols-c.Col {
			problems = append(problems, fmt.Sprintf("cell (%d,%d) lies outside the grid", c.Row, c.Col))
			continue
		}
		if c.Row < t.HeaderRows && t.HeaderRows < c.Row+c.Rowspan {
			problems = append(problems, fmt.Sprintf("header cell (%d,%d) reaches into the body", c.Row, c.Col))
		}
		for r := c.Row; r < c.Row+c.Rowspan; r++ {
			for k := c.Col; k < c.Col+c.Colspan; k++ {
				if seen[r][k] {
					problems = append(problems, fmt.Sprintf("position (%d,%d) belongs to two cells", r, k))
				}
				seen[r][k] = true
			}
		}
	}
	var holes []string
	for r := range seen {
		for k := range seen[r] {
			if !seen[r][k] && len(holes) < 5 {
				holes = append(holes, fmt.Sprintf("(%d, %d)", r, k))
			}
		}
	}
	if len(holes) > 0 {
		problems = append(problems, "positions without a cell: ["+strings.Join(holes, ", ")+"]")
	}
	for _, c := range t.Cells {
		if strings.Contains(c.Text, `\\`) {
			problems = append(problems, fmt.Sprintf("cell (%d,%d) text has two backslashes in a row, "+
				"which LTEM 1.0 reads as a line break", c.Row, c.Col))
		}
	}
	if len(problems) > 0 {
		return &ModelError{Problems: problems}
	}
	return nil
}

func cellBefore(a, b Cell) bool {
	return a.Row < b.Row || a.Row == b.Row && a.Col < b.Col
}

// tableJSON is the table model's JSON object, with the keys in the schema's order.
type tableJSON struct {
	Version    string  `json:"version"`
	Rows       int     `json:"rows"`
	Cols       int     `json:"cols"`
	HeaderRows int     `json:"header_rows"`
	Align      []Align `json:"align"`
	Cells      []Cell  `json:"cells"`
}

// MarshalJSON writes the table model as JSON, with the cells sorted by row and
// column. The output is valid against ast/table.schema.json for a valid table.
func (t Table) MarshalJSON() ([]byte, error) {
	align := t.Align
	if align == nil {
		align = []Align{}
	}
	cells := append([]Cell{}, t.Cells...)
	sort.SliceStable(cells, func(i, j int) bool { return cellBefore(cells[i], cells[j]) })
	// The text is not HTML-escaped here: an encoder that escapes HTML escapes the
	// result anyway, and one that does not keeps "<<" readable.
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(tableJSON{ModelVersion, t.Rows, t.Cols, t.HeaderRows, align, cells}); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

// tableInput and cellInput read a table model; a nil field was missing.
type tableInput struct {
	Version    *string      `json:"version"`
	Rows       *int         `json:"rows"`
	Cols       *int         `json:"cols"`
	HeaderRows *int         `json:"header_rows"`
	Align      *[]Align     `json:"align"`
	Cells      *[]cellInput `json:"cells"`
}

type cellInput struct {
	Row     *int    `json:"row"`
	Col     *int    `json:"col"`
	Rowspan *int    `json:"rowspan"`
	Colspan *int    `json:"colspan"`
	Text    *string `json:"text"`
}

// UnmarshalJSON reads a table model. It requires every field of the schema, rejects
// unknown fields and versions other than [ModelVersion], and checks the types. It does
// not check the rules beyond the schema; use [Table.Check] for that.
func (t *Table) UnmarshalJSON(data []byte) error {
	var m tableInput
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		return err
	}
	if m.Version == nil || m.Rows == nil || m.Cols == nil || m.HeaderRows == nil || m.Align == nil || m.Cells == nil {
		return errors.New("a table model needs version, rows, cols, header_rows, align and cells")
	}
	if *m.Version != ModelVersion {
		return fmt.Errorf("unsupported table model version: %q", *m.Version)
	}
	cells := make([]Cell, len(*m.Cells))
	for i, c := range *m.Cells {
		if c.Row == nil || c.Col == nil || c.Rowspan == nil || c.Colspan == nil || c.Text == nil {
			return errors.New("a cell needs row, col, rowspan, colspan and text")
		}
		cells[i] = Cell{Row: *c.Row, Col: *c.Col, Rowspan: *c.Rowspan, Colspan: *c.Colspan, Text: *c.Text}
	}
	*t = Table{Rows: *m.Rows, Cols: *m.Cols, HeaderRows: *m.HeaderRows, Align: *m.Align, Cells: cells}
	return nil
}

// Rule names a validation rule of the specification (Section 5).
type Rule string

// The validation rules of LTEM 1.0. V8 to V12 are reserved.
const (
	V1  Rule = "V1"  // a span value is zero, or a key appears twice in an attribute
	V2  Rule = "V2"  // a colspan reaches past the last column
	V3  Rule = "V3"  // a rowspan reaches past the last row
	V4  Rule = "V4"  // two cells overlap
	V5  Rule = "V5"  // text in a grid-row position covered from an earlier row
	V6  Rule = "V6"  // text in a grid-row position covered from the same row
	V7  Rule = "V7"  // a header cell spans into the body
	V13 Rule = "V13" // a marker has no cell to extend
	V14 Rule = "V14" // a row fits neither as a grid row nor as a compact row (warning)
)

// Severity is the severity of a validation problem.
type Severity uint8

// A table is valid if it has no problem of severity SeverityError.
const (
	SeverityError Severity = iota
	SeverityWarning
)

// String returns "error" or "warning".
func (s Severity) String() string {
	if s == SeverityWarning {
		return "warning"
	}
	return "error"
}

// Problem is a validation problem (spec Section 5).
type Problem struct {
	// Rule is the rule that is broken.
	Rule Rule
	// Row and Col are the grid position of the cell, placeholder or marker concerned.
	// Col is -1 for a problem that concerns a whole row (V14).
	Row, Col int
	// Message describes the problem for people.
	Message string
}

// Severity returns SeverityWarning for V14, which leaves the table valid, and
// SeverityError for every other rule.
func (p Problem) Severity() Severity {
	if p.Rule == V14 {
		return SeverityWarning
	}
	return SeverityError
}

// String formats the problem, for example "V13 at (1,0): '<<' has no cell to extend".
func (p Problem) String() string {
	if p.Col < 0 {
		return fmt.Sprintf("%s at row %d: %s", p.Rule, p.Row, p.Message)
	}
	return fmt.Sprintf("%s at (%d,%d): %s", p.Rule, p.Row, p.Col, p.Message)
}

// MarshalJSON writes the problem in the form of the conformance protocol, with its
// severity: {"rule": "V13", "row": 1, "col": 0, "severity": "error"}. A col of -1 is
// written as null.
func (p Problem) MarshalJSON() ([]byte, error) {
	var col *int
	if p.Col >= 0 {
		col = &p.Col
	}
	return json.Marshal(struct {
		Rule     Rule   `json:"rule"`
		Row      int    `json:"row"`
		Col      *int   `json:"col"`
		Severity string `json:"severity"`
	}{p.Rule, p.Row, col, p.Severity().String()})
}

// CellSource tells where a cell is in the LTEM source.
type CellSource struct {
	// Row, Col, Rowspan and Colspan repeat the cell's position and spans.
	Row     int `json:"row"`
	Col     int `json:"col"`
	Rowspan int `json:"rowspan"`
	Colspan int `json:"colspan"`
	// Line is the line of the cell's source, counted like Result.Start.
	Line int `json:"line"`
	// Start and End are byte offsets in that line, so line[Start:End] is the cell's
	// source: without the spaces and tabs around it, with any span attribute and
	// escapes. An empty cell has Start == End at the end of its space between the
	// pipes. A cell added because its row was short (rule V14) has no source; it gets
	// Start == End == the length of its line.
	Start int `json:"start"`
	End   int `json:"end"`
}

// RowForm tells how a row was read (spec 3.2).
type RowForm uint8

// The forms of a row.
const (
	// GridRow: every position has its own cell in the text.
	GridRow RowForm = iota
	// CompactRow: covered positions have no cell in the text.
	CompactRow
	// PaddedRow: the row fit neither form (rule V14) and was padded or cut.
	PaddedRow
)

// String returns "grid", "compact" or "padded".
func (f RowForm) String() string {
	switch f {
	case CompactRow:
		return "compact"
	case PaddedRow:
		return "padded"
	}
	return "grid"
}
