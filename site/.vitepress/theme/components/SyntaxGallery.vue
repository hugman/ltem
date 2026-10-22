<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useData, withBase } from 'vitepress'

// GIFs come from the LTEM promotion kit; each has a dark-mode twin (-dark.gif).
const tabs = [
  { file: 'A1-colspan', code: '<<', title: 'Merge across columns' },
  { file: 'A2-rowspan', code: '^^', title: 'Merge down rows' },
  { file: 'A3-span-attribute', code: '{c:N}', title: 'Span many columns' },
  { file: 'A4-block-span', code: '{c:N,r:M}', title: 'Span a block' },
  { file: 'B1-header-rows', code: '|---|', title: 'Stack header rows' },
  { file: 'B2-grouped-header', code: '<< ^^', title: 'Group columns' },
  { file: 'C1-section-rows', code: '| … | << |', title: 'Sections' },
]

const { isDark } = useData()
// The server renders the light GIF; switch after mount so hydration matches.
const mounted = ref(false)
onMounted(() => (mounted.value = true))
const active = ref(0)
const current = computed(() => tabs[active.value])
const src = computed(() => withBase(`/img/syntax/${current.value.file}${mounted.value && isDark.value ? '-dark' : ''}.gif`))
</script>

<template>
  <div class="lt-gallery">
    <div class="lt-gallery-tabs" role="tablist">
      <button
        v-for="(tab, i) in tabs"
        :key="tab.file"
        role="tab"
        class="lt-gtab"
        :class="{ on: i === active }"
        :aria-selected="i === active"
        @click="active = i"
      >
        <code>{{ tab.code }}</code><span>{{ tab.title }}</span>
      </button>
    </div>
    <figure class="lt-gallery-view" role="tabpanel">
      <img :key="src" :src="src" :alt="current.title" width="1160" height="510" />
    </figure>
  </div>
</template>
