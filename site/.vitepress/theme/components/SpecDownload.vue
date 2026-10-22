<script setup lang="ts">
// A download box at the top of the specification pages, with the authors
// (the owner is EurekaAI Co., Ltd.; user 2026-10-21). The file is the
// specification itself, unchanged; scripts/sync-docs.mjs copies it and writes
// downloads.json with its version and size.
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import downloads from '../downloads.json'

const { page } = useData()
const show = computed(() => page.value.relativePath.startsWith('spec/'))
const spec = downloads.spec
const href = withBase(`/downloads/${spec.file}`)
const size = `${Math.round(spec.bytes / 1024)} KB`
</script>

<template>
  <div v-if="show" class="lt-download">
    <div class="lt-download-text">
      <strong>LTEM {{ spec.version }} specification</strong>
      <span class="lt-download-by">By Sangkeun Jung and Eunbin Kim · © 2026 EurekaAI Co., Ltd.</span>
      <span>Markdown, {{ size }}. CC BY-ND 4.0: share it unchanged, with credit.</span>
    </div>
    <a class="lt-download-btn" :href="href" :download="spec.file">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
      Download {{ spec.file }}
    </a>
  </div>
</template>
