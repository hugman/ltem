# ltem-lib/python

The Python workspace, managed with [uv](https://docs.astral.sh/uv/).

| Folder | Package | What it is |
|---|---|---|
| [`ltem/`](https://github.com/hugman/ltem/tree/main/ltem-lib/python/ltem) | `ltem-core` (imported as `ltem`) | The core library and the `ltem` command: parse, validate, render HTML, write canonical LTEM, convert HTML tables to LTEM |
| [`mdit-py-ltem/`](https://github.com/hugman/ltem/tree/main/ltem-lib/python/mdit-py-ltem) | `mdit-py-ltem` | Plugin for markdown-it-py |
| [`markdown-ltem/`](https://github.com/hugman/ltem/tree/main/ltem-lib/python/markdown-ltem) | `markdown-ltem` | Extension for Python-Markdown and MkDocs |

They implement LTEM 1.0 and pass every conformance case. `ltem-core` (version 0.1.1) is on PyPI; the two plugins (version 0.1.0) are not yet published.

```
uv sync --all-packages
uv run --directory ltem pytest
uv run --directory mdit-py-ltem pytest
uv run --directory markdown-ltem pytest
```
