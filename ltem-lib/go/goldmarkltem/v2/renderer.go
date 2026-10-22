package goldmarkltem

import (
	"io"
	"strconv"
	"strings"

	gast "github.com/yuin/goldmark/v2/ast"
	"github.com/yuin/goldmark/v2/extension"
	extast "github.com/yuin/goldmark/v2/extension/ast"
	"github.com/yuin/goldmark/v2/renderer"
	"github.com/yuin/goldmark/v2/renderer/html"
	"github.com/yuin/goldmark/v2/util"
)

// TableHTMLRenderer renders LTEM table nodes as HTML, in the style of goldmark's
// table renderer: one <thead> with every header row, a <tbody> with the body rows if
// there are any, colspan and rowspan, and alignment as AlignMethod says. It is the
// html.Extension that [NewHTMLRenderer] returns.
type TableHTMLRenderer struct {
	// AlignMethod tells how cells are aligned, as in goldmark's table extension.
	AlignMethod extension.TableCellAlignMethod
	// XHTML is set for XHTML output; RendererOptions sets it from the renderer's
	// configuration.
	XHTML bool
}

func (r *TableHTMLRenderer) renderTable(writer io.Writer, source []byte, n gast.Node, entering bool,
	rc renderer.Context) (gast.WalkStatus, error) {
	w := writer.(util.BufWriter)
	if entering {
		_, _ = w.WriteString("<table")
		html.RenderAttributes(w, source, n, extension.TableAttributeFilter, rc)
		_, _ = w.WriteString(">\n")
	} else {
		_, _ = w.WriteString("</table>\n")
	}
	return gast.WalkContinue, nil
}

// renderFunc is the signature of a function that renders a node as HTML.
type renderFunc = func(writer io.Writer, source []byte, n gast.Node, entering bool, rc renderer.Context) (gast.WalkStatus, error)

func (r *TableHTMLRenderer) renderSection(tag string, filter util.BytesFilter) renderFunc {
	return func(writer io.Writer, source []byte, n gast.Node, entering bool, rc renderer.Context) (gast.WalkStatus, error) {
		w := writer.(util.BufWriter)
		if entering {
			_, _ = w.WriteString("<" + tag)
			html.RenderAttributes(w, source, n, filter, rc)
			_, _ = w.WriteString(">\n")
		} else {
			_, _ = w.WriteString("</" + tag + ">\n")
		}
		return gast.WalkContinue, nil
	}
}

func (r *TableHTMLRenderer) renderRow(writer io.Writer, source []byte, n gast.Node, entering bool,
	rc renderer.Context) (gast.WalkStatus, error) {
	w := writer.(util.BufWriter)
	if entering {
		_, _ = w.WriteString("<tr")
		html.RenderAttributes(w, source, n, extension.TableRowAttributeFilter, rc)
		_, _ = w.WriteString(">\n")
	} else {
		_, _ = w.WriteString("</tr>\n")
	}
	return gast.WalkContinue, nil
}

func (r *TableHTMLRenderer) renderCell(writer io.Writer, source []byte, node gast.Node, entering bool,
	_ renderer.Context) (gast.WalkStatus, error) {
	w := writer.(util.BufWriter)
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
		method := r.AlignMethod
		if method == extension.TableCellAlignDefault {
			method = extension.TableCellAlignStyle
			if r.XHTML {
				method = extension.TableCellAlignAttribute
			}
		}
		switch method {
		case extension.TableCellAlignAttribute:
			if _, ok := n.Attribute("align"); !ok { // an align attribute wins
				_, _ = w.WriteString(` align="` + n.Alignment.String() + `"`)
			}
		case extension.TableCellAlignStyle:
			style = "text-align:" + n.Alignment.String()
		}
	}
	for _, attr := range n.Attributes() {
		value := attr.Value.Str(source)
		if attr.Name == "style" && style != "" {
			style = value + ";" + style
			continue
		}
		if filter.Contains([]byte(attr.Name)) || strings.HasPrefix(attr.Name, "data-") {
			_, _ = w.WriteString(" " + attr.Name + `="`)
			_, _ = w.Write(util.EscapeHTML([]byte(value)))
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
