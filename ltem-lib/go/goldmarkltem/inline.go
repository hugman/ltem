package goldmarkltem

import (
	"bytes"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/util"
)

// inlineMarkdown parses every input as one paragraph: it has no block parser other
// than the paragraph's, and no paragraph transformer, so "# x", "- x" or "[a]: b" stay
// text, as in a table cell.
var inlineMarkdown = goldmark.New(
	goldmark.WithParser(parser.NewParser(
		parser.WithBlockParsers(util.Prioritized(parser.NewParagraphParser(), 1000)),
		parser.WithInlineParsers(parser.DefaultInlineParsers()...),
	)),
	goldmark.WithRendererOptions(html.WithUnsafe(), html.WithXHTML()),
)

// CommonMarkInline renders one line of LTEM cell text as CommonMark inlines with
// goldmark, raw HTML included. It is an [ltem.InlineRenderer] for [ltem.RenderHTML]:
//
//	html := ltem.RenderHTML(table, goldmarkltem.CommonMarkInline)
//
// To render whole documents, use [Extension] instead.
func CommonMarkInline(text string) string {
	var buf bytes.Buffer
	if err := inlineMarkdown.Convert([]byte(text), &buf); err != nil {
		return ""
	}
	out := bytes.TrimSuffix(buf.Bytes(), []byte("\n"))
	out = bytes.TrimPrefix(out, []byte("<p>"))
	return string(bytes.TrimSuffix(out, []byte("</p>")))
}
