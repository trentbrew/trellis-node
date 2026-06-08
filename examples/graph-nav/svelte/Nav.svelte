<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { TrellisDb } from 'trellis/client/sdk';
	import { entitiesStore, mutations } from 'trellis/svelte/typed';
	import { API_URL, bootstrapGraphNav, byOrder } from '../bootstrap';
	import { FRAMEWORK, FRAMEWORK_LINKS } from '../nav-links';
	import { NavSection, type NavSectionLoaded } from '../schema';
	import SectionBlock from './SectionBlock.svelte';

	const client = new TrellisDb({ url: API_URL });
	const sections = entitiesStore(client, NavSection, { resolve: { items: true } });
	const sectionMut = mutations(client, NavSection);

	let ready = $state(false);

	onMount(() => {
		bootstrapGraphNav(client).finally(() => {
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

{#if !ready}
	<p class="hint">Booting graph…</p>
{:else}
	<div class="layout">
		<aside class="sidebar">
			<div class="brand">
				<span class="dot"></span>
				{FRAMEWORK} · <em>graph-nav</em>
			</div>
			<nav class="fw-switcher" aria-label="Framework">
				{#each FRAMEWORK_LINKS as link (link.label)}
					<a href={link.href} class:active={link.label === FRAMEWORK}>{link.label}</a>
				{/each}
			</nav>

			{#if $sections.loading && $sections.data.length === 0}
				<p class="hint">Loading…</p>
			{:else}
				{#each ($sections.data as NavSectionLoaded[]).slice().sort(byOrder) as section (section.id)}
					<SectionBlock {client} {section} />
				{/each}
			{/if}

			<button class="add-section" onclick={addSection}>+ Section</button>
			<p class="footnote">
				One subscription loads sections + items (<code>resolve</code>) — no per-section
				queries.
			</p>
		</aside>

		<main class="canvas">
			<h1>Graph-resident navigation</h1>
			<p>
				Typed entities via <code>defineType</code>, live reads with
				<code>resolve: {'{ items: true }'}</code> from
				<code>trellis/svelte/typed</code>.
			</p>
		</main>
	</div>
{/if}
