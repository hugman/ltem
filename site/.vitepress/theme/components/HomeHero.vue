<script setup lang="ts">
import { withBase } from 'vitepress'

// Names as in the paper's byline (the official spelling); affiliations from the lab site.
const authors = [
  { name: 'Eunbin Kim', aff: '1' },
  { name: 'Hyeonseok Kang', aff: '1' },
  { name: 'Sangkeun Jung', aff: '1,2', corresponding: true },
]
</script>

<template>
  <header class="lt-hero">
    <h1 class="lt-hero-title">
      <img class="lt-lockup lt-only-light" :src="withBase('/logo/ltem-lockup-fullname.svg')" alt="" />
      <img class="lt-lockup lt-only-dark" :src="withBase('/logo/ltem-lockup-fullname-dark.svg')" alt="" />
      <span class="lt-visually-hidden">LTEM: LLM-friendly Table-Enhanced Markdown</span>
    </h1>
    <p class="lt-tagline">Merged cells and multi-row headers, in plain Markdown tables.</p>

    <div class="lt-paper">
      <p class="lt-paper-title">LTEM: LLM-Friendly Table-Enhanced Markdown for Table Understanding and Generation</p>
      <p class="lt-venue">
        <!-- The official EMNLP 2026 logo (2026.emnlp.org), scaled down, colours unchanged. -->
        <img :src="withBase('/img/venue/emnlp-2026-budapest.png')" alt="EMNLP 2026, Budapest" width="1200" height="209" />
      </p>
      <p class="lt-venue-tag">Main Conference · Oral</p>
      <p class="lt-authors">
        <template v-for="(a, i) in authors" :key="a.name">
          <span class="lt-author">{{ a.name }}<sup>{{ a.aff }}{{ a.corresponding ? ',*' : '' }}</sup></span><span v-if="i < authors.length - 1">, </span>
        </template>
      </p>
      <p class="lt-affil">
        <span><sup>1</sup>Department of Computer Science and Engineering, Chungnam National University</span>
        <span><sup>2</sup>EurekaAI</span>
      </p>
      <p class="lt-note"><sup>*</sup>Corresponding author</p>
    </div>

    <nav class="lt-buttons">
      <!-- arXiv for now; after the proceedings, the ACL Anthology page. -->
      <a class="lt-pill" href="https://arxiv.org/abs/2610.29188">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15H6zM14 3v5h5" /></svg>Paper
      </a>
      <a class="lt-pill" href="https://github.com/hugman/ltem">
        <svg class="fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.2-3.4-1.2-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2z" /></svg>Code
      </a>
      <a class="lt-pill" href="https://huggingface.co/datasets/eunbinkim777/ltem-stb">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>Dataset
      </a>
      <a class="lt-pill" :href="withBase('/playground')">
        <svg class="fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>Playground
      </a>
      <a class="lt-pill" :href="withBase('/spec/ltem-spec')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 9h16M9 9v11" /></svg>Spec
      </a>
      <a class="lt-pill lt-pill-accent" :href="withBase('/docs/guide')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>Get started
      </a>
    </nav>
  </header>
</template>
