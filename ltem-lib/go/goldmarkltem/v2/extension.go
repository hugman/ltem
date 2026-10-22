// Package goldmarkltem is a goldmark v2 extension for LTEM tables: Markdown pipe
// tables with merged cells (<<, ^^, {c:N}, {r:M}), several header rows and line
// breaks in cells (\\), as defined by the LTEM specification, version 1.0.
//
//	p := parser.New(parser.WithExtensions(goldmarkltem.Parser))
//	r := html.New(html.WithExtensions(goldmarkltem.HTMLRenderer))
//	doc := p.Parse(source)
//	err := r.Render(&buf, source, doc)
//
// [Parser] and [HTMLRenderer] take the place of goldmark's extension.TableParser and
// extension.TableHTMLRenderer; use one pair or the other. [GFMParser] and
// [GFMHTMLRenderer] are goldmark's GFM extensions with LTEM tables. A table without
// LTEM notation renders as with goldmark's table extension.
//
// Cell text is parsed as goldmark inlines, so inline extensions apply in cells. A table
// with one header row and no merged cells is built from the nodes of goldmark's table
// extension (extension/ast) and rendered by its renderer; other tables are built from
// this package's nodes ([Table], [TableHead], [TableBody], [TableRow], [TableCell]).
//
// The package for goldmark v1 is github.com/hugman/ltem/ltem-lib/go/goldmarkltem.
package goldmarkltem

import (
	gast "github.com/yuin/goldmark/v2/ast"
	"github.com/yuin/goldmark/v2/extension"
	"github.com/yuin/goldmark/v2/parser"
	"github.com/yuin/goldmark/v2/renderer/html"
	"github.com/yuin/goldmark/v2/util"
)

// Parser is the parser extension for LTEM tables.
var Parser = NewParser()

// NewParser returns the parser extension for LTEM tables.
func NewParser() parser.Extension { return parserExtension{} }

type parserExtension struct{}

func (parserExtension) ParserOptions(*parser.Config) []parser.Option {
	return []parser.Option{
		parser.WithBlockParsers(util.Prioritized[parser.BlockParser](tableParser{}, 90)),
		parser.WithASTTransformers(util.Prioritized[parser.ASTTransformer](cellTransformer{}, 0)),
	}
}

// HTMLRenderer is the HTML renderer extension for LTEM tables, with the default
// options.
var HTMLRenderer = NewHTMLRenderer()

// HTMLRendererOption is an option of [NewHTMLRenderer].
type HTMLRendererOption func(*TableHTMLRenderer)

// WithTableCellAlignMethod sets how cells are aligned, as the option of goldmark's
// table extension with the same name does.
func WithTableCellAlignMethod(method extension.TableCellAlignMethod) HTMLRendererOption {
	return func(r *TableHTMLRenderer) { r.AlignMethod = method }
}

// NewHTMLRenderer returns the HTML renderer extension for LTEM tables. It renders
// goldmark's table nodes with goldmark's table renderer, and LTEM table nodes with a
// [TableHTMLRenderer], both with the given options.
func NewHTMLRenderer(opts ...HTMLRendererOption) html.Extension {
	r := &TableHTMLRenderer{}
	for _, opt := range opts {
		opt(r)
	}
	return r
}

// RendererOptions implements html.Extension.
func (r *TableHTMLRenderer) RendererOptions(c *html.Config) []html.Option {
	// The renderer for this configuration is a copy: an extension can serve several
	// HTML renderers, with and without XHTML.
	cr := &TableHTMLRenderer{AlignMethod: r.AlignMethod, XHTML: r.XHTML || c.XHTML}
	opts := extension.NewTableHTMLRenderer(extension.WithTableCellAlignMethod(r.AlignMethod)).RendererOptions(c)
	return append(opts, html.WithNodeRenderers(map[gast.NodeKind]html.NodeRenderer{
		KindTable:     html.NodeRendererFunc(cr.renderTable),
		KindTableHead: html.NodeRendererFunc(cr.renderSection("thead", extension.TableHeaderAttributeFilter)),
		KindTableBody: html.NodeRendererFunc(cr.renderSection("tbody", extension.TableBodyAttributeFilter)),
		KindTableRow:  html.NodeRendererFunc(cr.renderRow),
		KindTableCell: html.NodeRendererFunc(cr.renderCell),
	}))
}

// GFMParser is goldmark's GitHub Flavored Markdown parser extension
// (extension.GFMParser) with LTEM tables in place of GFM tables.
var GFMParser parser.Extension = gfmParser{}

type gfmParser struct{}

func (gfmParser) ParserOptions(c *parser.Config) []parser.Option {
	var opts []parser.Option
	for _, e := range []parser.Extension{extension.LinkifyParser, Parser, extension.StrikethroughParser, extension.TaskListItemParser} {
		opts = append(opts, e.ParserOptions(c)...)
	}
	return opts
}

// GFMHTMLRenderer is goldmark's GitHub Flavored Markdown renderer extension
// (extension.GFMHTMLRenderer) with LTEM tables in place of GFM tables.
var GFMHTMLRenderer html.Extension = gfmHTMLRenderer{}

type gfmHTMLRenderer struct{}

func (gfmHTMLRenderer) RendererOptions(c *html.Config) []html.Option {
	var opts []html.Option
	for _, e := range []html.Extension{NewHTMLRenderer(), extension.StrikethroughHTMLRenderer, extension.TaskListItemHTMLRenderer} {
		opts = append(opts, e.RendererOptions(c)...)
	}
	return opts
}
