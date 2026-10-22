<script setup lang="ts">
// One package's install command (with whether it works yet) and README link,
// from the shared list in libraries.ts. Use: <Pkg g="js" n="marked-ltem" />
import { computed } from 'vue'
import { comingSoon, docsUrl, groups, installState } from '../libraries'

const props = defineProps<{ g: string; n: string }>()
const entry = computed(() => groups.find((x) => x.id === props.g)?.entries.find((e) => e.name === props.n))
</script>

<template>
  <div v-if="entry" class="lt-pkg">
    <span v-if="comingSoon(entry)" class="lt-badge soon">Coming soon</span>
    <div v-if="entry.install" class="lt-pkg-install" :class="{ pending: !installState(entry).ready }">
      <code>{{ entry.install }}</code>
      <span v-if="!installState(entry).ready && !comingSoon(entry)" class="lt-eco-when">{{ installState(entry).note }}</span>
    </div>
    <a v-if="entry.docs" class="lt-pkg-docs" :href="docsUrl(entry.docs)">README →</a>
  </div>
</template>
