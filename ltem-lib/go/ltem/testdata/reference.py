"""Results of the Python reference implementation of LTEM, for the Go differential test.

Usage: python reference.py IN.json OUT.json

IN.json holds a list of documents. For each document, OUT.json holds what the Go test
compares: for every table that ltem.find_tables finds, the table model, the problems,
the row forms, the table's lines, the cell sources (with byte offsets, as the Go
package gives them), the HTML with plain inline rendering and the canonical form; and
the output of `ltem fmt` for the whole document.
"""

import json
import re
import sys

import ltem
from ltem.cli import _fmt
from ltem.html import plain_inline

LINE_ENDING = re.compile(r"\r\n|\r|\n")


def byte_offset(line, index):
    return len(line[:index].encode("utf-8"))


def results(doc):
    lines = LINE_ENDING.split(doc)
    out = []
    for r in ltem.find_tables(doc):
        out.append({
            "table": r.table.to_dict(),
            "problems": [{"rule": p.rule, "row": p.row, "col": -1 if p.col is None else p.col} for p in r.problems],
            "forms": r.forms,
            "start": r.start,
            "end": r.end,
            "sources": [[s.row, s.col, s.rowspan, s.colspan, s.line,
                         byte_offset(lines[s.line], s.start), byte_offset(lines[s.line], s.end)]
                        for s in r.sources],
            "html": ltem.render_html(r.table, plain_inline),
            "canonical": ltem.write(r.table),
        })
    return out


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        docs = json.load(f)
    out = [{"results": results(doc), "fmt": _fmt(doc.replace("\r\n", "\n").replace("\r", "\n"))}
           for doc in docs]
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
