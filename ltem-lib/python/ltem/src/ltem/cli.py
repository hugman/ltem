"""Command-line interface.

    ltem parse    [FILE]   table models of all tables, as JSON
    ltem render   [FILE]   HTML of all tables
    ltem validate [FILE]   validation problems; exit status 1 if there are errors
    ltem fmt      [FILE]   rewrite the input with every table in canonical form
    ltem write    [FILE]   canonical LTEM of table models given as JSON
    ltem from-html [FILE] [--header-rows N] [--plain]   convert HTML tables to LTEM

Input is read from FILE or standard input. `parse`, `render`, `validate --json` and
`write` follow the command-line protocol of the LTEM conformance tests.
"""

from __future__ import annotations

import argparse
import json
import sys

from .fromhtml import from_html
from .html import render_html
from .model import Table
from .parser import find_tables
from .writer import write


def _read(path: str | None) -> str:
    """Read the input with every line ending turned into "\\n", for stdin as for files."""
    if path in (None, "-"):
        text = sys.stdin.read()
    else:
        with open(path, encoding="utf-8", newline="") as f:
            text = f.read()
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _fmt(text: str) -> str:
    """Replace each table in the text by its canonical form, keeping everything else.

    The table keeps the indentation of its first line, so a table in a list item stays there.
    """
    lines = text.split("\n")
    for result in reversed(find_tables(text)):
        assert result.table is not None
        first = lines[result.start]
        indent = first[: len(first) - len(first.lstrip(" \t"))]
        lines[result.start:result.end] = [indent + line for line in write(result.table).split("\n")]
    return "\n".join(lines)


def _write(text: str) -> int:
    """Print the canonical form of table models: one model, or {"tables": [...]}."""
    try:
        data = json.loads(text)
        items = data["tables"] if isinstance(data, dict) and "tables" in data and "version" not in data else [data]
        tables = [Table.from_dict(d) for d in items]
    except (ValueError, KeyError, TypeError) as e:
        print(f"ltem: error: not a table model: {e}", file=sys.stderr)
        return 2
    for n, table in enumerate(tables, 1):
        problems = table.check()
        if problems:
            print(f"ltem: table {n}: invalid table model: {'; '.join(problems)}", file=sys.stderr)
            return 1
    print("\n\n".join(write(t) for t in tables))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="ltem", description="LTEM tables: parse, render, validate, format.")
    sub = p.add_subparsers(dest="command", required=True)
    for name in ("parse", "render", "validate", "fmt", "write", "from-html"):
        sp = sub.add_parser(name)
        sp.add_argument("file", nargs="?")
        if name == "validate":
            sp.add_argument("--json", action="store_true", help="print problems as JSON")
        if name == "from-html":
            sp.add_argument("--header-rows", type=int, default=None,
                            help="number of header rows (default: <thead>, leading <th> rows, or 1; "
                                 "0: no header)")
            sp.add_argument("--plain", action="store_true", help="cell text only, without Markdown formatting")
    args = p.parse_args(argv)
    text = _read(args.file)
    if args.command == "write":
        return _write(text)
    if args.command == "from-html":
        converted = from_html(text, args.header_rows, "plain" if args.plain else "markdown")
        for n, item in enumerate(converted, 1):
            for w in item.warnings:
                print(f"table {n}: {w}", file=sys.stderr)
        print("\n\n".join(write(item.table) for item in converted))
        return 0
    results = find_tables(text)

    if args.command == "parse":
        json.dump({"tables": [r.table.to_dict() for r in results]}, sys.stdout, ensure_ascii=False, indent=2)
        print()
        return 0
    if args.command == "render":
        print("\n".join(render_html(r.table) for r in results))
        return 0
    if args.command == "validate":
        problems = [pr for r in results for pr in r.problems]
        if args.json:
            json.dump({"errors": [{**pr.to_dict(), "severity": pr.severity} for pr in problems]}, sys.stdout,
                      indent=2)
            print()
        else:
            for n, r in enumerate(results, 1):
                for pr in r.problems:
                    print(f"table {n}: {pr}")
        return 1 if any(pr.severity == "error" for pr in problems) else 0
    sys.stdout.write(_fmt(text))
    return 0


if __name__ == "__main__":
    sys.exit(main())
