"""Line-level syntax: rows, delimiter rows, cell kinds and span attributes (spec Section 2)."""

from __future__ import annotations

import re
from dataclasses import dataclass

DELIMITER_CELL = re.compile(r":?-+:?")
# A span attribute ends the cell and is the whole cell or follows a space or tab (spec 2.6).
SPAN_ATTRIBUTE = re.compile(r"(?:^|(?<=[ \t]))\{([cr]:[0-9]+(?:,[cr]:[0-9]+)*)\}$")
# Reserved table-identifier line (spec Section 9).
IDENTIFIER_ROW = re.compile(r"^ {0,3}\|[ \t]*#[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*\|[ \t]*$")
PIPE_LED = re.compile(r"^ {0,3}\|")
LINE_BREAK = re.compile(r"\\\\")

COLSPAN_MARKER = "<<"
ROWSPAN_MARKER = "^^"


def split_row_spans(line: str) -> list[tuple[str, int, int]]:
    """Split a row into cells, as GFM does (spec 2.1), keeping where each cell is.

    Each cell is (text, start, end). `text` is trimmed of spaces and tabs, and a pipe
    preceded by a backslash becomes a literal pipe. `start` and `end` index `line` and
    cover the cell's source without the spaces and tabs around it; for an empty cell
    both are the end of its space between the pipes.
    """
    b, e = 0, len(line)
    while b < e and line[b] in " \t":
        b += 1
    while e > b and line[e - 1] in " \t":
        e -= 1
    if b < e and line[b] == "|":
        b += 1
    if e > b and line[e - 1] == "|" and not (e - 2 >= b and line[e - 2] == "\\"):
        e -= 1
    cells: list[tuple[str, int, int]] = []
    cur: list[str] = []
    cell_start = i = b
    while i < e:
        ch = line[i]
        if ch == "\\" and i + 1 < e and line[i + 1] == "|":
            cur.append("|")
            i += 2
            continue
        if ch == "|":
            cells.append(_cell_span(line, cell_start, i, cur))
            cur = []
            cell_start = i + 1
        else:
            cur.append(ch)
        i += 1
    cells.append(_cell_span(line, cell_start, e, cur))
    return cells


def _cell_span(line: str, start: int, end: int, chars: list[str]) -> tuple[str, int, int]:
    while start < end and line[start] in " \t":
        start += 1
    while end > start and line[end - 1] in " \t":
        end -= 1
    return "".join(chars).strip(" \t"), start, end


def split_row(line: str) -> list[str]:
    """Split a row into trimmed cell texts, as GFM does (spec 2.1).

    A pipe preceded by a backslash does not split cells and becomes a literal pipe.
    """
    return [text for text, _, _ in split_row_spans(line)]


def indentation(line: str) -> int:
    """Width of the leading spaces and tabs, with tab stops every 4 columns."""
    width = 0
    for ch in line:
        if ch == " ":
            width += 1
        elif ch == "\t":
            width += 4 - width % 4
        else:
            break
    return width


_LIST_DASH = re.compile(r"^ {0,3}-[ \t]")


def is_delimiter_row(line: str) -> bool:
    """A GFM delimiter row (spec 2.2).

    It has at least one pipe, is indented less than 4 spaces, and does not begin a list
    item: a line such as "- | -" is a list item, as in GFM.
    """
    if "|" not in line or indentation(line) >= 4 or _LIST_DASH.match(line):
        return False
    return all(DELIMITER_CELL.fullmatch(c) for c in split_row(line))


def is_upper_header_row(line: str) -> bool:
    """Whether a line can be a header row above the last one (spec 2.3, 9).

    It begins with a pipe, is not a reserved identifier line and does not look like a
    delimiter row.
    """
    return bool(PIPE_LED.match(line)) and not IDENTIFIER_ROW.match(line) and not is_delimiter_row(line)


# Lines that start another block and so end a table body (spec 2.4).
_BODY_END = re.compile(
    r"^ {0,3}(?:"
    r">"                                  # block quote
    r"|#{1,6}(?:[ \t]|$)"                # ATX heading
    r"|`{3,}|~{3,}"                       # fenced code
    r"|([-*_])(?:[ \t]*\1){2,}[ \t]*$"     # thematic break
    r"|(?:[-+*]|[0-9]{1,9}[.)])(?:[ \t]|$)"  # list item
    r")"
)


_SETEXT_UNDERLINE = re.compile(r"^ {0,3}(?:=+|-+)[ \t]*$")


def is_setext_underline(line: str) -> bool:
    """A line of "=" or of "-" characters, which underlines a paragraph line as a heading."""
    return bool(_SETEXT_UNDERLINE.match(line))


def starts_block(line: str) -> bool:
    """Whether a line begins a block quote, ATX heading, fenced code, thematic break or list item."""
    return bool(_BODY_END.match(line))


def ends_table_body(line: str) -> bool:
    """Whether a table ends before this line (spec 2.4): blank, indented code, or another block."""
    return not line.strip(" \t") or indentation(line) >= 4 or starts_block(line)


def alignment(cell: str) -> str | None:
    left, right = cell.startswith(":"), cell.endswith(":")
    if left and right:
        return "center"
    if right:
        return "right"
    if left:
        return "left"
    return None


@dataclass
class Attribute:
    colspan: int | None
    rowspan: int | None
    problems: list[str]


def split_attribute(text: str) -> tuple[str, Attribute | None]:
    """Remove a trailing span attribute from a content cell (spec 2.6).

    Returns the remaining text and the attribute, or (text, None) if there is none.
    """
    m = SPAN_ATTRIBUTE.search(text)
    if not m:
        return text, None
    colspan = rowspan = None
    problems = []
    for spec in m.group(1).split(","):
        key, value = spec.split(":")
        n = int(value)
        if n < 1:
            problems.append(f"span value must be a positive integer, got {value}")
            n = 1
        if key == "c":
            if colspan is not None:
                problems.append("'c' appears more than once")
                continue
            colspan = n
        else:
            if rowspan is not None:
                problems.append("'r' appears more than once")
                continue
            rowspan = n
    return text[: m.start()].rstrip(" \t"), Attribute(colspan, rowspan, problems)


# The LTEM escapes of spec 4.3, as written in cell source.
_ESCAPED_MARKER = re.compile(r"^\\(<<|\^\^)$")
_ESCAPED_ATTRIBUTE = re.compile(r"(?:^|(?<=[ \t]))\\(\{[cr]:[0-9]+(?:,[cr]:[0-9]+)*\})$")


def unescape_ltem(line: str) -> str:
    """Remove the backslash of an LTEM escape (spec 4.3), as GFM does for \\|."""
    m = _ESCAPED_MARKER.match(line)
    if m:
        return m.group(1)
    return _ESCAPED_ATTRIBUTE.sub(r"\1", line)


def cell_lines(text: str) -> str:
    """Turn cell source into model text (spec Section 7).

    Split at each \\\\, trim each line and remove LTEM escapes.
    """
    return "\n".join(unescape_ltem(part.strip(" \t")) for part in LINE_BREAK.split(text))
