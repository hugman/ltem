#!/usr/bin/env python3
"""Run the conformance cases against any LTEM implementation through its command line.

Usage:
    python3 run.py --impl "COMMAND" [--only parse,render,validate,write] [--verbose]

COMMAND is the implementation's executable, possibly with arguments. For every case in
cases/spec-examples.json the runner calls it three times with the case's LTEM input on
standard input:

    COMMAND parse              -> JSON {"tables": [table model, ...]}
    COMMAND render             -> the HTML of every table, one <table> element per table
    COMMAND validate --json    -> JSON {"errors": [{"rule": ..., "row": ..., "col": ...}, ...]}

For every case in cases/canonical.json it calls

    COMMAND write              -> the canonical LTEM of the table model given as JSON

The exit status of `validate` is ignored. See conformance/README.md for how results
are compared.
"""
import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from html.parser import HTMLParser

CASES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "cases", "spec-examples.json")
CANONICAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "cases", "canonical.json")


_ASCII_WS = " \t\n\r\f"
_SPACES = re.compile(r"[ \t\n\r\f]+")
_TEXT_ALIGN = re.compile(r"^\s*text-align\s*:\s*(left|center|right)\s*;?\s*$")


class _Tokens(HTMLParser):
    """HTML tokens for comparison (see "HTML is normalized" in conformance/README.md)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tokens = []
        self.pre = 0

    def handle_starttag(self, tag, attrs):
        if tag == "pre":
            self.pre += 1
        norm = []
        for k, v in attrs:
            m = _TEXT_ALIGN.match(v or "") if k == "style" else None
            norm.append(("align", m.group(1)) if m else (k, v))
        self.tokens.append(("start", tag, tuple(sorted(norm))))
        if tag == "br":
            self.tokens.append(("end", "br"))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag == "pre":
            self.pre = max(0, self.pre - 1)
        if tag != "br":
            self.tokens.append(("end", tag))

    def handle_data(self, data):
        # Only ASCII whitespace is insignificant; other spaces such as U+3000 are content.
        text = data.strip(_ASCII_WS)
        if text:
            self.tokens.append(("text", text if self.pre else _SPACES.sub(" ", text)))


def normalize(html):
    """Token list of a whole HTML fragment."""
    p = _Tokens()
    p.feed(html)
    p.close()
    return p.tokens


def normalize_tables(html):
    """Token lists of the <table> elements only."""
    return [normalize(t) for t in re.findall(r"<table>.*?</table>", html, re.S)]


def error_list(errors):
    """Errors as a multiset of (rule, row, col): order does not matter, repetitions do."""
    return sorted((e["rule"], e["row"], -1 if e["col"] is None else e["col"]) for e in errors)


def call(cmd, mode, stdin):
    args = shlex.split(cmd) + mode
    proc = subprocess.run(args, input=stdin, capture_output=True, text=True, encoding="utf-8")
    if mode[0] != "validate" and proc.returncode != 0:
        raise RuntimeError(f"exit status {proc.returncode}: {proc.stderr.strip()[:200]}")
    return proc.stdout


def run_case(cmd, case, modes):
    failures = []
    if "parse" in modes:
        got = json.loads(call(cmd, ["parse"], case["ltem"]))["tables"]
        if got != case["tables"]:
            failures.append("parse")
    if "render" in modes:
        if normalize_tables(call(cmd, ["render"], case["ltem"])) != normalize_tables(case["html"]):
            failures.append("render")
    if "validate" in modes:
        got = json.loads(call(cmd, ["validate", "--json"], case["ltem"]))["errors"]
        if error_list(got) != error_list(case["errors"]):
            failures.append("validate")
    return failures


def run_write_case(cmd, case):
    got = call(cmd, ["write"], json.dumps(case["table"], ensure_ascii=False))
    return [] if got.rstrip("\n") == case["ltem"] else ["write"]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--impl", required=True, help="implementation command, e.g. 'ltem'")
    ap.add_argument("--only", default="parse,render,validate,write")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    modes = set(args.only.split(","))
    example_modes = modes & {"parse", "render", "validate"}
    cases = json.load(open(CASES, encoding="utf-8"))["examples"] if example_modes else []
    canonical = json.load(open(CANONICAL, encoding="utf-8"))["cases"] if "write" in modes else []
    passed = {m: 0 for m in modes}
    total = {m: len(canonical) if m == "write" else len(cases) for m in modes}
    failed = 0
    runs = [(f"example {c['example']} ({c['section']})", example_modes, lambda c=c: run_case(args.impl, c, example_modes))
            for c in cases]
    runs += [(f"canonical case {c['case']} ({c['name']})", {"write"}, lambda c=c: run_write_case(args.impl, c))
             for c in canonical]
    for label, case_modes, run in runs:
        note = ""
        try:
            failures = run()
        except Exception as e:  # a crash fails every mode of this case; report and continue
            failures, note = sorted(case_modes), f" (error: {e})"
        for m in case_modes:
            if m not in failures:
                passed[m] += 1
        if failures:
            failed += 1
            print(f"FAIL {label}: {', '.join(failures)}{note}")
        elif args.verbose:
            print(f"ok   {label}")
    summary = ", ".join(f"{m} {passed[m]}/{total[m]}" for m in sorted(modes))
    print(f"{summary}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
