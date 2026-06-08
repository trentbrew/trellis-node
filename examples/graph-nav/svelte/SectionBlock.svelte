<script lang="ts">
	import { mutations } from 'trellis/svelte/typed';
	import { byOrder } from '../bootstrap';
	import { NavItem, NavSection, type NavSectionLoaded } from '../schema';
	import type { TrellisDb } from 'trellis/client/sdk';

	let { client, section }: { client: TrellisDb; section: NavSectionLoaded } = $props();

	const itemMut = mutations(client, NavItem);
	const sectionMut = mutations(client, NavSection);

	const items = $derived(section.items ?? []);

	function addItem() {
		const label = prompt('New item label')?.trim();
		if (!label) return;
		itemMut.create({
			label,
			order: items.length,
			section: section.id
		});
	}
</script>

<section class="nav-section">
	<header>
		<button
			class="twisty"
			aria-label={section.collapsed ? 'Expand' : 'Collapse'}
			onclick={() => sectionMut.update(section.id, { collapsed: !section.collapsed })}
		>
			{section.collapsed ? '▸' : '▾'}
		</button>
		<span class="section-label">{section.label}</span>
		<span class="count">{items.length}</span>
		<button class="ghost" title="Add item" onclick={addItem}>+</button>
		<button class="ghost danger" title="Delete section" onclick={() => sectionMut.remove(section.id)}>
			×
		</button>
	</header>
	{#if !section.collapsed}
		<ul>
			{#each [...items].sort(byOrder) as item (item.id)}
				<li>
					<a href={item.href ?? '#'}>{item.label}</a>
					<button class="ghost danger" onclick={() => itemMut.remove(item.id)}>×</button>
				</li>
			{/each}
			{#if items.length === 0}
				<li class="empty">No items yet</li>
			{/if}
		</ul>
	{/if}
</section>
