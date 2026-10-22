# site

The source of the LTEM website, https://hugman.github.io/ltem/. It is built with [VitePress](https://vitepress.dev/) and renders LTEM tables with [`markdown-it-ltem`](../ltem-lib/typescript/packages/markdown-it-ltem/).

```
npm install
npm run dev      # http://localhost:5173/ltem/
npm run build    # writes .vitepress/dist/
```

Before each run, `scripts/sync-docs.mjs` copies the documents in [`../docs/`](../docs/), [`../spec/`](../spec/) and [`../research/`](../research/) into the site, and the official logo files from [`../assets/logo/`](../assets/logo/) into `public/logo/`. The copies are not committed: edit the originals.

## License

The site's code (`.vitepress/`, `scripts/`, the pages) is under the MIT License of this repository ([`../LICENSE`](../LICENSE)). The documents it shows keep their own licenses.

These files show the LTEM logo and are **not** under the MIT License; their use is governed by [`../TRADEMARK.md`](../TRADEMARK.md):

- `public/brand/`: icons and the image shown when a link to the site is shared
- `public/img/syntax/`: the animated pictures of the LTEM syntax
- `public/logo/`, at build time: copies of [`../assets/logo/`](../assets/logo/)
