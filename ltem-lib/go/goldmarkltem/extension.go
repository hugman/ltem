// Package goldmarkltem is a goldmark extension for LTEM tables: Markdown pipe tables
// with merged cells (<<, ^^, {c:N}, {r:M}), several header rows and line breaks in
// cells (\\), as defined by the LTEM specification, version 1.0.
//
//	md := goldmark.New(goldmark.WithExtensions(goldmarkltem.Extension))
//	err := md.Convert(source, &buf)
//
// The extension takes the place of goldmark's table extension (extension.Table); use
// one or the other. [GFM] is goldmark's extension.GFM with LTEM tables. A table
// without LTEM notation renders as with extension.Table.
//
// Cell text is parsed as goldmark inlines, so inline extensions apply in cells. A table
// with one header row and no merged cells is built from the nodes of goldmark's table
// extension (extension/ast) and rendered by its renderer; other tables are built from
// this package's nodes ([Table], [TableHead], [TableBody], [TableRow], [TableCell]).
package goldmarkltem

import (
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/util"
)

// Extension is the LTEM table extension with the default options.
var Extension = New()

// GFM is goldmark's GitHub Flavored Markdown extension (extension.GFM) with LTEM
// tables in place of GFM tables: linkify, strikethrough, task lists and LTEM tables.
var GFM goldmark.Extender = gfm{}

type gfm struct{}

func (gfm) Extend(m goldmark.Markdown) {
	extension.Linkify.Extend(m)
	Extension.Extend(m)
	extension.Strikethrough.Extend(m)
	extension.TaskList.Extend(m)
}

type ltemExtension struct {
	options []extension.TableOption
}

// New returns the LTEM table extension with options of goldmark's table extension,
// such as extension.WithTableCellAlignMethod. They apply to every table.
func New(opts ...extension.TableOption) goldmark.Extender {
	return &ltemExtension{options: opts}
}

// Extend implements goldmark.Extender.
func (e *ltemExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(
		parser.WithBlockParsers(util.Prioritized(tableParser{}, 90)),
		parser.WithASTTransformers(util.Prioritized(cellTransformer{}, 0)),
	)
	m.Renderer().AddOptions(renderer.WithNodeRenderers(
		util.Prioritized(extension.NewTableHTMLRenderer(e.options...), 500),
		util.Prioritized(NewTableHTMLRenderer(e.options...), 500),
	))
}
