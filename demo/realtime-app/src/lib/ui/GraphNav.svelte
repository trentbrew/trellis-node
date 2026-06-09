<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { TrellisDb } from 'trellis/client/sdk';
	import { entitiesStore, mutations } from 'trellis/svelte/typed';
	import {
		bootstrapGraphNav,
		byOrder,
		trellisClientUrl
	} from '$lib/trellis/bootstrap-nav';
	import { NavSection, type NavSectionLoaded } from '$lib/schemas/nav';
	import NavSectionBlock from '$lib/ui/NavSectionBlock.svelte';

	const client = new TrellisDb({ url: trellisClientUrl() });
	const sections = entitiesStore(client, NavSection, { resolve: { items: true } });
	const sectionMut = mutations(client, NavSection);

	let ready = $state(false);
	let failed = $state(false);

	const FALLBACK = [
		{ href: '/', label: 'Frameworks' },
		{ href: '/fractal', label: 'Fractal' },
		{ href: '/presence', label: 'Cursors' },
		{ href: '/chat', label: 'Chat' },
		{ href: '/editor', label: 'Editor' }
	];

	onMount(() => {
		bootstrapGraphNav(client)
			.then(() => {
				ready = true;
			})
			.catch(() => {
				failed = true;
				ready = true;
			});
	});

	onDestroy(() => client.disconnect());

	function addSection() {
		const label = prompt('New section label')?.trim();
		if (!label) return;
		sectionMut.create({
			label,
			order: $sections.data.length,
			collapsed: false
		});
	}
</script>

<aside
	class="flex h-full flex-col border-r border-white/10 bg-carbon-header px-3 py-4 text-white"
	data-testid="graph-nav"
>
	<div class="mb-4 flex items-center gap-2 px-1 text-sm font-medium tracking-wide">
		<span class="h-2.5 w-2.5 rounded-full bg-violet-500 shadow-[0_0_10px] shadow-violet-500/60"
		></span>
		Trellis · <span class="text-white/50">graph nav</span>
	</div>

	{#if !ready}
		<p class="px-1 text-xs text-white/50">Booting graph…</p>
	{:else if failed}
		<nav class="space-y-1" aria-label="Fallback navigation">
			{#each FALLBACK as link (link.href)}
				<a
					href={link.href}
					class="block rounded px-2 py-1.5 text-sm text-white/80 hover:bg-white/10"
				>
					{link.label}
				</a>
			{/each}
		</nav>
		<p class="mt-3 px-1 text-[10px] text-white/40">Sidecar offline — start pnpm dev:trellis</p>
	{:else}
		<nav class="min-h-0 flex-1 overflow-y-auto" aria-label="Graph navigation">
			{#if $sections.loading && $sections.data.length === 0}
				<p class="px-1 text-xs text-white/50">Loading…</p>
			{:else}
				{#each ($sections.data as NavSectionLoaded[]).slice().sort(byOrder) as section (section.id)}
					<NavSectionBlock {client} {section} />
				{/each}
			{/if}
		</nav>
		<button
			type="button"
			class="mt-3 w-full rounded border border-white/10 px-2 py-1.5 text-xs text-white/60 hover:bg-white/5"
			onclick={addSection}>+ Section</button
		>
		<p class="mt-2 px-1 text-[10px] leading-snug text-white/35">
			Live <code class="text-white/50">NavSection</code> + <code class="text-white/50">resolve</code>
		</p>
	{/if}
</aside>
