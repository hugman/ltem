<script setup lang="ts">
import { withBase } from 'vitepress'
import { anchor, comingSoon, groups, installState } from '../libraries'

</script>

<template>
  <div class="lt-eco">
    <section v-for="g in groups" :key="g.id" class="lt-eco-group">
      <div class="lt-eco-title">{{ g.title }}</div>
      <ul>
        <li v-for="e in g.entries" :key="e.name" :class="['lt-eco-item', e.status]">
          <div class="lt-eco-head">
            <a v-if="g.id !== 'own'" class="lt-eco-name" :href="withBase(`/libraries#${anchor(g.id, e.name)}`)"><code>{{ e.name }}</code></a>
            <code v-else class="lt-eco-name">{{ e.name }}</code>
            <span v-if="comingSoon(e)" class="lt-badge soon">Coming soon</span>
          </div>
          <div class="lt-eco-what">{{ e.what }}</div>
          <div v-if="e.install" class="lt-eco-cmd" :class="{ pending: !installState(e).ready }">
            <code class="lt-eco-install">{{ e.install }}</code>
            <span v-if="!installState(e).ready && !comingSoon(e)" class="lt-eco-when">{{ installState(e).note }}</span>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
