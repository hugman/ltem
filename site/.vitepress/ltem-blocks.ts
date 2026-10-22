// How the site shows LTEM examples in the repository's documents.
//
// On GitHub, an LTEM example is a code block followed by a picture of the
// rendered table. On the site the table is rendered live instead:
//   ```ltem            code + the rendered table
//   ```ltem compare    code + the table with LTEM and in a plain GFM renderer
//   ```ltem norender   code only
//   ```text render     code + the table found inside the text (prompts)
//   ```` example       a specification example: LTEM input, expected HTML
// The picture right after such a block is dropped, as the table is shown live.

import MarkdownIt from 'markdown-it'
import type { default as MarkdownItType } from 'markdown-it'
import ltem from 'markdown-it-ltem'

const withLtem = new MarkdownIt({ html: false }).use(ltem)
const plainGfm = new MarkdownIt({ html: false })

const PICTURE = /^<img\s[^>]*src="[^"]*images\/[\w-]+\.png"[^>]*>\s*$/

function rendersTable(info: string): boolean {
  const [lang, mode] = info.trim().split(/\s+/)
  return (lang === 'ltem' && mode !== 'norender') || (lang === 'text' && mode === 'render')
}

function tableIn(text: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.trimStart().startsWith('|'))
  if (start < 0) return ''
  let end = start
  while (end + 1 < lines.length && lines[end + 1].trimStart().startsWith('|')) end++
  return lines.slice(start, end + 1).join('\n')
}

function panel(label: string, html: string): string {
  return `<div class="lt-ex-panel"><div class="lt-ex-label">${label}</div><div class="lt-ex-table">${html}</div></div>`
}

export function ltemBlocks(md: MarkdownItType) {
  // Drop the GitHub picture that follows a rendered example.
  md.core.ruler.after('block', 'ltem_drop_pictures', (state) => {
    const tokens = state.tokens
    for (let i = tokens.length - 1; i > 0; i--) {
      const t = tokens[i]
      const prev = tokens[i - 1]
      if (t.type === 'html_block' && PICTURE.test(t.content) && prev.type === 'fence' && rendersTable(prev.info)) {
        tokens.splice(i, 1)
      }
    }
  })

  const fence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const info = token.info.trim()
    const [lang, mode] = info.split(/\s+/)

    // Render the code with another language name, then restore the token.
    const code = (as: string, label = as) => {
      const saved = token.info
      token.info = as
      const html = fence(tokens, idx, options, env, self)
      token.info = saved
      return html.replace(`<span class="lang">${as}</span>`, `<span class="lang">${label}</span>`)
    }

    if (info === 'example') {
      env.ltemExample = (env.ltemExample ?? 0) + 1
      const n = env.ltemExample
      const [input, expected = ''] = token.content.split(/^\.\n/m)
      const saved = token.content
      token.content = input
      const inputHtml = code('md', 'LTEM')
      token.content = expected
      const htmlCode = code('html')
      token.content = saved
      return (
        `<div class="lt-spec-ex" id="example-${n}" v-pre>` +
        `<div class="lt-spec-ex-head"><a href="#example-${n}">Example ${n}</a></div>` +
        `<div class="lt-spec-ex-body"><div class="lt-spec-ex-in">${inputHtml}</div>` +
        `<div class="lt-spec-ex-out">${panel(/<table[\s>]/.test(expected) ? 'Expected output' : 'Expected output · not a table', expected)}` +
        `<details><summary>HTML</summary>${htmlCode}</details></div></div></div>`
      )
    }

    if (lang === 'ltem') {
      const src = code('md', 'LTEM')
      if (mode === 'norender') return src
      const out =
        mode === 'compare'
          ? `<div class="lt-ex-compare">${panel('With LTEM', withLtem.render(token.content))}` +
            `${panel('A GFM renderer without LTEM', plainGfm.render(token.content))}</div>`
          : panel('Renders as', withLtem.render(token.content))
      return `<div class="lt-ex" v-pre>${src}${out}</div>`
    }

    if (lang === 'text' && mode === 'render') {
      const src = code('text')
      const table = tableIn(token.content)
      return `<div class="lt-ex" v-pre>${src}${table ? panel('The table in this prompt', withLtem.render(table)) : ''}</div>`
    }

    return fence(tokens, idx, options, env, self)
  }
}
