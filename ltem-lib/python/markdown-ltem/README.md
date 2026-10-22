# markdown-ltem

A [Python-Markdown](https://python-markdown.github.io/) extension for [LTEM](https://hugman.github.io/ltem/) tables: Markdown pipe tables with merged cells and multi-row headers. It works in MkDocs and Material for MkDocs.

Status: version 0.1.0, the first release, for LTEM 1.0.

```python
import markdown

html = markdown.markdown(text, extensions=["ltem"])
```

MkDocs (`mkdocs.yml`):

```yaml
markdown_extensions:
  - ltem
```

The extension handles plain GFM tables as well, so the built-in `tables` extension is not needed. If both are enabled, LTEM tables are tried first, and `tables` still handles blocks that LTEM does not treat as tables (it is more permissive, for example about indentation).

Options:

| Option | Default | Meaning |
|---|---|---|
| `use_align_attribute` | `False` | Write column alignment as an `align` attribute instead of `style="text-align: ..."` |

Unlike the built-in `tables` extension, and as in GFM, a pipe inside a code span must be escaped as `\|`.

The tables themselves are resolved by the [`ltem-core`](https://github.com/hugman/ltem/tree/main/ltem-lib/python/ltem) package (imported as `ltem`).

## Development

From `ltem-lib/python`:

```
uv sync --all-packages
uv run --directory markdown-ltem pytest
```
