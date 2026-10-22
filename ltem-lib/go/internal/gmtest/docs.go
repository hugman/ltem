package gmtest

import (
	"strings"

	"github.com/hugman/ltem/ltem-lib/go/internal/randdoc"
)

// InlineSource is a table whose cells use inline Markdown, GFM inlines and a
// footnote; InlineWant holds pieces of the HTML it renders as with the GFM and
// footnote extensions and raw HTML kept.
const InlineSource = "| *em* | **strong** | `a\\|b` | [l](http://x) | [ref][r] |\n" +
	"|---|---|---|---|---|\n" +
	"| <http://a.b> | ~~del~~ | www.example.com | note[^1] | <b>x</b> |\n" +
	"| *a \\\\ b* | `c \\\\ d` | $x\\|y$ | a \\\\ **b** \\\\ | \\\\ |\n\n" +
	"[r]: /ref\n[^1]: The note.\n"

// InlineWant holds pieces of the HTML of InlineSource.
var InlineWant = []string{
	"<th><em>em</em></th>", "<th><strong>strong</strong></th>", "<th><code>a|b</code></th>",
	`<th><a href="http://x">l</a></th>`, `<th><a href="/ref">ref</a></th>`,
	`<td><a href="http://a.b">http://a.b</a></td>`, "<td><del>del</del></td>",
	`<td><a href="http://www.example.com">www.example.com</a></td>`, `<sup id="fnref:1">`, "<td><b>x</b></td>",
	"<td>*a<br>\nb*</td>", "<td>`c<br>\nd`</td>", "<td>$x|y$</td>", "<td>a<br>\n<strong>b</strong><br>\n</td>",
	"<td><br>\n</td>",
}

// StreamDoc is a document whose every prefix the tests render, as if it arrived a
// piece at a time.
const StreamDoc = "> [r]: /u\n> Intro\n> | Region | Revenue {c:2} |\n> | ^^ | Q1 | Q2 \\\\ *est.* |\n> |:--|--:|--:|\n" +
	"> | Asia | `1\\|2` | [x][r] |\n> | ^^ | << | 3 |\n>     code\n\n- | a |\n  |---|\n  | 1 |\n"

// RandomDocs returns n random documents made of blocks from block, each wrapped in a
// random container, and the same documents with the blocks bare, for the core, which
// does not model containers.
func RandomDocs(n int, block func(*randdoc.Generator) []string) (docs, bare []string) {
	g := randdoc.New(20261020)
	for range n {
		var wrapped, plain []string
		for range 1 + g.IntN(4) {
			lines := block(g)
			plain = append(plain, strings.Join(lines, "\n"))
			wrapped = append(wrapped, strings.Join(g.Container(lines), "\n"))
		}
		// A line of text between two blocks ends a list, which would otherwise take
		// in an indented block that follows it.
		docs = append(docs, strings.Join(wrapped, "\n\nText\n\n")+"\n")
		bare = append(bare, strings.Join(plain, "\n\nText\n\n")+"\n")
	}
	return docs, bare
}
