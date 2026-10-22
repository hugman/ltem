package ltem

import "strings"

// delimiterCells are the delimiter cells of the canonical form (spec Section 8).
var delimiterCells = [...]string{AlignNone: "---", AlignLeft: ":---", AlignCenter: ":---:", AlignRight: "---:"}

// escapeCell turns model text into cell source, adding only the escapes that
// spec 4.3 asks writers to add.
func escapeCell(text string) string {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		line = strings.ReplaceAll(line, "|", `\|`)
		if line == colspanMarker || line == rowspanMarker {
			line = `\` + line
		}
		if open := findSpanAttribute(line); open >= 0 {
			line = line[:open] + `\` + line[open:]
		}
		lines[i] = line
	}
	return strings.Join(lines, ` \\ `)
}

func rowLine(cells []string) string {
	return "| " + strings.Join(cells, " | ") + " |"
}

// Write writes a table in the canonical form (spec Section 8). Every row is a grid
// row; a covered position in the column of its cell's origin is written "^^" and
// every other covered position "<<"; no span attributes are used. Lines are
// separated by "\n", without a final line break.
//
// Write fails with a *ModelError if the table breaks the rules of the table model
// (see [Table.Check]).
func Write(t *Table) (string, error) {
	if err := t.Check(); err != nil {
		return "", err
	}
	return canonical(t), nil
}

// canonical writes a valid table model in the canonical form.
func canonical(t *Table) string {
	owners := t.OwnerGrid()
	rows := make([][]string, t.Rows)
	for r := range rows {
		rows[r] = make([]string, t.Cols)
		for c := range rows[r] {
			switch cell := t.Cells[owners[r][c]]; {
			case cell.Row == r && cell.Col == c:
				rows[r][c] = escapeCell(cell.Text)
			case cell.Col == c:
				rows[r][c] = rowspanMarker
			default:
				rows[r][c] = colspanMarker
			}
		}
	}
	// A header row made only of delimiter cells would be read as the delimiter row.
	for _, row := range rows[:t.HeaderRows] {
		allDelimiters := true
		for _, cell := range row {
			allDelimiters = allDelimiters && isDelimiterCell(cell)
		}
		if allDelimiters {
			row[0] = `\` + row[0]
		}
	}
	// A header row above the last one must not have the form of a reserved
	// identifier line, which would end the header rows (spec 4.3, Section 9).
	for _, row := range rows[:t.HeaderRows-1] {
		if isIdentifierRow(rowLine(row)) {
			row[0] = `\` + row[0]
		}
	}
	lines := make([]string, 0, t.Rows+1)
	for _, row := range rows[:t.HeaderRows] {
		lines = append(lines, rowLine(row))
	}
	delimiter := make([]string, t.Cols)
	for c, a := range t.Align {
		delimiter[c] = delimiterCells[a]
	}
	lines = append(lines, rowLine(delimiter))
	for _, row := range rows[t.HeaderRows:] {
		lines = append(lines, rowLine(row))
	}
	return strings.Join(lines, "\n")
}

// WriteWithSources writes a table in the canonical form like [Write] and tells where
// each cell is in the output, in the order of t.Cells. Lines count from the table's
// first line (0).
func WriteWithSources(t *Table) (string, []CellSource, error) {
	text, err := Write(t)
	if err != nil {
		return "", nil, err
	}
	return text, ParseTable(text).Sources, nil
}

// Format rewrites every table of a Markdown document in the canonical form and keeps
// everything else. It finds tables with [FindTables]. A table keeps the indentation
// of its first line, so that a table in a list item stays there. Lines of the result
// end with "\n".
func Format(markdown string) string {
	lines := splitLines(markdown)
	out := make([]string, 0, len(lines))
	next := 0
	for _, r := range FindTables(markdown) {
		out = append(out, lines[next:r.Start]...)
		first := lines[r.Start]
		indent := first[:len(first)-len(strings.TrimLeft(first, " \t"))]
		for _, line := range strings.Split(canonical(r.Table), "\n") { // a parsed table is a valid model
			out = append(out, indent+line)
		}
		next = r.End
	}
	return strings.Join(append(out, lines[next:]...), "\n")
}
