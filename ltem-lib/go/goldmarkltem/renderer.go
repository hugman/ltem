package goldmarkltem

import (
	"strconv"

	gast "github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	extast "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/util"
)

// TableHTMLRenderer renders LTEM table nodes as HTML, in the style of goldmark's
// table renderer (extension.TableHTMLRenderer) and with the same options: one
// <thead> with every header row, a <tbody> with the body rows if there are any,
// colspan and rowspan, and alignment as goldmark's TableCellAlignMethod says.
type TableHTMLRenderer struct {
	extension.TableConfig
}

// NewTableHTMLRenderer returns a renderer for LTEM table nodes, configured with the
// options of goldmark's table extension.
func NewTableHTMLRenderer(opts ...extension.TableOption) renderer.NodeRenderer {
	r := &TableHTMLRenderer{TableConfig: extension.NewTableConfig()}
	for _, opt := range opts {
		opt.SetTableOption(&r.TableConfig)
	}
	return r
}

// RegisterFuncs implements renderer.NodeRenderer.
func (r *TableHTMLRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(KindTable, r.renderTable)
	reg.Register(KindTableHead, r.renderSection("thead"))
	reg.Register(KindTableBody, r.renderSection("tbody"))
	reg.Register(KindTableRow, r.renderRow)
	reg.Register(KindTableCell, r.renderCell)
}

func (r *TableHTMLRenderer) renderTable(w util.BufWriter, _ []byte, n gast.Node, entering bool) (gast.WalkStatus, error) {
	if entering {
		_, _ = w.WriteString("<table")
		html.RenderAttributes(w, n, extension.TableAttributeFilter)
		_, _ = w.WriteString(">\n")
	} else {
		_, _ = w.WriteString("</table>\n")
	}
	return gast.WalkContinue, nil
}

func (r *TableHTMLRenderer) renderSection(tag string) renderer.NodeRendererFunc {
	return func(w util.BufWriter, _ []byte, n gast.Node, entering bool) (gast.WalkStatus, error) {
		if entering {
			_, _ = w.WriteString("<" + tag)
			html.RenderAttributes(w, n, extension.TableHeaderAttributeFilter)
			_, _ = w.WriteString(">\n")
		} else {
			_, _ = w.WriteString("</" + tag + ">\n")
		}
		return gast.WalkContinue, nil
	}
}

func (r *TableHTMLRenderer) renderRow(w util.BufWriter, _ []byte, n gast.Node, entering bool) (gast.WalkStatus, error) {
	if entering {
		_, _ = w.WriteString("<tr")
		html.RenderAttributes(w, n, extension.TableRowAttributeFilter)
		_, _ = w.WriteString(">\n")
	} else {
		_, _ = w.WriteString("</tr>\n")
	}
	return gast.WalkContinue, nil
}

func (r *TableHTMLRenderer) renderCell(w util.BufWriter, _ []byte, node gast.Node, entering bool) (gast.WalkStatus, error) {
	n := node.(*TableCell)
	tag, filter := "td", extension.TableTdCellAttributeFilter
	if n.Header {
		tag, filter = "th", extension.TableThCellAttributeFilter
	}
	if !entering {
		_, _ = w.WriteString("</" + tag + ">\n")
		return gast.WalkContinue, nil
	}
	_, _ = w.WriteString("<" + tag)
	if n.Colspan > 1 {
		_, _ = w.WriteString(` colspan="` + strconv.Itoa(n.Colspan) + `"`)
	}
	if n.Rowspan > 1 {
		_, _ = w.WriteString(` rowspan="` + strconv.Itoa(n.Rowspan) + `"`)
	}
	style := ""
	if n.Alignment != extast.AlignNone {
		method := r.TableCellAlignMethod
		if method == extension.TableCellAlignDefault {
			method = extension.TableCellAlignStyle
			if r.XHTML {
				method = extension.TableCellAlignAttribute
			}
		}
		switch method {
		case extension.TableCellAlignAttribute:
			if _, ok := n.AttributeString("align"); !ok { // an align attribute wins
				_, _ = w.WriteString(` align="` + n.Alignment.String() + `"`)
			}
		case extension.TableCellAlignStyle:
			style = "text-align:" + n.Alignment.String()
		}
	}
	for _, attr := range n.Attributes() {
		if string(attr.Name) == "style" && style != "" {
			style = attributeValue(attr.Value) + ";" + style
			continue
		}
		if filter.Contains(attr.Name) || len(attr.Name) > 5 && string(attr.Name[:5]) == "data-" {
			_, _ = w.WriteString(" " + string(attr.Name) + `="`)
			_, _ = w.Write(util.EscapeHTML([]byte(attributeValue(attr.Value))))
			_ = w.WriteByte('"')
		}
	}
	if style != "" {
		_, _ = w.WriteString(` style="`)
		_, _ = w.Write(util.EscapeHTML([]byte(style)))
		_ = w.WriteByte('"')
	}
	_ = w.WriteByte('>')
	return gast.WalkContinue, nil
}

// attributeValue returns the text of a node attribute, which goldmark holds as
// []byte or string.
func attributeValue(v any) string {
	switch v := v.(type) {
	case []byte:
		return string(v)
	case string:
		return v
	}
	return ""
}
