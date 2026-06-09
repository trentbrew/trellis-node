<script lang="ts">
	import { page } from '$app/state';
	import { mutations } from 'trellis/svelte/typed';
	import { byOrder } from '$lib/trellis/bootstrap-nav';
	import { NavItem, NavSection, type NavSectionLoaded } from '$lib/schemas/nav';
	import type { TrellisDb } from 'trellis/client/sdk';

	let { client, section }: { client: TrellisDb; section: NavSectionLoaded } = $props();

	const itemMut = mutations(client, NavItem);
	const sectionMut = mutations(client, NavSection);

	const items = $derived(section.items ?? []);

	function navHref(href: string | undefined) {
		if (!href || href === '#') return '/';
		return href;
	}

	function isActive(href: string | undefined) {
		const path = page.url.pathname;
		const target = navHref(href);
		if (target === '/') return path === '/';
		return path.startsWith(target);
	}

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

<section class="mb-1">
	<header class="flex items-center gap-1 rounded px-2 py-1.5 hover:bg-white/5">
		<button
			type="button"
			class="w-4 text-xs text-white/50"
			aria-label={section.collapsed ? 'Expand' : 'Collapse'}
			onclick={() => sectionMut.update(section.id, { collapsed: !section.collapsed })}
		>
			{section.collapsed ? '▸' : '▾'}
		</button>
		<span class="flex-1 text-xs font-semibold tracking-wide text-white/90">{section.label}</span>
		<span class="rounded-full bg-white/10 px-1.5 text-[10px] text-white/50">{items.length}</span>
		<button
			type="button"
			class="text-xs text-white/40 hover:text-white/80"
			title="Add item"
			onclick={addItem}>+</button
		>
	</header>
	{#if !section.collapsed}
		<ul class="mb-2 space-y-0.5 pl-5">
			{#each [...items].sort(byOrder) as item (item.id)}
				<li class="flex items-center gap-1">
					<a
						href={navHref(item.href)}
						class="flex-1 rounded px-2 py-1 text-sm transition-colors hover:bg-white/10 {isActive(
							item.href
						)
							? 'bg-white/15 text-white'
							: 'text-white/75'}"
						aria-current={isActive(item.href) ? 'page' : undefined}
					>
						{item.label}
					</a>
					<button
						type="button"
						class="px-1 text-xs text-white/30 hover:text-red-400"
						onclick={() => itemMut.remove(item.id)}>×</button
					>
				</li>
			{/each}
			{#if items.length === 0}
				<li class="px-2 text-xs italic text-white/40">No items yet</li>
			{/if}
		</ul>
	{/if}
</section>
