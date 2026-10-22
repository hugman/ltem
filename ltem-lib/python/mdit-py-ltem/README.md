# mdit-py-ltem

A [markdown-it-py](https://github.com/executablebooks/markdown-it-py) plugin for [LTEM](../../../README.md) tables: Markdown pipe tables with merged cells and multi-row headers.

Status: version 0.1.0, the first release, for LTEM 1.0.

```python
from markdown_it import MarkdownIt
from mdit_py_ltem import ltem_plugin

md = MarkdownIt("commonmark").use(ltem_plugin)
print(md.render("""\
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
"""))
```

The plugin replaces markdown-it's GFM table rule, and enables it in presets where it is off, such as `commonmark`. Plain GFM tables render as before. Cell text is parsed by markdown-it, so emphasis, links, code and any inline plugins work inside cells. Column alignment is written as `style="text-align:..."`, as markdown-it does for GFM tables.

Every `th_open` and `td_open` token has `map = [line, line + 1]` and `meta["ltem"]`, a dict with the cell's `row`, `col`, `rowspan`, `colspan`, its document `line`, and `start` and `end`: the columns of the cell's source in that raw document line, in Python string units (code points). Use them to link a rendered cell back to its source.

The tables themselves are resolved by the [`ltem-core`](../ltem/) package (imported as `ltem`).

## Development

From `ltem-lib/python`:

```
uv sync --all-packages
uv run --directory mdit-py-ltem pytest
```
