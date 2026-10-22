// Package gmtest holds test cases that the goldmark extensions for goldmark v1 and v2
// share: Markdown sources and the HTML they render as, compared after the
// normalization of the conformance tests.
package gmtest

// Case is a Markdown source and the HTML it renders as.
type Case struct {
	Name, Source, Want string
}

// Containers are tables in block quotes and list items.
var Containers = []Case{
	{"block quote", "> | a | << |\n> |---|---|\n> | 1 | 2 |\n",
		`<blockquote><table><thead><tr><th colspan="2">a</th></tr></thead>
			<tbody><tr><td>1</td><td>2</td></tr></tbody></table></blockquote>`},
	{"block quote with a tab", ">\t| a |\n>\t| ^^ |\n>\t|---|\n",
		`<blockquote><table><thead><tr><th rowspan="2">a</th></tr><tr></tr></thead></table></blockquote>`},
	{"tight list item", "- | a |\n  |---|\n  | 1 |\n- b\n",
		`<ul><li><table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></li><li>b</li></ul>`},
	// As with goldmark's table extension, a table after a blank line in a list item
	// does not make the list loose.
	{"list item with a blank line", "- item\n\n  | a {c:2} |\n  |---|---|\n",
		`<ul><li>item<table><thead><tr><th colspan="2">a</th></tr></thead></table></li></ul>`},
	{"ordered list item", "1. | x | y |\n   |---|---|\n   | ^^ | 1 |\n",
		`<ol><li><table><thead><tr><th>x</th><th>y</th></tr></thead><tbody><tr><td>^^</td><td>1</td></tr></tbody></table></li></ol>`},
	{"nested", "> - Intro\n>   | a | b |\n>   | ^^ | c |\n>   |---|---|\n",
		`<blockquote><ul><li>Intro<table><thead><tr><th rowspan="2">a</th><th>b</th></tr><tr><th>c</th></tr></thead></table></li></ul></blockquote>`},
	{"header rows across the paragraph", "> Text\n> | a |\n> | b |\n> |---|\n",
		`<blockquote><p>Text</p><table><thead><tr><th>a</th></tr><tr><th>b</th></tr></thead></table></blockquote>`},
}

// Escapes are cells with \|, \<<, \^^ and \{c:2}.
var Escapes = []Case{
	{"escapes", "| \\<< | \\^^ | x \\{c:2} | a \\| b |\n|---|---|---|---|\n| \\{r:2} | ^^ | x | `\\|` |\n",
		`<table><thead><tr><th>&lt;&lt;</th><th>^^</th><th>x {c:2}</th><th>a | b</th></tr></thead>
			<tbody><tr><td>{r:2}</td><td>^^</td><td>x</td><td><code>|</code></td></tr></tbody></table>`},
	{"an escaped attribute is text, so << extends its cell", "| a | b |\n|---|---|\n| \\{r:2} | << |\n",
		`<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td colspan="2">{r:2}</td></tr></tbody></table>`},
	{"escapes on lines", "| a \\\\ \\<< \\\\ x \\{c:2} |\n|---|\n",
		`<table><thead><tr><th>a<br>&lt;&lt;<br>x {c:2}</th></tr></thead></table>`},
	{"backslashes that are no escapes", "| a \\{b} | x\\{c:2} | \\<< x |\n|---|---|---|\n",
		`<table><thead><tr><th>a {b}</th><th>x{c:2}</th><th>&lt;&lt; x</th></tr></thead></table>`},
}

// SeveralTables are documents with more than one table.
var SeveralTables = []Case{
	{"tables in a row", "| a |\n|---|\n\n| b {c:2} |\n|---|---|\nText\n\nText\n| c |\n|---|\n# H\n| d |\n|---|\n| 1 |\n",
		`<table><thead><tr><th>a</th></tr></thead></table>
			<table><thead><tr><th colspan="2">b</th></tr></thead><tbody><tr><td>Text</td><td></td></tr></tbody></table>
			<p>Text</p><table><thead><tr><th>c</th></tr></thead></table><h1>H</h1>
			<table><thead><tr><th>d</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>`},
	{"rows in the form of a delimiter row in the body", "| a |\n|---|\n|---|\n| b |\n|---|\n",
		`<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>---</td></tr><tr><td>b</td></tr><tr><td>---</td></tr></tbody></table>`},
	{"a delimiter row that does not fit stays text", "| a | b |\n|---|\n| c |\n|:-:|\n",
		`<p>| a | b |
			|---|</p><table><thead><tr><th align="center">c</th></tr></thead></table>`},
}

// TableEnds are lines that end a table body, and lines that do not.
var TableEnds = []Case{
	{"indented line", "| a |\n|---|\n    code\n", `<table><thead><tr><th>a</th></tr></thead></table><pre><code>code</code></pre>`},
	{"ordered list not starting at 1", "| a |\n|---|\n2. x\n", `<table><thead><tr><th>a</th></tr></thead></table><ol start="2"><li>x</li></ol>`},
	{"empty list item", "| a |\n|---|\n*\n", `<table><thead><tr><th>a</th></tr></thead></table><ul><li></li></ul>`},
	{"thematic break", "| a |\n|---|\n---\n", `<table><thead><tr><th>a</th></tr></thead></table><hr>`},
	{"HTML block", "| a |\n|---|\n<div>\n", "<table><thead><tr><th>a</th></tr></thead></table><div>"},
	{"inline HTML is a row", "| a |\n|---|\n<span>x</span>\n",
		`<table><thead><tr><th>a</th></tr></thead><tbody><tr><td><span>x</span></td></tr></tbody></table>`},
	{"setext underlines are rows", "| a |\n|---|\n===\n--\n",
		`<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>===</td></tr><tr><td>--</td></tr></tbody></table>`},
	{"ideographic space is a row", "| a |\n|---|\n\u3000\n",
		"<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>\u3000</td></tr></tbody></table>"},
	{"end of the document", "| a |\n|---|\n| 1 |", `<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>`},
	{"CRLF", "| a |\r\n|---|\r\n| 1 |\r\n\r\nx\r\n",
		`<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><p>x</p>`},
}

// HeaderRows are tables with several header rows, and lines that are not header rows.
var HeaderRows = []Case{
	{"identifier line", "| # orders |\n| ID | C |\n|---|---|\n", `<p>| # orders |</p><table><thead><tr><th>ID</th><th>C</th></tr></thead></table>`},
	{"text above", "Total\n| a |\n|---|\n", `<p>Total</p><table><thead><tr><th>a</th></tr></thead></table>`},
	{"delimiter-form last header row", "Note\n| a | b |\n|---|\n|---|\n", `<p>Note
			| a | b |</p><table><thead><tr><th>---</th></tr></thead></table>`},
	{"compact header with an empty cell left over", "| a | b | |\n|---|---|\n", `<table><thead><tr><th>a</th><th>b</th></tr></thead></table>`},
	{"heading line", "# | a |\n|---|\n", `<h1>| a |</h1><p>|---|</p>`},
}

// ParagraphBeforeTable are tables whose paragraph above is closed first; when its
// paragraph transformers remove it, goldmark tries the line again.
var ParagraphBeforeTable = []Case{
	{"link reference definition", "[r]: /u\n| [a][r] |\n|---|\n", `<table><thead><tr><th><a href="/u">a</a></th></tr></thead></table>`},
	{"definition and text", "[r]: /u\nText [x][r]\n| a |\n|---|\n",
		`<p>Text <a href="/u">x</a></p><table><thead><tr><th>a</th></tr></thead></table>`},
	{"definitions only, with two header rows", "[r]: /u\n[s]: /v\n| a |\n| [b][s] |\n|---|\n",
		`<table><thead><tr><th>a</th></tr><tr><th><a href="/v">b</a></th></tr></thead></table>`},
}

// DifferencesFromGoldmarkTable are inputs that render differently from goldmark's
// table extension. Each follows a rule of the LTEM specification, or avoids a
// deviation of goldmark's table extension from GFM; the README lists them.
var DifferencesFromGoldmarkTable = []Case{
	{"a pipe-led line above the header row is a header row", "| x |\n| a |\n|---|\n",
		`<table><thead><tr><th>x</th></tr><tr><th>a</th></tr></thead></table>`},
	{"a header row with an empty cell left over fits", "| a | b | |\n|---|---|\n",
		`<table><thead><tr><th>a</th><th>b</th></tr></thead></table>`},
	{"a header row with too few cells is no table", "| a |\n|:-|-:|\n| 1 |\n", "<p>| a |\n|:-|-:|\n| 1 |</p>"},
	{"a delimiter row needs a pipe", "Total\n:--\n", "<p>Total\n:--</p>"},
	{"a later delimiter row may begin a table", "| a | b |\n|---|\n| c |\n|:-:|\n",
		"<p>| a | b |\n|---|</p><table><thead><tr><th style=\"text-align:center\">c</th></tr></thead></table>"},
	{"an escaped pipe at the end of a row is text", "| a \\|\n|---|\n", `<table><thead><tr><th>a |</th></tr></thead></table>`},
	{"a setext underline is a body row", "| a |\n|---|\n===\n",
		`<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>===</td></tr></tbody></table>`},
	{"an indented line ends the table", "| a |\n|---|\n    x\n", `<table><thead><tr><th>a</th></tr></thead></table><pre><code>x</code></pre>`},
	{"a line that begins a block ends the table", "| a |\n|---|\n2. x\n",
		`<table><thead><tr><th>a</th></tr></thead></table><ol start="2"><li>x</li></ol>`},
	{"a lazy continuation line does not continue a table", "> | a |\n> |---|\n| 1 |\n",
		`<blockquote><table><thead><tr><th>a</th></tr></thead></table></blockquote><p>| 1 |</p>`},
	{"a lazy continuation line does not begin a table", "- item\n| b |\n|---|\n", "<ul><li>item\n| b |\n|---|</li></ul>"},
	{"a link reference definition directly above a delimiter row is a header row", "[r]: /u\n|---|\n",
		`<table><thead><tr><th>[r]: /u</th></tr></thead></table>`},
}

// DifferencesFromGoldmarkV1Table are inputs that render differently from the table
// extension of goldmark v1 only.
var DifferencesFromGoldmarkV1Table = []Case{
	{"a cell added to a short row has its column's alignment", "| a | b |\n|:-|:-|\n| 1 |\n",
		`<table><thead><tr><th style="text-align:left">a</th><th style="text-align:left">b</th></tr></thead>
			<tbody><tr><td style="text-align:left">1</td><td style="text-align:left"></td></tr></tbody></table>`},
}

// IndentedParagraphLines are tables after paragraph lines indented by four or more
// columns, which cannot be header rows.
var IndentedParagraphLines = []Case{
	{"an indented last header row", "Text\n    | a |\n|---|\n", "<p>Text\n| a |\n|---|</p>"},
	{"an indented upper header row", "Text\n    | a |\n| b |\n|---|\n",
		"<p>Text\n| a |</p><table><thead><tr><th>b</th></tr></thead></table>"},
	{"three spaces", "Text\n   | a |\n| b |\n|---|\n",
		"<p>Text</p><table><thead><tr><th>a</th></tr><tr><th>b</th></tr></thead></table>"},
	{"in a list item", "- Text\n      | a |\n  | b |\n  |---|\n",
		"<ul><li>Text\n| a |<table><thead><tr><th>b</th></tr></thead></table></li></ul>"},
}

// KnownLimitations are inputs where goldmark's inline parser, which reads a cell's
// source as written, renders differently from the specification's cell text, as with
// goldmark's table extension; the README lists them.
var KnownLimitations = []Case{
	{"a backslash before an escaped pipe", "| a\\\\|b |\n|---|\n", "<table><thead><tr><th>a\\|b</th></tr></thead></table>"},
	{"an escaped pipe in an autolink", "| <http://a\\|b> |\n|---|\n",
		`<table><thead><tr><th><a href="http://a%5C%7Cb">http://a\|b</a></th></tr></thead></table>`},
	{"an escaped pipe in raw HTML", "| <span title=\"a\\|b\">x</span> |\n|---|\n",
		`<table><thead><tr><th><span title="a\|b">x</span></th></tr></thead></table>`},
}
