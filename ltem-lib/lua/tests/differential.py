#!/usr/bin/env python3
"""Randomized differential test of the Lua implementation against the reference cores.

    uv run --directory ltem-lib/python python ../lua/tests/differential.py [--docs N] [--seed S]

Run it from the repository root with the Python workspace of LTEM, so that the
reference core (the Python package `ltem`) can be imported. It generates random
Markdown documents with a fixed seed and compares:

1. the Lua core (tests/batch.lua core) with the Python core, in-process: table
   models, validation problems, row forms, HTML (plain inline renderer),
   canonical text, cell sources and table lines;
2. the Lua core with the Rust command line (ltem-lib/rust/target/release/ltem),
   if it has been built: `parse` and `validate --json`;
3. the Pandoc readers (tests/batch.lua reader), with base formats markdown and
   commonmark_x, with the Python core: rows, columns, header rows, alignment,
   spans and cell text, for documents at the top level and the same documents
   in a block quote and in a list item. No table may be left to the base
   format.

Environment: PANDOC is the Pandoc executable (default "pandoc"). Exit status 1
if anything differs.
"""
import argparse
import json
import os
import random
import re
import subprocess
import sys

import ltem
from ltem.html import plain_inline

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
RUST = os.path.join(REPO, "ltem-lib", "rust", "target", "release", "ltem")
PANDOC = os.environ.get("PANDOC", "pandoc")

# --- Random documents --------------------------------------------------------

WORDS = ["Region", "Q1", "100", "a", "Total", "x y", "한국어", "東京", "\u3000indent", "1.5%", "-", "#", "a | b"]
MARKUP = ["**b**", "*e*", "`code`", "`a\\|b`", "[l](u)", "$x^2$", "\"q\"", "<br>", "&amp;", "@id", "x--y"]
LITERALS = ["a << b", "x{c:2}", "x {c:2} y", "{c:}", "{c:2 }", "{ c:2}", "{x:2}", "{c:2,}", "<", "^", "{", "«", "<<<",
            "^^^", "< <", "x \\{b}", "\\#", "\\-", ":--", "---", "\\", "a\\b"]
ESCAPES = ["\\<<", "\\^^", "x \\{c:2}", "\\{r:3}", "\\{c:2,r:2}", "a \\| b", "\\|", "\\|\\|"]
BREAKS = ["a \\\\ b", "a\\\\b", "a\\\\\\b", " \\\\ ", "\\\\", "x \\\\ \\<< \\\\ \\^^", "one \\\\ two {c:2}"]
ATTRS = ["{c:2}", "{r:2}", "{c:2,r:2}", "{r:2,c:3}", "{c:0}", "{r:0}", "{c:0,c:3}", "{c:3,c:0}", "{c:1}", "{r:1}",
         "{c:9}", "{r:99999999999999999999}", "{c:02}", "{c:2,r:2,c:1}", "{r:2,r:1}"]
SPACES = ["", " ", " ", "  ", "\t", " \t ", "\u3000"]

# A line that opens a list item or a block quote in CommonMark.
CONTAINER_START = re.compile(r"^ {0,3}(?:[-+*]|[0-9]{1,9}[.)])(?:[ \t]|$)|^ {0,3}>")

# Text for the reader test: plain in CommonMark and in Pandoc's Markdown alike
# (no emphasis, quotes, dashes, math, superscripts, citations or TeX commands).
READER_WORDS = ["Region", "Q1", "100", "a", "Total", "x y", "한국어", "東京", "\u3000indent", "1.5%", "-", "#",
                "a \\| b", "a << b", "x{c:2}", "x {c:2} y", "\\<<", "\\^^", "x \\{c:2}", "\\{r:3}", "a \\\\ b",
                "a\\\\\\-", "\\#", "\\-", "a\\#b", "<<<", "{c:}"]


class Gen:
    def __init__(self, rng, reader=False):
        self.rng = rng
        self.reader = reader

    def pick(self, items):
        return self.rng.choice(items)

    def text(self):
        if self.reader:
            return self.pick(READER_WORDS)
        return self.pick(self.pick([WORDS, WORDS, MARKUP, LITERALS, ESCAPES, BREAKS]))

    def cell(self):
        r = self.rng.random()
        if r < 0.2:
            return ""
        if r < 0.4:
            return self.pick(["<<", "^^"])
        text = self.text()
        if self.rng.random() < 0.25:
            attr = self.pick(ATTRS) if not self.reader else self.pick(ATTRS[:10])
            text = attr if self.rng.random() < 0.2 else text + self.pick([" ", "\t", "  "]) + attr
        return text

    def row(self, cells, leading=None):
        rng = self.rng
        if leading is None:
            leading = rng.random() < 0.85
        trailing = rng.random() < 0.8
        parts = [self.pick(SPACES[:6]) + c + self.pick(SPACES[:6]) for c in cells]
        line = "|".join(parts)
        if self.reader and CONTAINER_START.match(line):
            # A list item or block quote, which the core's top-level scan does not see.
            leading = True
        if leading:
            line = "|" + line
        if trailing or not leading and len(cells) == 1:
            line += "|"
        if rng.random() < 0.15:
            line = self.pick([" ", "  ", "   ", "\t", "    "]) + line
        return line

    def delimiter(self, cols):
        rng = self.rng
        cells = []
        for _ in range(cols):
            body = "-" * rng.randint(1, 4)
            kind = rng.random()
            if kind < 0.15:
                body = ":" + body
            elif kind < 0.3:
                body = body + ":"
            elif kind < 0.4:
                body = ":" + body + ":"
            elif kind < 0.43:
                body = self.pick(["-:-", ":", "--x", "", "=="])
            cells.append(body)
        line = self.row(cells, leading=rng.random() < 0.9)
        if rng.random() < 0.03 and not self.reader:
            line = line.replace("|", "")  # Pandoc's Markdown may read this as a simple table
        return line

    def random_model(self, rows, cols, header_rows):
        """A valid table model: spans fill free rectangles and stay within header or body."""
        rng = self.rng
        taken = [[False] * cols for _ in range(rows)]
        cells = []
        for r in range(rows):
            for c in range(cols):
                if taken[r][c]:
                    continue
                bottom = header_rows if r < header_rows else rows
                max_cs = 1
                while c + max_cs < cols and not taken[r][c + max_cs] and max_cs < 4:
                    max_cs += 1
                cs = rng.randint(1, max_cs) if rng.random() < 0.35 else 1
                rs = rng.randint(1, min(3, bottom - r)) if rng.random() < 0.35 else 1
                while rs > 1 and any(taken[r + rs - 1][c:c + cs]):
                    rs -= 1
                for dr in range(rs):
                    for dc in range(cs):
                        taken[r + dr][c + dc] = True
                cells.append((r, c, rs, cs))
        return cells

    def structured_rows(self, rows, cols, header_rows):
        """Rows of a valid table written with markers, attributes, grid and compact rows."""
        rng = self.rng
        owner = {}
        notation = {}
        for (r, c, rs, cs) in self.random_model(rows, cols, header_rows):
            notation[(r, c)] = rng.random() < 0.5  # attribute notation
            for dr in range(rs):
                for dc in range(cs):
                    owner[(r + dr, c + dc)] = (r, c, rs, cs)
        lines = []
        for r in range(rows):
            compact = rng.random() < 0.4
            cells = []
            for c in range(cols):
                o = owner[(r, c)]
                attr_form = notation[(o[0], o[1])]
                if (o[0], o[1]) == (r, c):
                    text = self.text() if rng.random() < 0.9 else ""
                    if attr_form and (o[2] > 1 or o[3] > 1):
                        spans = []
                        if o[3] > 1:
                            spans.append(f"c:{o[3]}")
                        if o[2] > 1:
                            spans.append(f"r:{o[2]}")
                        if rng.random() < 0.5:
                            spans.reverse()
                        attr = "{" + ",".join(spans) + "}"
                        text = (text + " " + attr) if text else attr
                    elif text == "" and (o[2] > 1 or o[3] > 1):
                        text = self.pick(WORDS[:5])
                    cells.append(text)
                elif attr_form:
                    if not compact:
                        cells.append(self.pick(["", "", "<<", "^^"]))
                else:
                    cells.append("^^" if c == o[1] else "<<")
            if not cells:
                cells = [""]
            lines.append(cells)
        return lines

    def table(self):
        rng = self.rng
        cols = rng.randint(1, 5)
        header_rows = self.pick([1, 1, 1, 2, 2, 3])
        body_rows = rng.randint(0, 5)
        rows = header_rows + body_rows
        if rng.random() < 0.5:
            cell_rows = self.structured_rows(rows, cols, header_rows)
        else:
            cell_rows = []
            for _ in range(rows):
                n = cols if rng.random() < 0.6 else max(1, cols + rng.randint(-2, 2))
                cell_rows.append([self.cell() for _ in range(n)])
        lines = [self.row(cells) for cells in cell_rows]
        lines.insert(header_rows, self.delimiter(cols))
        r = rng.random()
        if r < 0.05 and header_rows > 1:
            lines[0] = lines[0].lstrip(" \t|")  # an upper header row without its pipe
            if self.reader and CONTAINER_START.match(lines[0]):
                lines[0] = "Text " + lines[0]
        elif r < 0.08:
            lines.insert(0, "| # " + self.pick(["orders", "x_1", "1bad"]) + " |")
        elif r < 0.11:
            lines.insert(0, self.row(["---"] * cols))
        return lines

    def paragraph(self):
        lines = []
        for _ in range(self.rng.randint(1, 2)):
            words = [self.pick(WORDS[:8] if self.reader else WORDS + LITERALS) for _ in range(self.rng.randint(1, 4))]
            lines.append(" ".join(words))
        return lines

    def block_start(self):
        # Pandoc's Markdown reads a fence without a closing fence as text, unlike CommonMark.
        fences = [] if self.reader else ["```", "~~~"]
        return self.pick(["- item", "* item", "+ item", "1. one", "2) two", "> quote", "# Heading", "###### h6",
                          "***", "- - -", "    indented", "\tindented"] + fences)

    def document(self):
        rng = self.rng
        blocks = []
        for _ in range(rng.randint(1, 5)):
            kind = rng.random()
            if kind < 0.45:
                block = self.table()
                if rng.random() < 0.3:
                    block = self.paragraph() + block  # a table that begins inside a paragraph
                if rng.random() < 0.25:
                    start = self.block_start()
                    block = block + [start]  # a line that ends the body
                    if self.reader:
                        # Close the list or block quote, which the core's top-level scan
                        # does not see: an indented line after it would continue it.
                        block += ["", "Text"]
                elif rng.random() < 0.15:
                    block = block + self.paragraph()  # lines that become body rows
            elif kind < 0.6:
                block = self.paragraph()
            elif kind < 0.68:
                fence = self.pick(["```", "~~~~"])
                block = [fence + self.pick(["", "ltem"])] + self.table() + [fence]
                if self.reader:
                    block.insert(0, "")  # Pandoc's Markdown: a tilde fence does not interrupt a paragraph
            elif kind < 0.73:
                block = ["    " + line for line in self.table()]
            elif kind < 0.78:
                # "---" could start a YAML metadata block in Pandoc's Markdown.
                block = [self.pick(["# Heading", "Title", "==="] + ([] if self.reader else ["---"]))]
            elif kind < 0.85 and not self.reader:
                block = [self.block_start()] + self.table()
            else:
                block = self.table()
            blocks.append(block)
        out = []
        for block in blocks:
            out.extend(block)
            gap = rng.random()
            if gap < 0.75:
                out.append(self.pick(["", "", "  ", "\t"]))
            elif gap < 0.8 and not self.reader:
                out.append("\u3000")
        text = "\n".join(out) + self.pick(["", "\n"])
        if not self.reader:
            ending = rng.random()
            if ending < 0.1:
                text = text.replace("\n", "\r\n")
            elif ending < 0.13:
                text = text.replace("\n", "\r")
        return text


# --- The reference results ---------------------------------------------------


def utf8_offset(line, index):
    return len(line[:index].encode("utf-8"))


def python_core(text):
    results = ltem.find_tables(text)
    lines = re.split(r"\r\n|\r|\n", text)
    out = {"tables": [], "errors": [], "forms": [], "html": [], "canonical": [], "sources": [], "lines": []}
    for r in results:
        model = r.table.to_dict()
        del model["version"]
        out["tables"].append(model)
        out["errors"].extend({"rule": p.rule, "row": p.row, "col": p.col} for p in r.problems)
        out["forms"].append(r.forms)
        out["html"].append(ltem.render_html(r.table, plain_inline))
        out["canonical"].append(ltem.write(r.table))
        out["sources"].append([[s.row, s.col, s.rowspan, s.colspan, s.line + 1,
                                utf8_offset(lines[s.line], s.start) + 1, utf8_offset(lines[s.line], s.end)]
                               for s in r.sources])
        out["lines"].append([r.start + 1, r.end])
    return out


def error_multiset(errors):
    return sorted((e["rule"], e["row"], -1 if e["col"] is None else e["col"]) for e in errors)


def run_lua(mode, documents):
    proc = subprocess.run([PANDOC, "lua", os.path.join(HERE, "batch.lua"), mode], input=json.dumps(documents),
                          capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        raise SystemExit(f"tests/batch.lua {mode} failed: {proc.stderr[:2000]}")
    return json.loads(proc.stdout)


def rust(mode, text):
    args = [RUST] + mode
    proc = subprocess.run(args, input=text.encode("utf-8"), capture_output=True)
    return json.loads(proc.stdout.decode("utf-8"))


def reader_expected(model, fmt):
    """A core table model as the reader shows it: cell text as rendered, plain.

    Pandoc's Markdown reads a single header row of empty cells as no header.
    """
    cells = []
    for c in model["cells"]:
        lines = [re.sub(r"[ \t]+", " ", plain_inline(line).replace("&amp;", "&").replace("&lt;", "<")
                        .replace("&gt;", ">").replace("&quot;", '"')) for line in c["text"].split("\n")]
        cells.append({**c, "text": "\n".join(lines)})
    empty_header = all(c["text"] == "" for c in model["cells"] if c["row"] == 0)
    if fmt == "markdown" and model["header_rows"] == 1 and empty_header:
        cells = [{**c, "row": c["row"] - 1} for c in cells if c["row"] > 0]
        return {**model, "rows": model["rows"] - 1, "header_rows": 0, "cells": cells}
    return {**model, "cells": cells}


def normalize_reader(table):
    cells = [{**c, "text": re.sub(r" +", " ", c["text"])} for c in table["cells"]]
    return {**table, "cells": cells}


def quote(text):
    return "\n".join(("> " + line) if line.strip(" \t") else ">" for line in text.split("\n"))


def list_item(text):
    # The document starts after a first paragraph, so that its first line keeps its indentation.
    return "- Item\n\n" + "\n".join(("  " + line) if line.strip(" \t") else "" for line in text.split("\n"))


# --- Main --------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--docs", type=int, default=3000, help="documents per family (default 3000)")
    ap.add_argument("--seed", type=int, default=20261019)
    ap.add_argument("--show", type=int, default=5, help="differences to print")
    ap.add_argument("--dump", help="write all differences to this JSON file")
    args = ap.parse_args()
    failures = []

    # 1 and 2: the core.
    rng = random.Random(args.seed)
    gen = Gen(rng)
    documents = [gen.document() for _ in range(args.docs)]
    lua = run_lua("core", documents)
    tables = problems = 0
    fields = ["tables", "forms", "html", "canonical", "sources", "lines"]
    for i, (text, got) in enumerate(zip(documents, lua)):
        want = python_core(text)
        tables += len(want["tables"])
        problems += len(want["errors"])
        for field in fields:
            if got[field] != want[field]:
                failures.append(("core vs Python", field, text, got[field], want[field]))
        if error_multiset(got["errors"]) != error_multiset(want["errors"]):
            failures.append(("core vs Python", "errors", text, got["errors"], want["errors"]))
    print(f"core vs Python: {len(documents)} documents, {tables} tables, {problems} problems")

    if os.path.exists(RUST):
        for text, got in zip(documents, lua):
            parsed = [{k: v for k, v in t.items() if k != "version"} for t in rust(["parse"], text)["tables"]]
            if parsed != got["tables"]:
                failures.append(("core vs Rust", "tables", text, got["tables"], parsed))
            errors = rust(["validate", "--json"], text)["errors"]
            if error_multiset(errors) != error_multiset(got["errors"]):
                failures.append(("core vs Rust", "errors", text, got["errors"], errors))
        print(f"core vs Rust: {len(documents)} documents")
    else:
        print(f"core vs Rust: skipped, {RUST} not built")

    # 3: the Pandoc readers.
    rng = random.Random(args.seed + 1)
    gen = Gen(rng, reader=True)
    plain = [gen.document().replace("\t", "    ") for _ in range(args.docs)]
    variants = [("top level", plain), ("block quote", [quote(t) for t in plain]),
                ("list item", [list_item(t) for t in plain])]
    for name, docs in variants:
        got = run_lua("reader", docs)
        count = 0
        for text, original, result in zip(docs, plain, got):
            models = python_core(original)["tables"]
            count += len(models)
            for fmt in ("markdown", "commonmark_x"):
                want = [reader_expected(t, fmt) for t in models]
                actual = result[fmt]
                if isinstance(actual, str) or [normalize_reader(t) for t in actual] != want:
                    failures.append((f"reader {fmt} vs core ({name})", "tables", text, actual, want))
                if result[fmt + "_skipped"]:
                    failures.append((f"reader {fmt} ({name})", "tables left to the base format", text,
                                     result[fmt + "_skipped"], 0))
        print(f"readers vs core, {name}: {len(docs)} documents, {count} tables, 2 base formats")

    kinds = {}
    for label, field, *_ in failures:
        kinds[(label, field)] = kinds.get((label, field), 0) + 1
    for (label, field), n in sorted(kinds.items()):
        print(f"  {n} differences: {label}, {field}")
    for label, field, text, got, want in failures[:args.show]:
        print(f"\nDIFFERENCE {label}: {field}\ninput: {text!r}\nlua:      {json.dumps(got, ensure_ascii=False)[:1500]}"
              f"\nexpected: {json.dumps(want, ensure_ascii=False)[:1500]}")
    if args.dump:
        with open(args.dump, "w", encoding="utf-8") as f:
            records = [{"label": l, "field": fd, "input": t, "actual": g, "expected": w}
                       for l, fd, t, g, w in failures]
            json.dump(records, f, ensure_ascii=False, indent=1)
    print(f"\n{len(failures)} differences")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
