<script setup lang="ts">
import { ref } from 'vue'

const done = ref(false)

// In the ACL Anthology's BibTeX style, with what is known before the proceedings
// are out. TODO (about a month after the conference): replace with the
// Anthology entry, which adds editor, url, doi and pages.
const bib = `@inproceedings{kim-etal-2026-ltem,
    title = "{LTEM}: {LLM}-Friendly Table-Enhanced Markdown for Table Understanding and Generation",
    author = "Kim, Eunbin  and
      Kang, Hyeonseok  and
      Jung, Sangkeun",
    booktitle = "Proceedings of the 2026 Conference on Empirical Methods in Natural Language Processing",
    month = oct,
    year = "2026",
    address = "Budapest, Hungary",
    publisher = "Association for Computational Linguistics"
}`

async function copy() {
  try {
    await navigator.clipboard.writeText(bib)
    done.value = true
    setTimeout(() => (done.value = false), 1500)
  } catch {
    /* clipboard blocked: the text stays selectable */
  }
}
</script>

<template>
  <div class="lt-bib">
    <button class="lt-chip lt-bib-copy" @click="copy">{{ done ? 'Copied' : 'Copy' }}</button>
    <pre><code>{{ bib }}</code></pre>
  </div>
</template>
