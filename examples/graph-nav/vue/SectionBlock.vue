<script setup lang="ts">
import { useMutation } from 'trellis/vue/typed';
import { byOrder } from '../bootstrap';
import { NavItem, NavSection, type NavItemT, type NavSectionLoaded } from '../schema';
import type { TrellisDb } from 'trellis/client/sdk';

const props = defineProps<{
  client: TrellisDb;
  section: NavSectionLoaded;
}>();

const items = () => props.section.items ?? [];
const itemMut = useMutation(props.client, NavItem);
const sectionMut = useMutation(props.client, NavSection);

function addItem() {
  const label = prompt('New item label')?.trim();
  if (!label) return;
  const list = items();
  itemMut.create({
    label,
    order: list.length,
    section: props.section.id,
  });
}
</script>

<template>
  <section class="nav-section">
    <header>
      <button
        class="twisty"
        :aria-label="section.collapsed ? 'Expand' : 'Collapse'"
        @click="sectionMut.update(section.id, { collapsed: !section.collapsed })"
      >
        {{ section.collapsed ? '▸' : '▾' }}
      </button>
      <span class="section-label">{{ section.label }}</span>
      <span class="count">{{ items().length }}</span>
      <button class="ghost" title="Add item" @click="addItem">+</button>
      <button
        class="ghost danger"
        title="Delete section"
        @click="sectionMut.remove(section.id)"
      >
        ×
      </button>
    </header>
    <ul v-if="!section.collapsed">
      <li v-for="item in [...items()].sort(byOrder)" :key="item.id">
        <a :href="item.href ?? '#'">{{ item.label }}</a>
        <button class="ghost danger" @click="itemMut.remove(item.id)">×</button>
      </li>
      <li v-if="items().length === 0" class="empty">No items yet</li>
    </ul>
  </section>
</template>
