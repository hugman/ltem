import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { h } from 'vue'
// Fonts (SIL OFL 1.1), served from this site: Google Sans for titles, Noto Sans for text.
import '@fontsource/google-sans/400.css'
import '@fontsource/google-sans/500.css'
import '@fontsource/google-sans/700.css'
import '@fontsource/noto-sans/400.css'
import '@fontsource/noto-sans/600.css'
import '@fontsource/noto-sans/700.css'
import './style.css'
import HomeHero from './components/HomeHero.vue'
import TryLtem from './components/TryLtem.vue'
import SyntaxGallery from './components/SyntaxGallery.vue'
import StatRow from './components/StatRow.vue'
import EcosystemGrid from './components/EcosystemGrid.vue'
import BibTex from './components/BibTex.vue'
import Pkg from './components/Pkg.vue'
import SpecDownload from './components/SpecDownload.vue'
import Playground from './components/Playground.vue'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(SpecDownload),
    })
  },
  enhanceApp({ app }) {
    app.component('HomeHero', HomeHero)
    app.component('TryLtem', TryLtem)
    app.component('SyntaxGallery', SyntaxGallery)
    app.component('StatRow', StatRow)
    app.component('EcosystemGrid', EcosystemGrid)
    app.component('BibTex', BibTex)
    app.component('Pkg', Pkg)
    app.component('Playground', Playground)
  },
} satisfies Theme
