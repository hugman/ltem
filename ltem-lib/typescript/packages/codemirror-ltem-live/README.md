# codemirror-ltem-live

Live Preview for Markdown in [CodeMirror 6](https://codemirror.net/), with [LTEM](https://hugman.github.io/ltem/) tables: Markdown marks are shown only where the cursor is, and the rest of the document is shown as it will be rendered. Tables are LTEM tables, shown and edited as tables by [`codemirror-ltem`](https://github.com/hugman/ltem/tree/main/ltem-lib/typescript/packages/codemirror-ltem).

Status: version 0.1.10. It works with LTEM 1.0 and does not change the Markdown or LTEM syntax. Its features are on by default, and an application can switch each of them in its settings, with names and descriptions in English and Korean ([Settings](#settings)).

```ts
import { EditorView, basicSetup } from "codemirror";
import { liveMarkdown, toggleLivePreview } from "codemirror-ltem-live";

const view = new EditorView({
  extensions: [
    basicSetup,
    liveMarkdown({
      live: {
        openLink: (url) => window.open(url),
        resolveImage: (src) => `app://document/${src}`,
      },
    }),
  ],
  parent: document.body,
});

toggleLivePreview(view); // to the source, and back
```

## What it shows

| Element | Away from the cursor | Marks shown again |
|---|---|---|
| Headings (`#`, underlined) | Larger, bold; `#` and underlines hidden | On the heading's line |
| Bold, italic, strikethrough, inline code | Styled; `**`, `*`, `~~`, `` ` `` hidden | When the selection touches the element |
| Highlights (`==text==`) | Highlighted; `==` hidden | When the selection touches the element |
| Links (inline, references, autolinks, bare URLs) | Link text only; Ctrl-click (Cmd-click) opens it through `openLink` | When the selection touches the link |
| Images | The image, through `resolveImage`; never from the network | When the selection touches the image |
| Bullet lists, task lists | Bullets; check boxes that toggle `[ ]` and `[x]` | On the item's line |
| Block quotes | A bar for each level of nesting; `>` hidden | On the line |
| Code blocks | A box, highlighted by its language; the fences' lines empty, the language shown | When the selection is in the block |
| Horizontal rules | A rule | On the line |
| Escapes (`\*`) | The character only | When the selection touches it |
| Line breaks (two spaces or `\` at the end of a line) | A small ↵ | On the line, where the spaces are marked |
| Footnotes | References and inline footnotes as numbers (`[1]`, `[1:1]`) as markdown-it-footnote numbers them; definitions' labels as `1.`; Ctrl-click goes from a reference to its definition and back | When the selection touches it (the definition's line) |
| LTEM tables | Tables, edited where they are shown (cells, ranges, the table menu) | When the cursor is in the table, on an Alt-click, or with the handle left of the table (a handle at the same place on the source goes back) |
| Math, Mermaid, front matter | Drawn by your functions | When the selection is in it |

Live Preview reads Markdown as the preview does: markdown-it with markdown-it-ltem, `linkify` on and `html` off (`markdownItSyntax`). Like markdown-it, it reads no subscript, superscript or emoji shortcodes, splits runs of tildes into pairs for strikethrough, and finds bare links as markdown-it's linkify does, with linkify-it: `http(s)://` and `ftp://` URLs and e-mail addresses, but not bare `www.` addresses; where a URL ends next to punctuation, math or marks is where markdown-it ends it. HTML is text, as with markdown-it's default `html: false`. Highlights (`==text==`) are read as markdown-it-mark reads them. The tests compare the elements it styles with the ones markdown-it renders on random documents (2,000, and 2,000 with footnotes, with math, highlights, bare links next to punctuation, math and escapes, HTML lines, and syntax that only CodeMirror's Markdown has); 480,000 of them were compared once.

One difference is known: a reference link to a label that is not defined, right before another bracket (`[a][b](url)` where `b` is not defined), which markdown-it reads again from the second bracket.

During an IME composition (Korean, for example) the decorations do not change, so the composition is not disturbed.

## Options

`liveMarkdown({ ltem, live, language, settings })`: `ltem` are the options of `codemirror-ltem`'s `ltem()` (messages, lint delay, paste options); `language` are the options of the Markdown language (below); `settings` switch features ([Settings](#settings)); `live` are these:

| Option | Default | Effect |
|---|---|---|
| `openLink(url, event)` | none | Opens a link on Ctrl-click. Without it, links are not opened |
| `resolveImage(src)` | none | Turns an image address as written into one to show it from, or null. Remote addresses (`http:`, `https:`, `ftp:`, `//host`, `\\host`) are never loaded, before or after it; `data:image/` addresses are shown as they are |
| `tables` | `{}` | Options of `codemirror-ltem`'s table widgets (`renderInline`, `openLink`) |
| `renderMath(tex, display, element)` | none | Draws math (`$...$`, `$$...$$`) into `element` |
| `renderMermaid(code, element)` | none | Draws Mermaid code blocks; may return a promise |
| `renderFrontMatter(yaml, element)` | none | Draws front matter; without it, front matter is shown as muted source |

Without `liveMarkdown`, use `livePreview(live)` together with `ltem()` from `codemirror-ltem` and `liveMarkdownLanguage()`.

### The Markdown language

`liveMarkdownLanguage(config)` is CodeMirror's Markdown with LTEM tables, read as markdown-it reads it (`markdownItSyntax`), and quick in a large document. CodeMirror's `markdown()` parses code blocks and HTML with their languages inside the Markdown parse, over the whole document at every change; here the Markdown parse is not nested, and the visible code blocks and HTML are highlighted by their language on their own (the same highlighting). It takes the options of `markdown()` except `base` (`codeLanguages`, `defaultCodeLanguage`, `extensions`...) and:

| Option | Default | Effect |
|---|---|---|
| `nestedLanguages` | `false` | `true` parses code blocks and HTML inside the Markdown parse, as `markdown()` does |
| `html` | `false` | `true` reads HTML blocks and tags as markdown-it with `html: true`; otherwise HTML is text (autolinks such as `<https://example.com>` still read), and a line such as `<div>` goes on with a paragraph |

Extensions apply in order, after markdown-it's reading, and a `remove` in one also removes the parsers that earlier ones add: `extensions: [Superscript]` brings superscript back. The syntax of the settings `math`, `frontMatter`, `footnotes` and `highlight` is `mathSyntax` (Pandoc's `tex_math_dollars`, the rule the LTEM specification recommends), `frontMatterSyntax` (a YAML block at the very start, from a `---` line to a closing `---` or `...` line; without a closing line there is none, and the opening line is exactly `---`, which is stricter than markdown-it-front-matter), `footnoteSyntax` (as markdown-it-footnote: definitions `[^label]: text` with indented continuation lines, references `[^label]`, inline footnotes `^[text]`) and `highlightSyntax` (as markdown-it-mark).

## Settings

Every feature is on by default, but `html` (markdown-it reads HTML as text by default). An application shows them in its settings page from `liveSettingsInfo` and switches them in a running editor with `applyLiveSettings`:

```ts
import { applyLiveSettings, currentLiveSettings, liveMarkdown, liveSettingsInfo } from "codemirror-ltem-live";

const view = new EditorView({ extensions: [liveMarkdown({ live, settings: saved })], parent });

for (const info of liveSettingsInfo) {
  // info.key, info.group ("view" | "syntax" | "tables"), info.default,
  // info.label.ko / .en, info.description.ko / .en,
  // info.preview: what the preview needs when it is on (a markdown-it plugin or option),
  // info.reparse: changing it parses the document again
  const on = currentLiveSettings(view.state)![info.key];
  addCheckbox(info.label.ko, info.description.ko, on, (value) => applyLiveSettings(view, { [info.key]: value }));
}
```

| Setting | Default | What it switches | The preview needs |
|---|---|---|---|
| `livePreview` | on | Live Preview; off shows the source | |
| `bareLinks` | on | Bare URLs and e-mail addresses styled as links | `linkify: true` |
| `highlight` | on | Highlights, `==text==` | markdown-it-mark |
| `math` | on | TeX math, `$...$`, `$$...$$` | a math plugin with Pandoc's dollar rule |
| `footnotes` | on | Footnotes | markdown-it-footnote |
| `frontMatter` | on | Front matter | a front matter plugin with the same rule |
| `html` | off | HTML blocks and tags read as HTML | `html: true` |
| `tables` | on | LTEM tables shown as tables | |
| `editTablesInPlace` | on | Cells edited where the table is shown | |
| `sourceButton` | on | A handle left of a shown table to its source, and back to the table on its source | |
| `tableMenu` | on | The table menu on a right click | |
| `cellRanges` | on | Ranges of cells, as in a spreadsheet | |
| `autoAlign` | on | Columns lined up by Tab and Enter | |
| `tableKeys` | on | The key bindings for tables | |
| `lint` | on | Problems with tables marked, with fixes | |
| `pasteTables` | on | Tables pasted from HTML and tab-separated text | |
| `copyTables` | on | Tables copied as HTML too | |
| `monospaceTables` | on | Table rows in a monospace font | |

`setLiveMessages(view, "ko")` changes the language of the table menu, table checks and table handles (or give each its own: `{ menu, lint, tables }`). An editor set up again with `liveMarkdown` (in a compartment of yours) takes the new options.

Settings of syntax (`highlight`, `math`, `footnotes`, `frontMatter`, `html`) parse the document again when they change; switch the preview's plugin or option with them, so that both read the document the same way. `currentLiveSettings(state)` gives the settings in force. The older options that set the same things (`live.enabled`, `live.bareUrls`, `live.tables: false`, `ltem.lint: false`, `syntax: { math }`...) still work; `settings` come after them.

## Switching views

| Export | Purpose |
|---|---|
| `setLivePreview(view, on)` | Live Preview on, or the source |
| `toggleLivePreview(view)` | Switch; a command for a key binding |
| `livePreviewEnabled(state)` | Whether Live Preview is on |

A side-by-side view is the source next to your own rendered preview.

### Split view

The source and Live Preview of one document can be two editors side by side, as in CodeMirror's [split view example](https://codemirror.net/examples/split/): each editor sends the changes of its transactions to the other with an annotation, and one editor keeps the history (the other's undo and redo run there). Nothing more is needed: tables shown as tables, ranges of cells, the table menu, lint and Korean IME composition work with changes that come from the other editor, and an edit in a cell or a range of cells stays while the other editor changes the document elsewhere (`npm run test:browser`, `split.test.ts`). A change of cell texts made in the other editor updates the shown table in place, and an edit in progress in it stays; a change of the table's shape (rows, columns, merged cells) draws it again, dropping an edit in progress. Positions map from one editor to the other by line, as the documents are the same.

```ts
const synced = Annotation.define<boolean>();
function mirror(tr: Transaction, to: EditorView): void {
  if (tr.changes.empty || tr.annotation(synced)) return;
  const annotations = [synced.of(true)];
  const userEvent = tr.annotation(Transaction.userEvent);
  if (userEvent) annotations.push(Transaction.userEvent.of(userEvent));
  to.dispatch({ changes: tr.changes, annotations });
}
// Each editor: dispatchTransactions: (trs, view) => { view.update(trs); for (const tr of trs) mirror(tr, other) }
```

## Theming

The styles use CSS variables that your theme can set on the editor or any element around it: `--cm-live-heading-font`, `--cm-live-heading-color`, `--cm-live-heading-weight`, `--cm-live-h1-size` to `--cm-live-h6-size`, `--cm-live-link-color`, `--cm-live-code-font`, `--cm-live-code-bg`, `--cm-live-codeblock-bg`, `--cm-live-quote-border`, `--cm-live-quote-color`, `--cm-live-hr-color`, `--cm-live-bullet-color`, `--cm-live-muted-color`, `--cm-live-error-color`, `--cm-live-footnote-size`, `--cm-live-hardbreak-bg`, `--cm-live-highlight-bg`. Elements carry `cm-live-*` classes (`cm-live-h1`, `cm-live-link`, `cm-live-quote`, `cm-live-codeblock` and so on) for anything else.

The styles are a CodeMirror theme, a constructed style sheet: they work in a Shadow DOM and under a content security policy that allows no inline styles (`style-src 'self'`). The component writes no `style` attributes into markup.

## Speed

Main-thread work per keystroke in headless Chromium (median): 6.2 ms in a 1 MB document with Live Preview against 6.5 ms in the source, 6.4 ms against 6.5 ms in a 1 MB document with 2,000 footnotes, and 4.6 ms in a cell of a 1,000-row table against 4.8 ms. In a 1 MB document of long paragraphs with code blocks and tables, 4.7 ms against 3.7 ms. Only the visible part of the document is decorated; footnote numbers come from an index updated only where the document changed, and bare links found in a block are kept by its text.

## Tests

```
npm test             # decorations, links, images, footnotes, math, front matter and highlight syntax, the language, the settings, random documents against markdown-it (and markdown-it-footnote, markdown-it-mark); LTEM_PARITY_DOCS=20000 for more
npm run test:browser # what is shown, Korean IME composition on styled lines, check boxes, links, images, views, tables, drawn blocks, split view, settings switched at run time, code highlighting
LTEM_SHADOW=1 npm run test:browser  # the same in a Shadow DOM under style-src 'self'
npm run bench        # work per keystroke with Live Preview on and off
```
