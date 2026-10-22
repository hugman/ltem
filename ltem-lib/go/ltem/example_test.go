package ltem_test

import (
	"encoding/json"
	"fmt"

	"github.com/hugman/ltem/ltem-lib/go/ltem"
)

func ExampleParseTable() {
	result := ltem.ParseTable("| Region | Revenue | <<  |\n" +
		"| ^^     | Q1      | Q2  |\n" +
		"|--------|---------|-----|\n" +
		"| Asia   | 100     | 120 |")
	for _, c := range result.Table.Cells[:2] {
		fmt.Printf("%s: %d row(s), %d column(s)\n", c.Text, c.Rowspan, c.Colspan)
	}
	// Output:
	// Region: 2 row(s), 1 column(s)
	// Revenue: 1 row(s), 2 column(s)
}

func ExampleFindTables() {
	doc := "# Sales\n\n| A {r:2} | B |\n|---|---|\n| 1 | 2 |\n"
	for _, r := range ltem.FindTables(doc) {
		fmt.Println("table on lines", r.Start, "to", r.End-1)
		for _, p := range r.Problems {
			fmt.Println(p)
		}
	}
	// Output:
	// table on lines 2 to 4
	// V7 at (0,0): a header cell spans into the body
}

func ExampleRenderHTML() {
	result := ltem.ParseTable("| Item | Specs | << |\n|---|---|---|\n| Phone | 6.1\" | 170 g |")
	fmt.Println(ltem.RenderHTML(result.Table, nil))
	// Output:
	// <table>
	// <thead>
	// <tr>
	// <th>Item</th>
	// <th colspan="2">Specs</th>
	// </tr>
	// </thead>
	// <tbody>
	// <tr>
	// <td>Phone</td>
	// <td>6.1&quot;</td>
	// <td>170 g</td>
	// </tr>
	// </tbody>
	// </table>
}

func ExampleWrite() {
	var table ltem.Table
	model := `{"version": "1.0", "rows": 2, "cols": 2, "header_rows": 1, "align": ["left", null],
		"cells": [{"row": 0, "col": 0, "rowspan": 1, "colspan": 2, "text": "Revenue"},
		          {"row": 1, "col": 0, "rowspan": 1, "colspan": 1, "text": "a|b"},
		          {"row": 1, "col": 1, "rowspan": 1, "colspan": 1, "text": "<<"}]}`
	if err := json.Unmarshal([]byte(model), &table); err != nil {
		panic(err)
	}
	text, err := ltem.Write(&table)
	if err != nil {
		panic(err)
	}
	fmt.Println(text)
	// Output:
	// | Revenue | << |
	// | :--- | --- |
	// | a\|b | \<< |
}

func ExampleCellLineSpans() {
	line := `| a \| b \\ c {c:2} |`
	cell := ltem.SplitRowSpans(line)[0]
	source := line[cell.Start:cell.End]
	var lines []string
	for _, s := range ltem.CellLineSpans(source) {
		lines = append(lines, source[s.Start:s.End])
	}
	fmt.Printf("%q\n", lines)
	// Output:
	// ["a \\| b" "c"]
}
