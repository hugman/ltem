<script setup lang="ts">
// Source: the paper, Tables 2 and 3 (STB, average over 5 models and 3 runs).
const stats = [
  { label: 'Accuracy on par with HTML', value: '0.813', detail: 'nEM, HTML 0.812' },
  { label: 'Fewer table tokens than HTML', value: '42%', detail: '228 vs. 392 tokens per table' },
  { label: 'Lowest error rate of six formats', value: '0.29%', detail: 'refusals + invalid answers; LaTeX 3.04%' },
]
</script>

<template>
  <div class="lt-stats">
    <div v-for="s in stats" :key="s.label" class="lt-stat">
      <div class="lt-stat-label">{{ s.label }}</div>
      <div class="lt-stat-value">{{ s.value }}</div>
      <div class="lt-stat-detail">{{ s.detail }}</div>
    </div>
  </div>
</template>
