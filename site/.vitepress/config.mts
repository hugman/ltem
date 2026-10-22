import { defineConfig } from 'vitepress'
import ltem from 'markdown-it-ltem'
import { slug } from 'github-slugger'
import { ltemBlocks } from './ltem-blocks'

const base = '/ltem/'
const siteUrl = 'https://hugman.github.io/ltem/'
const repo = 'https://github.com/hugman/ltem'

export default defineConfig({
  base,
  lang: 'en',
  cleanUrls: true,
  title: 'LTEM',
  titleTemplate: ':title · LTEM',
  description:
    'LLM-friendly Table-Enhanced Markdown: merged cells and multi-row headers in plain Markdown tables.',
  head: [
    ['link', { rel: 'icon', href: `${base}brand/favicon.ico`, sizes: '48x48' }],
    ['link', { rel: 'icon', href: `${base}brand/favicon.svg`, type: 'image/svg+xml' }],
    ['link', { rel: 'apple-touch-icon', href: `${base}brand/apple-touch-icon.png` }],
    ['meta', { name: 'theme-color', content: '#6D28D9' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'LTEM' }],
    ['meta', { property: 'og:image', content: `${siteUrl}brand/ltem-social-1280x640.png` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  sitemap: { hostname: siteUrl },
  srcExclude: ['README.md', 'public/**'],
  vite: {
    // The site lives on a network drive: keep the watcher off build output.
    server: { watch: { ignored: ['**/.vitepress/.temp/**', '**/.vitepress/dist/**', '**/.vitepress/cache/**'] } },
    // The editor packages are linked from ltem-lib/typescript, which has its own
    // CodeMirror copies; CodeMirror breaks with two copies, so use the site's.
    resolve: {
      dedupe: [
        '@codemirror/state', '@codemirror/view', '@codemirror/language', '@codemirror/lint',
        '@codemirror/lang-markdown', '@codemirror/lang-html', '@lezer/common', '@lezer/highlight',
        '@lezer/markdown', 'codemirror', 'markdown-it',
      ],
    },
  },
  markdown: {
    // Heading ids as on GitHub, so the documents' links work on both.
    anchor: { slugify: (s: string) => slug(s) },
    config(md) {
      md.use(ltem)
      md.use(ltemBlocks)
    },
  },
  themeConfig: {
    logo: { light: '/logo/ltem-symbol.svg', dark: '/logo/ltem-symbol-dark.svg', alt: 'LTEM' },
    siteTitle: 'LTEM',
    nav: [
      { text: 'Guide', link: '/docs/guide', activeMatch: '^/docs/' },
      { text: 'Spec', link: '/spec/ltem-spec', activeMatch: '^/spec/' },
      { text: 'Libraries', link: '/libraries' },
      { text: 'Research', link: '/research/', activeMatch: '^/research/' },
      { text: 'Playground', link: '/playground' },
    ],
    sidebar: {
      '/docs/': [
        {
          text: 'Documentation',
          items: [
            { text: 'Overview', link: '/docs/' },
            { text: 'Writing LTEM tables', link: '/docs/guide' },
            { text: 'Other merged-cell syntaxes', link: '/docs/comparison' },
          ],
        },
      ],
      '/spec/': [
        {
          text: 'Specification',
          items: [
            { text: 'Overview', link: '/spec/' },
            { text: 'LTEM 1.0', link: '/spec/ltem-spec' },
            { text: 'Changes', link: '/spec/changelog' },
          ],
        },
      ],
      '/research/': [
        {
          text: 'Research',
          items: [
            { text: 'Artifacts', link: '/research/' },
            { text: 'Taxonomy of table complexity', link: '/research/taxonomy' },
          ],
        },
      ],
    },
    outline: [2, 3],
    socialLinks: [{ icon: 'github', link: repo }],
    search: { provider: 'local' },
    footer: {
      message:
        `Code: <a href="${repo}/blob/main/LICENSE">MIT</a> · ` +
        `Specification: <a href="${repo}/blob/main/spec/LICENSE">CC BY-ND 4.0</a> · ` +
        `Documentation: <a href="${repo}/blob/main/docs/LICENSE">CC BY 4.0</a> · ` +
        `<a href="${repo}/blob/main/PATENTS">Patent license</a> · ` +
        `<a href="${repo}/blob/main/TRADEMARK.md">Trademarks</a> · ` +
        `<a href="${repo}/tree/main/assets/logo">Logo files</a>`,
      copyright:
        'Copyright © 2026 EurekaAI Co., Ltd. “LTEM” and the LTEM logo are trademarks of EurekaAI Co., Ltd.',
    },

  },
})
