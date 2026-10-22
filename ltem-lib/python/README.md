# ltem-lib/python

The Python workspace, managed with [uv](https://docs.astral.sh/uv/).

| Folder | Package | What it is |
|---|---|---|
| [`ltem/`](ltem/) | `ltem-core` (imported as `ltem`) | The core library and the `ltem` command: parse, validate, render HTML, write canonical LTEM, convert HTML tables to LTEM |
| [`mdit-py-ltem/`](mdit-py-ltem/) | `mdit-py-ltem` | Plugin for markdown-it-py |
| [`markdown-ltem/`](markdown-ltem/) | `markdown-ltem` | Extension for Python-Markdown and MkDocs |

All three are at version 0.1.0, implement LTEM 1.0 and pass every conformance case.

```
uv sync --all-packages
uv run --directory ltem pytest
uv run --directory mdit-py-ltem pytest
uv run --directory markdown-ltem pytest
```
