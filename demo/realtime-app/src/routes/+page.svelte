<script lang="ts">
	import { resolve } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import Add from 'carbon-icons-svelte/lib/Add.svelte';
	import { TrellisDb } from 'trellis/client/sdk';
	import { entitiesStore, mutations } from 'trellis/svelte/typed';
	import { getPlatformStatus } from './platform.remote';
	import { bootstrapExplorerSchemas, trellisClientUrl } from '$lib/trellis/bootstrap-schemas';
	import {
		CollectionMetaType,
		slugify,
		sortMeta,
		type CollectionMeta
	} from '$lib/schemas/collection';
	import LiveIndicator from '$lib/ui/LiveIndicator.svelte';

	const client = new TrellisDb({ url: trellisClientUrl() });
	const metaMut = mutations(client, CollectionMetaType);
	const status = getPlatformStatus();

	let ready = $state(false);
	let collections = $state<{ data: CollectionMeta[]; loading: boolean; error: Error | null }>({
		data: [],
		loading: true,
		error: null
	});

	const connected = $derived(!collections.loading && !collections.error);
	const sorted = $derived(sortMeta(collections.data));

	let newTitle = $state('');
	let creating = $state(false);

	onMount(() => {
		bootstrapExplorerSchemas(client)
			.then(() => {
				ready = true;
			})
			.catch(() => {
				ready = true;
			});
	});

	onDestroy(() => client.disconnect());

	$effect(() => {
		if (!ready) return;
		const store = entitiesStore(client, CollectionMetaType);
		return store.subscribe((value) => {
			collections = value;
		});
	});

	async function createCollection(event: SubmitEvent) {
		event.preventDefault();
		const title = newTitle.trim();
		if (!title || creating) return;
		creating = true;
		try {
			const slug = slugify(title);
			await metaMut.create({
				title,
				slug,
				sortOrder: sorted.length,
				color: '#0f62fe'
			});
			newTitle = '';
		} finally {
			creating = false;
		}
	}
</script>

<main class="mx-auto max-w-4xl space-y-6 p-6" data-testid="collections-home">
	<header class="flex items-start justify-between gap-4">
		<div class="space-y-1">
			<h1 class="carbon-section-title">Collections</h1>
			<p class="max-w-xl text-sm text-carbon-text-secondary">
				Named tables with live records — typed SDK on <code>CollectionMeta</code> and
				<code>CollectionRecord</code>.
			</p>
		</div>
		<LiveIndicator {connected} />
	</header>

	{#await status}
		<p class="text-sm text-carbon-text-secondary">Checking platform…</p>
	{:then platform}
		{#if platform.configured}
			<p class="text-xs text-carbon-text-secondary" data-testid="platform-status">
				{platform.collections} collections · {platform.mainRecords} records on main · Trellis
				{platform.trellis ? 'online' : 'offline'}
			</p>
		{/if}
	{/await}

	<form class="flex gap-2" onsubmit={createCollection}>
		<input
			bind:value={newTitle}
			class="carbon-text-input flex-1"
			placeholder="New collection…"
			aria-label="New collection title"
			data-testid="new-collection-input"
		/>
		<button type="submit" class="carbon-btn-primary" disabled={creating || !newTitle.trim()}>
			<Add size={16} />
			Add
		</button>
	</form>

	{#if collections.error}
		<p class="text-sm text-carbon-support-error">Sidecar unavailable — start with <code>pnpm dev:all</code>.</p>
	{:else if collections.loading}
		<p class="text-sm text-carbon-text-secondary">Loading collections…</p>
	{:else if sorted.length === 0}
		<p class="text-sm text-carbon-text-secondary">No collections yet — create one above.</p>
	{:else}
		<ul class="grid gap-4 sm:grid-cols-2" data-testid="collection-grid">
			{#each sorted as collection (collection.id)}
				<li>
					<a
						href={resolve(`/collections/${collection.slug}`)}
						class="carbon-tile flex h-full flex-col gap-2 p-4 no-underline hover:border-carbon-interactive"
						data-testid="collection-card"
						data-slug={collection.slug}
					>
						<span class="text-2xl" aria-hidden="true">{collection.icon ?? '📁'}</span>
						<span class="font-medium text-carbon-text">{collection.title}</span>
						{#if collection.description}
							<span class="text-sm text-carbon-text-secondary line-clamp-2">{collection.description}</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>
