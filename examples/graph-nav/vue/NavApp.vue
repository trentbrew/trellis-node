<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { TrellisDb } from 'trellis/client/sdk';
import { useEntities, useMutation } from 'trellis/vue/typed';
import { API_URL, bootstrapGraphNav, byOrder } from '../bootstrap';
import { FRAMEWORK, FRAMEWORK_LINKS } from '../nav-links';
import { NavSection, type NavSectionLoaded } from '../schema';
import SectionBlock from './SectionBlock.vue';

const client = new TrellisDb({ url: API_URL });
const ready = ref(false);

onMounted(() => {
  bootstrapGraphNav(client).finally(() => {
    ready.value = true;
  });
});
onUnmounted(() => client.disconnect());

const sections = useEntities(client, NavSection, { resolve: { items: true } });
const sectionMut = useMutation(client, NavSection);

function addSection() {
  const label = prompt('New section label')?.trim();
  if (!label) return;
  sectionMut.create({
    label,
    order: sections.value.data.length,
    collapsed: false,
  });
}
</script>

<template>
  <p v-if="!ready" class="hint">Booting graph…</p>
  <div v-else class="layout">
    <aside class="sidebar">
      <div class="brand">
        <span class="dot" />
        {{ FRAMEWORK }} · <em>graph-nav</em>
      </div>
      <nav class="fw-switcher" aria-label="Framework">
        <a
          v-for="link in FRAMEWORK_LINKS"
          :key="link.label"
          :href="link.href"
          :class="{ active: link.label === FRAMEWORK }"
        >
          {{ link.label }}
        </a>
      </nav>

      <p v-if="sections.loading && sections.data.length === 0" class="hint">
        Loading…
      </p>
      <SectionBlock
        v-for="section in ([...sections.data] as NavSectionLoaded[]).sort(byOrder)"
        :key="section.id"
        :client="client"
        :section="section"
      />

      <button class="add-section" @click="addSection">+ Section</button>
      <p class="footnote">
        One subscription loads sections + items (<code>resolve</code>) — no
        per-section queries.
      </p>
    </aside>

    <main class="canvas">
      <h1>Graph-resident navigation</h1>
      <p>
        Typed entities via <code>defineType</code>, live reads with
        <code>resolve: { items: true }</code> from
        <code>trellis/vue/typed</code>.
      </p>
    </main>
  </div>
</template>
