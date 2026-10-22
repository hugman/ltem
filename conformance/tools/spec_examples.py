#!/usr/bin/env python3
"""Extract the examples from the LTEM specification and check the conformance data.

Usage:
    python3 spec_examples.py extract   # print the spec examples as JSON
    python3 spec_examples.py check     # check cases/spec-examples.json

`check` verifies that:
  1. cases/spec-examples.json has the same examples (section, LTEM, HTML) as spec/ltem-spec.md
  2. every table model, in cases/spec-examples.json and cases/canonical.json, is valid
     against ast/table.schema.json (if the jsonschema package is installed) and satisfies
     the rules in ast/table-model.md
  3. the expected HTML of each example shows the same rows, cells, spans and alignment
     as its table models

Only the Python standard library is required; jsonschema is optional.
"""
import json
import os
import re
import sys
from html.parser import HTMLParser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SPEC = os.path.join(ROOT, "spec", "ltem-spec.md")
CASES = os.path.join(ROOT, "conformance", "cases", "spec-examples.json")
CANONICAL = os.path.join(ROOT, "conformance", "cases", "canonical.json")
SCHEMA = os.path.join(ROOT, "ast", "table.schema.json")

FENCE = "`" * 32
HEADING = re.compile(r"^(#{2,3}) (.+)$")


def extract(text):
    """Return the examples in the specification, in order."""
    section, out, lines, i = None, [], text.split("\n"), 0
    while i < len(lines):
        m = HEADING.match(lines[i])
        if m:
            section = m.group(2).strip()
        if lines[i] == f"{FENCE} example":
            j = lines.index(FENCE, i + 1)
            body = lines[i + 1:j]
            dot = body.index(".")
            out.append({
                "example": len(out) + 1,
                "section": section,
                "ltem": "\n".join(body[:dot]) + "\n",
                "html": "\n".join(body[dot + 1:]) + "\n",
            })
            i = j
        i += 1
    return out


def model_problems(t):
    """Check the rules in ast/table-model.md that JSON Schema cannot express."""
    problems = []
    rows, cols, header = t["rows"], t["cols"], t["header_rows"]
    if len(t["align"]) != cols:
        problems.append(f"align has {len(t['align'])} entries, expected {cols}")
    if header > rows:
        problems.append(f"header_rows {header} > rows {rows}")
    owner = [[None] * cols for _ in range(rows)]
    keys = [(c["row"], c["col"]) for c in t["cells"]]
    if keys != sorted(keys):
        problems.append("cells are not sorted by row and column")
    for c in t["cells"]:
        r0, c0, rs, cs = c["row"], c["col"], c["rowspan"], c["colspan"]
        if r0 + rs > rows or c0 + cs > cols:
            problems.append(f"cell ({r0},{c0}) extends outside the grid")
            continue
        if r0 < header < r0 + rs:
            problems.append(f"header cell ({r0},{c0}) reaches into the body")
        for r in range(r0, r0 + rs):
            for k in range(c0, c0 + cs):
                if owner[r][k] is not None:
                    problems.append(f"position ({r},{k}) belongs to two cells")
                owner[r][k] = (r0, c0)
    holes = [(r, k) for r in range(rows) for k in range(cols) if owner[r][k] is None]
    if holes:
        problems.append(f"positions without a cell: {holes[:5]}")
    for c in t["cells"]:
        if "\\\\" in c["text"]:
            problems.append(f"cell ({c['row']},{c['col']}) text holds two backslashes in a row")
    return problems


class _TableShape(HTMLParser):
    """Collect, per <table>, the rows as lists of (tag, colspan, rowspan)."""

    def __init__(self):
        super().__init__()
        self.tables, self.part = [], None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self.tables.append({"thead": 0, "rows": []})
        elif tag == "thead":
            self.part = "thead"
        elif tag == "tbody":
            self.part = "tbody"
        elif tag == "tr":
            self.tables[-1]["rows"].append([])
            if self.part == "thead":
                self.tables[-1]["thead"] += 1
        elif tag in ("th", "td"):
            self.tables[-1]["rows"][-1].append(
                (tag, int(a.get("colspan", 1)), int(a.get("rowspan", 1)), a.get("align")))


def html_problems(html, models):
    """Check that the expected HTML shows the same structure as the table models."""
    p = _TableShape()
    p.feed(html)
    if len(p.tables) != len(models):
        return [f"HTML has {len(p.tables)} tables, models list {len(models)}"]
    problems = []
    for shape, t in zip(p.tables, models):
        if shape["thead"] != t["header_rows"] or len(shape["rows"]) != t["rows"]:
            problems.append("row counts in HTML differ from the model")
            continue
        for r, html_row in enumerate(shape["rows"]):
            tag = "th" if r < t["header_rows"] else "td"
            want = [(tag, c["colspan"], c["rowspan"], t["align"][c["col"]])
                    for c in t["cells"] if c["row"] == r]
            if html_row != want:
                problems.append(f"row {r}: HTML cells {html_row} differ from the model {want}")
    return problems


def check():
    spec = extract(open(SPEC, encoding="utf-8").read())
    data = json.load(open(CASES, encoding="utf-8"))["examples"]
    failures = []
    if len(spec) != len(data):
        failures.append(f"spec has {len(spec)} examples, cases file has {len(data)}")
    for s, d in zip(spec, data):
        for key in ("example", "section", "ltem", "html"):
            if s[key] != d[key]:
                failures.append(f"example {s['example']}: '{key}' differs from the spec")
    try:
        import jsonschema
        validator = jsonschema.Draft202012Validator(json.load(open(SCHEMA, encoding="utf-8")))
    except ImportError:
        validator = None
        print("note: jsonschema not installed; skipping schema validation")
    canonical = json.load(open(CANONICAL, encoding="utf-8"))["cases"]
    models = [(f"example {d['example']}", t) for d in data for t in d["tables"]]
    models += [(f"canonical case {c['case']}", c["table"]) for c in canonical]
    for label, t in models:
        if validator:
            for e in validator.iter_errors(t):
                failures.append(f"{label}: schema: {e.message}")
        for p in model_problems(t):
            failures.append(f"{label}: model: {p}")
    for d in data:
        for p in html_problems(d["html"], d["tables"]):
            failures.append(f"example {d['example']}: html: {p}")
    for f in failures:
        print("FAIL", f)
    print(f"{len(data)} examples and {len(canonical)} canonical cases checked, {len(failures)} problems")
    return 1 if failures else 0


def main(argv):
    if len(argv) != 2 or argv[1] not in ("extract", "check"):
        print(__doc__)
        return 2
    if argv[1] == "extract":
        json.dump(extract(open(SPEC, encoding="utf-8").read()), sys.stdout, ensure_ascii=False, indent=2)
        print()
        return 0
    return check()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
