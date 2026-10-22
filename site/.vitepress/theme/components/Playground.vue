<script setup lang="ts">
// The LTEM Playground of this site: an editor that understands LTEM tables
// (codemirror-ltem, codemirror-ltem-live) with the rendered document next to it
// (markdown-it-ltem). The editor is loaded in the browser only.
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { EXAMPLES } from '../playground-examples'

type Mode = 'side' | 'live' | 'source'

const editorEl = ref<HTMLElement | null>(null)
const html = ref('')
const status = ref('')
const problems = ref({ errors: 0, warnings: 0 })
const notice = ref('')
const mode = ref<Mode>('side')
const example = ref(EXAMPLES[0].id)
const ready = ref(false)
const showSettings = ref(false)
const settings = ref<{ key: string; group: string; label: string; about: string; on: boolean }[]>([])

// Filled once the editor modules are loaded.
const api = shallowRef<any>(null)
let view: any = null
let renderTimer = 0
let noticeTimer = 0

const TOOLS = [
  { group: '', items: [{ cmd: 'format', label: 'Format' }] },
  { group: 'Row', items: [{ cmd: 'rowAbove', label: 'Above' }, { cmd: 'rowBelow', label: 'Below' }, { cmd: 'deleteRow', label: 'Delete' }] },
  { group: 'Column', items: [{ cmd: 'colLeft', label: 'Left' }, { cmd: 'colRight', label: 'Right' }, { cmd: 'deleteCol', label: 'Delete' }] },
  { group: 'Cell', items: [{ cmd: 'mergeRight', label: 'Merge right' }, { cmd: 'mergeDown', label: 'Merge down' }, { cmd: 'split', label: 'Split' }] },
]
const MODES: { id: Mode; label: string }[] = [
  { id: 'side', label: 'Side by side' },
  { id: 'live', label: 'Live preview' },
  { id: 'source', label: 'Source' },
]
const GROUPS: Record<string, string> = { syntax: 'Syntax', view: 'Showing', tables: 'Tables' }

function showNotice(text: string) {
  notice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 5000)
}

function render() {
  if (view && api.value) html.value = api.value.md.render(view.state.doc.toString())
}
function scheduleRender() {
  clearTimeout(renderTimer)
  renderTimer = window.setTimeout(render, 80)
}

function updateStatus() {
  const { tableAt, cellAt, forEachDiagnostic } = api.value
  const state = view.state
  const head = state.selection.main.head
  const table = tableAt(state, head)
  if (table) {
    const t = table.analysis.table
    const parts = [`Table ${t.rows} × ${t.cols}, ${t.header_rows} header row${t.header_rows > 1 ? 's' : ''}`]
    const cell = cellAt(table, head)
    if (cell && cell.cell.row >= 0) parts.push(`row ${cell.cell.row + 1}, column ${cell.cell.col + 1}`)
    status.value = parts.join(' · ')
  } else {
    status.value = 'Not in a table'
  }
  let errors = 0
  let warnings = 0
  forEachDiagnostic(state, (d: any) => (d.severity === 'error' ? errors++ : warnings++))
  problems.value = { errors, warnings }
}

function run(cmd: string) {
  if (!view) return
  const command = api.value.commands[cmd]
  if (!command({ state: view.state, dispatch: (tr: any) => view.dispatch(tr) })) {
    showNotice(api.value.tableAt(view.state, view.state.selection.main.head)
      ? 'That change is not possible here.'
      : 'Put the cursor in a table first.')
  }
  view.focus()
}

function loadExample(id: string) {
  example.value = id
  const ex = EXAMPLES.find((e) => e.id === id)!
  if (view) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ex.text }, selection: { anchor: 0 } })
    view.focus()
  }
}

function setMode(m: Mode) {
  mode.value = m
  if (!view) return
  api.value.setLivePreview(view, m === 'live')
  if (m === 'side') render()
  view.focus()
}
function cycleMode() {
  const order: Mode[] = ['side', 'live', 'source']
  setMode(order[(order.indexOf(mode.value) + 1) % order.length])
}

function toggleSetting(key: string, on: boolean) {
  api.value.applyLiveSettings(view, { [key]: on })
  api.value.md = api.value.previewFor(api.value.currentLiveSettings(view.state))
  render()
}

onMounted(async () => {
  const [
    { EditorView, basicSetup },
    { HighlightStyle, syntaxHighlighting },
    { forEachDiagnostic },
    { tags },
    { keymap },
    cmLtem,
    live,
    { default: markdownit },
    { default: footnote },
    { default: mark },
    { default: ltemPlugin },
  ] = await Promise.all([
    import('codemirror'),
    import('@codemirror/language'),
    import('@codemirror/lint'),
    import('@lezer/highlight'),
    import('@codemirror/view'),
    import('codemirror-ltem'),
    import('codemirror-ltem-live'),
    import('markdown-it'),
    import('markdown-it-footnote'),
    import('markdown-it-mark'),
    import('markdown-it-ltem'),
  ])

  // The preview reads the document as the editor does; math and front matter
  // have no preview plugin here, so they start off.
  const START = { math: false, frontMatter: false }
  const previewFor = (s: any) => {
    const out = markdownit({ html: !!s.html, linkify: s.bareLinks !== false }).use(ltemPlugin)
    if (s.footnotes !== false) out.use(footnote)
    if (s.highlight !== false) out.use(mark)
    return out
  }

  api.value = {
    md: previewFor(START),
    previewFor,
    tableAt: cmLtem.tableAt,
    cellAt: cmLtem.cellAt,
    forEachDiagnostic,
    setLivePreview: live.setLivePreview,
    applyLiveSettings: live.applyLiveSettings,
    currentLiveSettings: live.currentLiveSettings,
    commands: {
      format: cmLtem.formatTable,
      rowAbove: cmLtem.insertRowAbove,
      rowBelow: cmLtem.insertRowBelow,
      deleteRow: cmLtem.deleteRowAt,
      colLeft: cmLtem.insertColumnLeft,
      colRight: cmLtem.insertColumnRight,
      deleteCol: cmLtem.deleteColumnAt,
      mergeRight: cmLtem.mergeRight,
      mergeDown: cmLtem.mergeDown,
      split: cmLtem.splitCellAt,
    },
  }

  // Colours come from the site's tokens, so the editor follows light and dark.
  const markdownStyle = HighlightStyle.define([
    { tag: tags.heading, fontWeight: '700', color: 'var(--lt-th-ink)' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: [tags.link, tags.url], color: 'var(--lt-violet)' },
    { tag: tags.monospace, color: 'var(--vp-c-brand-2)' },
    { tag: [tags.processingInstruction, tags.meta, tags.quote], color: 'var(--vp-c-text-3)' },
  ])
  const siteTheme = EditorView.theme({
    '&': { height: '100%', backgroundColor: 'var(--vp-c-bg)', color: 'var(--vp-c-text-1)' },
    '.cm-scroller': { fontFamily: 'var(--vp-font-family-mono)', fontSize: '14px', lineHeight: '1.7' },
    '.cm-content': { caretColor: 'var(--vp-c-text-1)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--vp-c-text-1)' },
    '.cm-gutters': { backgroundColor: 'var(--vp-c-bg-soft)', color: 'var(--vp-c-text-3)', borderRight: '1px solid var(--lt-line)' },
    '.cm-activeLine': { backgroundColor: 'var(--lt-td-merged-bg)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--lt-th-bg)', color: 'var(--lt-th-ink)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: 'var(--lt-th-merged-bg) !important' },
    '&.cm-focused': { outline: 'none' },
  })

  view = new EditorView({
    doc: EXAMPLES[0].text,
    extensions: [
      basicSetup,
      siteTheme,
      syntaxHighlighting(markdownStyle),
      syntaxHighlighting(cmLtem.ltemHighlightStyle),
      live.liveMarkdown({
        settings: START,
        ltem: {
          paste: { onWarnings: (w: string[]) => showNotice(`Pasted table: ${w.join('; ')}`) },
          copy: { renderMarkdown: (text: string) => api.value.md.render(text) },
        },
        live: {
          enabled: false,
          tables: { renderInline: (text: string) => api.value.md.renderInline(text) },
          openLink: (url: string) => { window.open(url, '_blank', 'noopener') },
        },
      }),
      keymap.of([{ key: 'Mod-e', run: () => { cycleMode(); return true } }]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u: any) => {
        if (u.docChanged) scheduleRender()
        if (u.docChanged || u.selectionSet || u.transactions.length) updateStatus()
      }),
    ],
    parent: editorEl.value!,
  })

  const current = live.currentLiveSettings(view.state)
  settings.value = live.liveSettingsInfo
    .filter((s: any) => s.key !== 'livePreview')
    .map((s: any) => ({
      key: s.key,
      group: s.group,
      label: s.label.en,
      about: s.description.en + (s.key === 'math' || s.key === 'frontMatter' ? ' (The preview here has no plugin for it.)' : ''),
      on: !!current[s.key],
    }))

  render()
  updateStatus()
  ready.value = true
})

watch(mode, () => window.dispatchEvent(new Event('resize')))

onBeforeUnmount(() => {
  clearTimeout(renderTimer)
  clearTimeout(noticeTimer)
  view?.destroy()
})
</script>

<template>
  <div class="pg" :class="`pg-${mode}`">
    <div class="pg-bar">
      <h1 class="pg-title">Playground</h1>
      <div class="pg-examples" role="group" aria-label="Examples">
        <button
          v-for="ex in EXAMPLES"
          :key="ex.id"
          class="lt-chip"
          :class="{ on: example === ex.id }"
          @click="loadExample(ex.id)"
        >{{ ex.title }}</button>
      </div>
      <div class="pg-modes" role="group" aria-label="View">
        <button v-for="m in MODES" :key="m.id" :class="{ on: mode === m.id }" @click="setMode(m.id)">{{ m.label }}</button>
      </div>
      <button class="lt-chip" :class="{ on: showSettings }" @click="showSettings = !showSettings">Settings</button>
    </div>

    <div class="pg-tools" role="toolbar" aria-label="Table tools">
      <div v-for="t in TOOLS" :key="t.group || 'format'" class="pg-toolgroup">
        <span v-if="t.group" class="pg-toolname">{{ t.group }}</span>
        <button v-for="b in t.items" :key="b.cmd" class="pg-tool" :disabled="!ready" @click="run(b.cmd)">{{ b.label }}</button>
      </div>
    </div>

    <div class="pg-main">
      <section class="pg-pane pg-src">
        <div class="pg-pane-head">LTEM source<span class="pg-hint">Ctrl+E switches the view</span></div>
        <div ref="editorEl" class="pg-editor" />
      </section>
      <section v-show="mode === 'side'" class="pg-pane pg-out">
        <div class="pg-pane-head">Rendered</div>
        <div class="pg-preview vp-doc" v-html="html" />
      </section>
      <aside v-if="showSettings" class="pg-settings">
        <template v-for="(name, group) in GROUPS" :key="group">
          <h2>{{ name }}</h2>
          <label v-for="s in settings.filter((x) => x.group === group)" :key="s.key">
            <input v-model="s.on" type="checkbox" @change="toggleSetting(s.key, s.on)" />
            <span>{{ s.label }}</span>
            <small>{{ s.about }}</small>
          </label>
        </template>
      </aside>
    </div>

    <div class="pg-status">
      <span>{{ ready ? status : 'Loading the editor…' }}</span>
      <span v-if="problems.errors || problems.warnings" class="pg-problems">
        {{ problems.errors }} error{{ problems.errors === 1 ? '' : 's' }}, {{ problems.warnings }} warning{{ problems.warnings === 1 ? '' : 's' }}
      </span>
      <span class="lt-legend pg-legend"><i class="th"></i>header cell <i class="thm"></i>merged header cell <i class="tdm"></i>merged cell</span>
    </div>

    <div v-if="notice" class="pg-notice" role="status">{{ notice }}</div>
  </div>
</template>
