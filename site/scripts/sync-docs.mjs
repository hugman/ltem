// Copy the repository's documents into the site before a build.
//
// The documents live once, in the repository (docs/, spec/, research/), and are
// written for GitHub. This script copies them under site/ so VitePress can render
// them, and fixes what differs on the site:
//   - README.md becomes the folder's index.md;
//   - a link to a file that is not a site page goes to the file on GitHub.
// It also copies the official logo files into public/logo/.
// The copies are generated; they are not committed (see .gitignore).

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(site, '..')
const github = 'https://github.com/hugman/ltem/blob/main/'
const githubTree = 'https://github.com/hugman/ltem/tree/main/'

// Repository file -> site page. Only these become pages.
const pages = {
  'docs/README.md': 'docs/index.md',
  'docs/guide.md': 'docs/guide.md',
  'docs/comparison.md': 'docs/comparison.md',
  'spec/README.md': 'spec/index.md',
  'spec/ltem-spec.md': 'spec/ltem-spec.md',
  'spec/CHANGELOG.md': 'spec/changelog.md',
  'research/README.md': 'research/index.md',
  'research/taxonomy.md': 'research/taxonomy.md',
}
const assetDirs = ['docs/images']
const generated = ['docs', 'spec', 'research']

// Files are rewritten only when they change, and stale ones removed one by one:
// the dev server watches these folders, and removing a watched folder on a
// network drive stops the watcher.
const expected = new Set()
function put(path, text) {
  expected.add(path)
  mkdirSync(dirname(path), { recursive: true })
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text)
}
function listFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
  )
}

function rewriteLinks(text, from) {
  // Markdown links and <img src>. Leave absolute URLs and pure anchors alone.
  const fix = (target) => {
    if (/^([a-z]+:|#|\/)/i.test(target)) return target
    const [path, hash = ''] = target.split('#')
    const resolved = posix.normalize(posix.join(posix.dirname(from), path))
    const anchor = hash ? `#${hash}` : ''
    if (pages[resolved]) {
      const to = posix.relative(posix.dirname(pages[from]), pages[resolved])
      return (to || posix.basename(pages[resolved])) + anchor
    }
    if (assetDirs.some((d) => resolved.startsWith(d + '/'))) return target
    const full = join(repo, resolved)
    const isDir = path.endsWith('/') || (existsSync(full) && statSync(full).isDirectory())
    return (isDir ? githubTree : github) + resolved.replace(/\/$/, '') + anchor
  }
  return text
    .replace(/\]\(([^)\s]+)\)/g, (_, t) => `](${fix(t)})`)
    .replace(/(<img\s[^>]*src=")([^"]+)(")/g, (_, a, t, b) => a + fix(t) + b)
}

let count = 0
for (const [from, to] of Object.entries(pages)) {
  const src = join(repo, from)
  if (!existsSync(src)) continue
  put(join(site, to), rewriteLinks(readFileSync(src, 'utf8'), from))
  count++
}
// The official logo files, unchanged (assets/logo/, under TRADEMARK.md).
const logoOut = join(site, 'public', 'logo')
for (const dir of ['symbol', 'lockup', 'badge']) {
  for (const f of listFiles(join(repo, 'assets', 'logo', dir))) {
    const to = join(logoOut, f.slice(join(repo, 'assets', 'logo', dir).length + 1))
    expected.add(to)
    if (!existsSync(to) || !readFileSync(to).equals(readFileSync(f))) cpSync(f, to)
  }
}

for (const dir of assetDirs) {
  for (const f of listFiles(join(repo, dir))) {
    const to = join(site, f.slice(repo.length + 1))
    expected.add(to)
    mkdirSync(dirname(to), { recursive: true })
    if (!existsSync(to) || !readFileSync(to).equals(readFileSync(f))) cpSync(f, to)
  }
}

for (const dir of [...generated.map((d) => join(site, d)), logoOut]) {
  for (const f of listFiles(dir)) if (!expected.has(f)) rmSync(f)
}
// The specification as a download: the original file, unchanged (CC BY-ND 4.0).
const specSrc = join(repo, 'spec', 'ltem-spec.md')
if (existsSync(specSrc)) {
  const text = readFileSync(specSrc, 'utf8')
  const version = /\*\*Version:\*\*\s*([0-9][0-9.]*[0-9])/.exec(text)?.[1] ?? 'latest'
  const file = `ltem-spec-${version}.md`
  const outDir = join(site, 'public', 'downloads')
  for (const f of listFiles(outDir)) if (!f.endsWith(file)) rmSync(f)
  mkdirSync(outDir, { recursive: true })
  const to = join(outDir, file)
  if (!existsSync(to) || readFileSync(to, 'utf8') !== text) writeFileSync(to, text)
  const info = JSON.stringify({ spec: { file, version, bytes: Buffer.byteLength(text) } }, null, 1) + '\n'
  const infoPath = join(site, '.vitepress', 'theme', 'downloads.json')
  if (!existsSync(infoPath) || readFileSync(infoPath, 'utf8') !== info) writeFileSync(infoPath, info)
}

console.log(`sync-docs: ${count} pages from ${relative(process.cwd(), repo) || '.'}`)
