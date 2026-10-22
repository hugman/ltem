"""Converting HTML tables to LTEM table models.

The grid is formed as in the HTML table model: cells take the next free position,
rowspan="0" reaches the end of its row group, and spans stop at the end of their row
group (thead, tbody, tfoot). Cell content becomes inline Markdown.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser

from .model import Cell, Table
from .writer import write

_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
_BLOCK = {"p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre",
          "section", "article", "header", "footer", "dl", "dt", "dd", "figure", "figcaption", "table"}
_CELL = {"td", "th"}
_GROUP = {"thead", "tbody", "tfoot"}
_TEXT_ALIGN = re.compile(r"text-align\s*:\s*(left|center|right)", re.I | re.A)
_MAX_SPAN = 1000


@dataclass
class _Node:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list[_Node | str] = field(default_factory=list)
    parent: _Node | None = None


class _TreeBuilder(HTMLParser):
    """A small, forgiving HTML tree builder that closes table elements implicitly."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = _Node("#root")
        self.cur = self.root

    def _close_until(self, tags: set[str], stop: set[str]) -> None:
        """Close open elements up to and including the nearest one in `tags`, not past `stop`."""
        node: _Node | None = self.cur
        while node is not None and node.tag not in stop:
            if node.tag in tags:
                self.cur = node.parent or self.root
                return
            node = node.parent

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _CELL:
            self._close_until(_CELL, {"tr", "table"})
        elif tag == "tr":
            self._close_until({"tr"}, {"table"} | _GROUP)
            self._close_until(_CELL, {"table"})
        elif tag in _GROUP:
            self._close_until(_GROUP, {"table"})
        elif tag == "p":
            self._close_until({"p"}, _CELL | {"table"})
        elif tag == "li":
            self._close_until({"li"}, {"ul", "ol"} | _CELL)
        node = _Node(tag, {k: v or "" for k, v in attrs}, parent=self.cur)
        self.cur.children.append(node)
        if tag not in _VOID:
            self.cur = node

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.cur.children.append(_Node(tag, {k: v or "" for k, v in attrs}, parent=self.cur))

    def handle_endtag(self, tag: str) -> None:
        if tag in _VOID:
            return
        node: _Node | None = self.cur
        while node is not None and node is not self.root:
            if node.tag == tag:
                self.cur = node.parent or self.root
                return
            node = node.parent

    def handle_data(self, data: str) -> None:
        # html.parser may deliver one run of text in pieces (it splits at a lone "<").
        # Keep a run together so that escaping sees its neighbours.
        if self.cur.children and isinstance(self.cur.children[-1], str):
            self.cur.children[-1] += data
        else:
            self.cur.children.append(data)


# -- inline content -----------------------------------------------------------------

# HTML collapses ASCII whitespace only; other spaces such as U+3000 are content (spec 2.1).
_ASCII_WS = " \t\n\f\r"
_WS = re.compile(r"[ \t\n\f\r]+")


def _escape_text(s: str) -> str:
    """Escape text so that CommonMark reads it literally and LTEM sees no line break."""
    out = []
    for i, ch in enumerate(s):
        nxt = s[i + 1] if i + 1 < len(s) else ""
        prev = s[i - 1] if i > 0 else ""
        if ch == "\\":
            # A backslash before punctuation would be an escape, and "\\" an LTEM line break.
            # At the end of the text, what follows is not known yet (_cell_text undoes this
            # at the end of a line).
            out.append("&#92;" if (not nxt or (not nxt.isalnum() and not nxt.isspace())) else "\\")
        elif ch in "*`[]":
            out.append("\\" + ch)
        elif ch == "_" and not (prev.isalnum() and nxt.isalnum()):
            out.append("\\_")
        elif ch == "<" and nxt and (nxt.isalpha() or nxt in "/!?"):
            out.append("\\<")
        elif ch == "&" and re.match(r"&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);", s[i:]):
            out.append("\\&")
        else:
            out.append(ch)
    return "".join(out)


def _inline(node: _Node, warnings: list[str], plain: bool = False) -> str:
    """Inline Markdown for the children of node. Line breaks are "\\n".

    With `plain`, formatting elements give their text only, escaped so that it reads
    literally; no Markdown emphasis, code spans, links or images are produced.
    """
    parts: list[str] = []
    for child in node.children:
        if isinstance(child, str):
            parts.append(_escape_text(_WS.sub(" ", child)))
            continue
        tag = child.tag
        if tag == "br":
            parts.append("\n")
        elif tag == "table":
            warnings.append("a table inside a cell was flattened to text (not supported in LTEM 1.0)")
            rows = []
            for tr in _iter(child, "tr"):
                rows.append("; ".join(_inline(td, warnings, plain).replace("\n", " ").strip(_ASCII_WS)
                                      for td in tr.children if isinstance(td, _Node) and td.tag in _CELL))
            parts.append("\n" + "\n".join(rows) + "\n")
        elif tag == "li":
            parent = child.parent
            n = 0
            if parent is not None:
                for c in parent.children:
                    if c is child:
                        break
                    if isinstance(c, _Node) and c.tag == "li":
                        n += 1
            bullet = f"{n + 1}. " if parent is not None and parent.tag == "ol" else "- "
            parts.append("\n" + bullet + _inline(child, warnings, plain).strip(_ASCII_WS) + "\n")
        elif tag in _BLOCK:
            parts.append("\n" + _inline(child, warnings, plain) + "\n")
        elif plain and tag in ("strong", "b", "em", "i", "s", "del", "strike", "a", "sup", "sub"):
            parts.append(_inline(child, warnings, plain))
        elif plain and tag == "code":
            parts.append(_escape_text("".join(_texts(child))))
        elif plain and tag == "img":
            parts.append(_escape_text(child.attrs.get("alt", "")))
        elif tag in ("strong", "b"):
            parts.append(_wrap("**", _inline(child, warnings, plain)))
        elif tag in ("em", "i"):
            parts.append(_wrap("*", _inline(child, warnings, plain)))
        elif tag in ("s", "del", "strike"):
            parts.append(_wrap("~~", _inline(child, warnings, plain)))
        elif tag == "code":
            text = "".join(_texts(child))
            if "\\\\" in text:
                # A code span cannot escape a backslash, and LTEM 1.0 reads "\\" as a line break.
                warnings.append("a code span with two backslashes in a row became plain text; "
                                "LTEM 1.0 cell text cannot hold \\\\")
                parts.append(_escape_text(text))
            else:
                fence = "``" if "`" in text else "`"
                parts.append(f"{fence}{text}{fence}" if text else "")
        elif tag == "a" and child.attrs.get("href"):
            parts.append(f"[{_inline(child, warnings, plain).strip(_ASCII_WS)}]({_destination(child.attrs['href'])})")
        elif tag == "img":
            alt = _escape_text(child.attrs.get("alt", ""))
            parts.append(f"![{alt}]({_destination(child.attrs.get('src', ''))})")
        elif tag in ("sup", "sub"):
            parts.append(f"<{tag}>{_inline(child, warnings, plain).strip(_ASCII_WS)}</{tag}>")
        else:
            parts.append(_inline(child, warnings, plain))
    return "".join(parts)


def _destination(url: str) -> str:
    """A link destination with its backslashes as character references.

    CommonMark reads a backslash in a destination as an escape, and LTEM reads "\\\\" as
    a line break; a character reference keeps the backslash.
    """
    return url.replace("\\", "&#92;")


def _wrap(mark: str, text: str) -> str:
    """Put emphasis marks around text, outside any leading or trailing whitespace.

    Unicode whitespace (U+3000 too) goes outside the marks, because CommonMark does not
    open or close emphasis next to it; the whitespace itself is kept.
    """
    stripped = text.strip()
    if not stripped:
        return text
    lead = text[: len(text) - len(text.lstrip())]
    trail = text[len(text.rstrip()):]
    return f"{lead}{mark}{stripped}{mark}{trail}"


def _texts(node: _Node):
    for child in node.children:
        if isinstance(child, str):
            yield child
        else:
            yield from _texts(child)


def _iter(node: _Node, tag: str, stop: set[str] = frozenset()):
    for child in node.children:
        if isinstance(child, _Node):
            if child.tag == tag:
                yield child
            elif child.tag not in stop:
                yield from _iter(child, tag, stop)


def _cell_text(td: _Node, warnings: list[str], plain: bool = False) -> str:
    """Model text of a cell: inline Markdown, one line per line break, no empty lines."""
    lines = (_line_end(_WS.sub(" ", line).strip(_ASCII_WS)) for line in _inline(td, warnings, plain).split("\n"))
    return "\n".join(line for line in lines if line)


def _line_end(line: str) -> str:
    """Write a backslash that ends a line as itself: nothing follows it there."""
    if line.endswith("&#92;") and not line.endswith("\\&#92;"):
        return line[:-5] + "\\"
    return line


# -- grid --------------------------------------------------------------------------

_HTML_SPACE = " \t\n\f\r"
_DIGITS = re.compile(r"[0-9]+")
_MAX_ROWSPAN = 65534


def _non_negative(value: str | None) -> int | None:
    """HTML's rules for parsing non-negative integers; None on error."""
    s = (value or "").lstrip(_HTML_SPACE)
    negative = s.startswith("-")
    if s[:1] in ("-", "+"):
        s = s[1:]
    m = _DIGITS.match(s)
    if not m:
        return None
    n = int(m.group())
    return None if negative and n else n


def _colspan(value: str | None) -> int:
    n = _non_negative(value)
    return 1 if not n else min(n, _MAX_SPAN)


def _rowspan(value: str | None) -> int:
    """Row span; 0 means "to the end of the row group"."""
    n = _non_negative(value)
    return 1 if n is None else min(n, _MAX_ROWSPAN)


def _rows_by_group(table: _Node) -> list[tuple[str, list[_Node]]]:
    """Row groups in display order, as in the HTML table model.

    The first <thead> comes first and the first <tfoot> last. Every other group,
    including a later <thead> or <tfoot> and each run of rows outside any group,
    keeps its place in the document.
    """
    head: list[_Node] | None = None
    foot: list[_Node] | None = None
    body: list[tuple[str, list[_Node]]] = []
    loose: list[_Node] = []

    def end_loose() -> None:
        if loose:
            body.append(("tbody", loose[:]))
            loose.clear()

    for child in table.children:
        if not isinstance(child, _Node):
            continue
        if child.tag in _GROUP:
            end_loose()
            rows = list(_iter(child, "tr", {"table"}))
            if child.tag == "thead" and head is None:
                head = rows
            elif child.tag == "tfoot" and foot is None:
                foot = rows
            else:
                body.append(("tbody", rows))
        elif child.tag == "tr":
            loose.append(child)
        elif child.tag not in ("caption", "colgroup", "col"):
            loose += list(_iter(child, "tr", {"table"}))
    end_loose()
    return ([("thead", head)] if head is not None else []) + body + ([("tfoot", foot)] if foot is not None else [])


@dataclass
class HtmlTable:
    """A converted table and the notes produced while converting it."""

    table: Table
    warnings: list[str]


def _convert(table_node: _Node, header_rows: int | None, plain: bool = False) -> HtmlTable | None:
    warnings: list[str] = []
    # header_rows=0: the table has no header. LTEM 1.0 needs one, so it gets a header row of
    # empty cells and every HTML row becomes a body row (spec Section 11).
    headerless = header_rows == 0
    groups = _rows_by_group(table_node)
    rows: list[list[_Node]] = []
    group_end: list[int] = []  # for each row, the index just past its row group
    thead_rows = 0
    for tag, trs in groups:
        start = len(rows)
        for tr in trs:
            rows.append([c for c in tr.children if isinstance(c, _Node) and c.tag in _CELL])
        group_end += [len(rows)] * (len(rows) - start)
        if tag == "thead":  # only the first <thead> is a header group
            thead_rows = len(rows) - start
    if not rows:
        return None

    if header_rows is None:
        if thead_rows:
            header_rows = thead_rows
        else:
            header_rows = 0
            while header_rows < len(rows) and rows[header_rows] and \
                    all(c.tag == "th" for c in rows[header_rows]):
                header_rows += 1
            if header_rows == 0:
                header_rows = 1
                warnings.append("the HTML table has no header row; its first row is used as the header")
    header_rows = 0 if headerless else max(1, min(header_rows, len(rows)))

    occupied: dict[tuple[int, int], bool] = {}
    placed: list[tuple[int, int, int, int, _Node]] = []
    for r, cells in enumerate(rows):
        c = 0
        for td in cells:
            while occupied.get((r, c)):
                c += 1
            colspan = _colspan(td.attrs.get("colspan"))
            rowspan = _rowspan(td.attrs.get("rowspan"))
            end = group_end[r]
            rowspan = end - r if rowspan == 0 else min(rowspan, end - r)
            # Cut a colspan that would run into a cell spanning down from above.
            k = 1
            while k < colspan and not occupied.get((r, c + k)):
                k += 1
            if k < colspan:
                warnings.append(f"a colspan in row {r} was cut to avoid overlapping a rowspan")
                colspan = k
            j = 1
            while j < rowspan and not any(occupied.get((r + j, c + d)) for d in range(colspan)):
                j += 1
            if j < rowspan:
                warnings.append(f"a rowspan in row {r} was cut to avoid overlapping another cell")
                rowspan = j
            for dr in range(rowspan):
                for dc in range(colspan):
                    occupied[(r + dr, c + dc)] = True
            placed.append((r, c, rowspan, colspan, td))
            c += colspan
    # A header cell must not reach into the body (spec V7). Its rowspan is cut at the last
    # header row after placement, so no cell moves; the body positions it covered become
    # empty cells.
    for i, (r, c, rowspan, colspan, td) in enumerate(placed):
        if r < header_rows < r + rowspan:
            for dr in range(header_rows, r + rowspan):
                for dc in range(c, c + colspan):
                    occupied[(dr, dc)] = False
            placed[i] = (r, c, header_rows - r, colspan, td)
            warnings.append(f"a rowspan in row {r} was cut at the end of the header rows; "
                            "header cells do not reach into the body")
    cols = max((c + cs for _, c, _, cs, _ in placed), default=1)

    row_headers = sum(1 for r, _, _, _, td in placed if td.tag == "th" and r >= header_rows)
    if row_headers:
        warnings.append(f"{row_headers} header cells (<th>) outside the header rows became ordinary cells; "
                        "LTEM 1.0 has no row headers")

    cells_out = [Cell(r, c, rs, cs, _cell_text(td, warnings, plain)) for r, c, rs, cs, td in placed]
    for r in range(len(rows)):
        for c in range(cols):
            if not occupied.get((r, c)):
                cells_out.append(Cell(r, c, 1, 1, ""))
    if headerless:
        cells_out = [Cell(0, c, 1, 1, "") for c in range(cols)] + \
                    [Cell(x.row + 1, x.col, x.rowspan, x.colspan, x.text) for x in cells_out]
    cells_out.sort(key=lambda x: (x.row, x.col))

    align: list[str | None] = []
    by_origin: dict[int, set[str | None]] = {}
    for r, c, _, _, td in placed:
        by_origin.setdefault(c, set()).add(_alignment(td))
    for c in range(cols):
        values = by_origin.get(c, {None})
        align.append(values.pop() if len(values) == 1 else None)
    if headerless:
        return HtmlTable(Table(len(rows) + 1, cols, 1, align, cells_out), warnings)
    return HtmlTable(Table(len(rows), cols, header_rows, align, cells_out), warnings)


def _alignment(td: _Node) -> str | None:
    a = td.attrs.get("align", "").strip().lower()
    if a in ("left", "center", "right"):
        return a
    m = _TEXT_ALIGN.search(td.attrs.get("style", ""))
    return m.group(1).lower() if m else None


def from_html(html: str, header_rows: int | None = None, inline: str = "markdown") -> list[HtmlTable]:
    """Convert every top-level <table> in an HTML string.

    `header_rows` sets the number of header rows. By default it is the number of rows in
    <thead>; without <thead>, the number of leading rows made only of <th> cells; and if
    there are none, 1. With 0, the table has no header: it gets one header row of empty
    cells and every HTML row becomes a body row (spec Section 11). A header cell whose
    rowspan reaches into the body is cut at the last header row, with a warning; no other
    cell moves.

    `inline` is "markdown" (keep emphasis, code, links and images as Markdown) or
    "plain" (text only). Either way, text is escaped so that it reads literally.
    """
    if inline not in ("markdown", "plain"):
        raise ValueError(f'inline must be "markdown" or "plain", not {inline!r}')
    builder = _TreeBuilder()
    builder.feed(html)
    builder.close()
    out = []
    for node in _iter(builder.root, "table", {"table"}):
        converted = _convert(node, header_rows, inline == "plain")
        if converted is not None:
            out.append(converted)
    return out


def html_to_ltem(html: str, header_rows: int | None = None, inline: str = "markdown") -> str:
    """Convert every top-level <table> in an HTML string to canonical LTEM."""
    return "\n\n".join(write(t.table) for t in from_html(html, header_rows, inline))
