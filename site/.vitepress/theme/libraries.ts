// The LTEM libraries the site shows (home cards, Libraries page), from the workspace READMEs
// in ltem-lib/. All are at version 0.1 for LTEM 1.0 (the CodeMirror packages
// have their own versions).
// status: 'available' = released for LTEM 1.0; 'planned' = being built.
export type Status = 'available' | 'planned'

// Where an install command fetches from, and whether it works yet.
// Release plan (user 2026-10-22, root decision F6): on the release day only
// PyPI ltem-core, npm ltem-core and npm markdown-it-ltem are published ('first'); the
// other registry packages are 'soon'. Go and Lua come straight from the public
// repository ('repo'). Flip the two switches below on the release day, in this
// order: repoPublic when hugman/ltem is public, firstPackages once the three
// packages are really on npm and PyPI.
export type Channel = 'npm' | 'pypi' | 'crates' | 'repo'
export const release = {
  repoPublic: true,
  // npm ltem-core, npm markdown-it-ltem and PyPI ltem-core are published (2026-10-22)
  firstPackages: true,
}
const registry: Record<Exclude<Channel, 'repo'>, string> = { npm: 'npm', pypi: 'PyPI', crates: 'crates.io' }

/** True for packages that are not released yet: shown with a "Coming soon" badge. */
export const comingSoon = (e: Entry) => e.wave === 'soon'

/** Whether an entry's install command works now, and what to say if not. */
export function installState(e: Entry): { ready: boolean; note: string } {
  if (e.wave === 'soon') return { ready: false, note: 'Coming soon' }
  if (!e.install || !e.channel) return { ready: true, note: '' }
  if (e.channel === 'repo') return release.repoPublic ? { ready: true, note: '' } : { ready: false, note: 'from the release day' }
  if (e.wave === 'first') return release.firstPackages ? { ready: true, note: '' } : { ready: false, note: `after publishing to ${registry[e.channel]}` }
  return { ready: false, note: 'Coming soon' }
}

export interface Entry {
  name: string
  what: string
  install?: string
  channel?: Channel
  /** Registry packages: 'first' = published; 'soon' = listed with a "Coming soon" badge.
   *  Go, Lua, Pandoc and Quarto come from the repository and have no wave. */
  wave?: 'first' | 'soon'
  /** Path of its README folder in the repository */
  docs?: string
  status: Status
}

const repo = 'https://github.com/hugman/ltem/tree/main/'
export const docsUrl = (path: string) => repo + path

/** Anchor of a package on the Libraries page, such as "js-marked-ltem". */
export const anchor = (group: string, name: string) =>
  `${group}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`

export interface Group {
  id: string
  title: string
  entries: Entry[]
}

export const groups: Group[] = [
  {
    id: 'js',
    title: 'JavaScript / TypeScript',
    entries: [
      {
        name: 'ltem-core',
        docs: 'ltem-lib/typescript/packages/ltem',
        what: 'Core and ltem command: parse, validate, render, write canonical LTEM, convert HTML tables',
        install: 'npm install ltem-core',
        channel: 'npm',
        wave: 'first',
        status: 'available',
      },
      {
        name: 'markdown-it-ltem',
        docs: 'ltem-lib/typescript/packages/markdown-it-ltem',
        what: 'markdown-it 14 and 15. This site runs on it.',
        install: 'npm install markdown-it markdown-it-ltem',
        channel: 'npm',
        wave: 'first',
        status: 'available',
      },
      {
        name: 'marked-ltem',
        docs: 'ltem-lib/typescript/packages/marked-ltem',
        what: 'marked 17 and 18',
        install: 'npm install marked marked-ltem',
        channel: 'npm',
        wave: 'soon',
        status: 'available',
      },
      {
        name: 'remark-ltem',
        docs: 'ltem-lib/typescript/packages/remark-ltem',
        what: 'remark plugin, also next to remark-gfm; with micromark-extension-ltem and mdast-util-ltem. For HTML, pass ltemHandlers to remark-rehype',
        install: 'npm install remark-ltem',
        channel: 'npm',
        wave: 'soon',
        status: 'available',
      },
      {
        name: 'codemirror-ltem',
        docs: 'ltem-lib/typescript/packages/codemirror-ltem',
        what: 'CodeMirror 6: table widget, merge and split, paste from Excel and the web; codemirror-ltem-live adds live preview',
        install: 'npm install codemirror-ltem',
        channel: 'npm',
        wave: 'soon',
        status: 'available',
      },
    ],
  },
  {
    id: 'py',
    title: 'Python',
    entries: [
      {
        name: 'ltem-core',
        docs: 'ltem-lib/python/ltem',
        what: 'Core and ltem command, the reference implementation; imported as ltem',
        install: 'pip install ltem-core',
        channel: 'pypi',
        wave: 'first',
        status: 'available',
      },
      {
        name: 'mdit-py-ltem',
        docs: 'ltem-lib/python/mdit-py-ltem',
        what: 'markdown-it-py plugin',
        install: 'pip install mdit-py-ltem',
        channel: 'pypi',
        wave: 'soon',
        status: 'available',
      },
      {
        name: 'markdown-ltem',
        docs: 'ltem-lib/python/markdown-ltem',
        what: 'Python-Markdown extension, for MkDocs too',
        install: 'pip install markdown-ltem',
        channel: 'pypi',
        wave: 'soon',
        status: 'available',
      },
    ],
  },
  {
    id: 'rs',
    title: 'Rust',
    entries: [
      {
        name: 'ltem',
        docs: 'ltem-lib/rust/crates/ltem',
        what: 'Core crate',
        install: 'cargo add ltem',
        channel: 'crates',
        wave: 'soon',
        status: 'available',
      },
      {
        name: 'ltem-cli',
        docs: 'ltem-lib/rust/crates/ltem-cli',
        what: 'The ltem command: check, render, format, convert HTML',
        install: 'cargo install ltem-cli',
        channel: 'crates',
        wave: 'soon',
        status: 'available',
      },
      {
        name: 'pulldown-cmark-ltem',
        docs: 'ltem-lib/rust/crates/pulldown-cmark-ltem',
        what: 'pulldown-cmark adapter',
        install: 'cargo add pulldown-cmark-ltem',
        channel: 'crates',
        wave: 'soon',
        status: 'available',
      },
      {
        name: 'mdbook-ltem',
        docs: 'ltem-lib/rust/crates/mdbook-ltem',
        what: 'mdBook preprocessor (mdBook 0.4 and 0.5)',
        install: 'cargo install mdbook-ltem',
        channel: 'crates',
        wave: 'soon',
        status: 'available',
      },
      {
        name: 'comrak-ltem',
        docs: 'ltem-lib/rust/crates/comrak-ltem',
        what: 'comrak adapter, for the engine behind GitLab and crates.io',
        install: 'cargo add comrak-ltem',
        channel: 'crates',
        wave: 'soon',
        status: 'available',
      },
    ],
  },
  {
    id: 'go',
    title: 'Go',
    entries: [
      {
        name: 'ltem',
        docs: 'ltem-lib/go',
        what: 'Core package (standard library only) and the ltem command',
        install: 'go get github.com/hugman/ltem/ltem-lib/go@latest',
        channel: 'repo',
        status: 'available',
      },
      {
        name: 'goldmarkltem',
        docs: 'ltem-lib/go/goldmarkltem',
        what: 'goldmark extension, for goldmark v1 and v2',
        install: 'import "github.com/hugman/ltem/ltem-lib/go/goldmarkltem"',
        channel: 'repo',
        status: 'available',
      },
    ],
  },
  {
    id: 'lua',
    title: 'Lua · Pandoc · Quarto',
    entries: [
      {
        name: 'ltem.lua',
        docs: 'ltem-lib/lua',
        what: 'Core in pure Lua 5.4, no C code',
        status: 'available',
      },
      {
        name: 'Pandoc readers and filter',
        docs: 'ltem-lib/lua',
        what: 'Readers for Pandoc Markdown and commonmark_x with LTEM tables, and a filter for ```ltem blocks',
        install: 'pandoc -f ltem-markdown.lua in.md -o out.docx',
        channel: 'repo',
        status: 'available',
      },
      {
        name: 'Quarto extension',
        docs: 'ltem-lib/lua',
        what: 'The filter for Quarto: it turns ```ltem blocks into tables',
        status: 'available',
      },
    ],
  },
  {
    id: 'own',
    title: 'Build your own',
    entries: [
      {
        name: 'Specification 1.0',
        docs: 'spec',
        what: 'Grammar, merge rules, escapes, canonical form, validation',
        status: 'available',
      },
      {
        name: 'Table model',
        docs: 'ast',
        what: 'Language-neutral JSON Schema that parsers produce',
        status: 'available',
      },
      {
        name: 'Conformance tests',
        docs: 'conformance',
        what: 'Pass them and you may call your implementation LTEM',
        status: 'available',
      },
    ],
  },
]
