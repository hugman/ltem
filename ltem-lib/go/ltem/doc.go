// Package ltem implements LTEM (LLM-friendly Table-Enhanced Markdown), version 1.0
// of the specification: Markdown pipe tables with merged cells (<<, ^^, {c:N},
// {r:M}), several header rows above the delimiter row, and line breaks in cells (\\).
//
// The package reads LTEM into the language-neutral table model ([Table]), reports
// the validation problems of the specification ([Problem]), renders tables as HTML
// with real colspan and rowspan ([RenderHTML]) and writes table models back in the
// canonical form ([Write]).
//
//	result := ltem.ParseTable("| Region | Revenue | <<  |\n" +
//		"| ^^     | Q1      | Q2  |\n" +
//		"|--------|---------|-----|\n" +
//		"| Asia   | 100     | 120 |")
//	html := ltem.RenderHTML(result.Table, nil) // <th rowspan="2">Region</th> ...
//	text, err := ltem.Write(result.Table)      // canonical LTEM
//
// [FindTables] finds the tables of a Markdown document with a light scan that skips
// code blocks; it is not a full Markdown parser. Markdown parser integrations find
// table lines themselves and use [TableAt], [ParseLines], the line-level functions
// ([IsDelimiterRow], [EndsTableBody] and others) and [CellLineSpans].
//
// The package uses only the standard library.
package ltem

// Version is the version of this package.
const Version = "0.1.0"

// SpecVersion is the version of the LTEM specification this package implements.
const SpecVersion = "1.0"
