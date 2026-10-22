<script setup lang="ts">
import { computed, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import ltem from 'markdown-it-ltem'

// html: false, so text typed here never becomes live HTML.
const mdLtem = new MarkdownIt({ html: false }).use(ltem)
const mdGfm = new MarkdownIt({ html: false })

const presets = {
  grouped: {
    label: 'Grouped header',
    text: `| Region | Revenue | <<  | Growth |
| ^^     | Q1      | Q2  | ^^     |
|--------|--------:|----:|-------:|
| Asia   | 100     | 120 | +20%   |
| Europe | 90      | 110 | +22%   |`,
  },
  section: {
    label: 'Section rows',
    text: `| Model           | Accuracy | Tokens |
|-----------------|---------:|-------:|
| **Open models** | <<       | <<     |
| Llama           | 0.79     | 450    |
| Qwen            | 0.81     | 446    |
| **API models**  | <<       | <<     |
| GPT             | 0.84     | 449    |`,
  },
  block: {
    label: 'Block span',
    text: `| Room   | Mon                | Tue | Wed    |
|--------|--------------------|-----|--------|
| Room A | Workshop {c:2,r:2} |     | Review |
| Room B | ^^                 | ^^  | Demo   |`,
  },
} as const

type PresetKey = keyof typeof presets
const presetKeys = Object.keys(presets) as PresetKey[]

const preset = ref<PresetKey>('grouped')
const source = ref<string>(presets.grouped.text)
const mode = ref<'ltem' | 'gfm'>('ltem')

function choose(k: PresetKey) {
  preset.value = k
  source.value = presets[k].text
}

const html = computed(() => (mode.value === 'ltem' ? mdLtem : mdGfm).render(source.value))
</script>

<template>
  <section class="lt-try">
    <div class="lt-try-bar">
      <div class="lt-chips" role="group">
        <button
          v-for="k in presetKeys"
          :key="k"
          class="lt-chip"
          :class="{ on: preset === k }"
          @click="choose(k)"
        >{{ presets[k].label }}</button>
      </div>
      <button class="lt-chip" @click="choose(preset)">Reset</button>
    </div>
    <div class="lt-try-panes">
      <div class="lt-pane">
        <div class="lt-pane-head">LTEM source</div>
        <textarea
          v-model="source"
          class="lt-source"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          aria-label="LTEM source"
        />
      </div>
      <div class="lt-pane">
        <div class="lt-pane-head">
          Rendered
          <span class="lt-switch" role="group">
            <button :class="{ on: mode === 'ltem' }" @click="mode = 'ltem'">With LTEM</button>
            <button :class="{ on: mode === 'gfm' }" @click="mode = 'gfm'">Plain GFM today</button>
          </span>
        </div>
        <div class="lt-rendered vp-doc" v-html="html" />
      </div>
    </div>
    <p class="lt-try-hint">
      Edit the table. <code>&lt;&lt;</code> merges a cell into the one on its left, <code>^^</code> into the one above.
      Every row above <code>|---|</code> is a header row.
      <span class="lt-legend"><i class="th"></i>header cell <i class="thm"></i>merged header cell <i class="tdm"></i>merged cell</span>
    </p>
  </section>
</template>
