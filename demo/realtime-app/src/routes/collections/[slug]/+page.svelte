<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onDestroy, onMount } from 'svelte';
	import Add from 'carbon-icons-svelte/lib/Add.svelte';
	import TrashCan from 'carbon-icons-svelte/lib/TrashCan.svelte';
	import ArrowLeft from 'carbon-icons-svelte/lib/ArrowLeft.svelte';
	import { TrellisDb } from 'trellis/client/sdk';
	import { entitiesStore, mutations } from 'trellis/svelte/typed';
	import { bootstrapExplorerSchemas, trellisClientUrl } from '$lib/trellis/bootstrap-schemas';
	import {
		CollectionMetaType,
		CollectionRecordType,
		sortRecords,
		type CollectionMeta,
		type CollectionRecord
	} from '$lib/schemas/collection';
	import { MAIN_LANE } from '$lib/trellis/lane';
	import LiveIndicator from '$lib/ui/LiveIndicator.svelte';

	const client = new TrellisDb({ url: trellisClientUrl() });
	const recordMut = mutations(client, CollectionRecordType);

	const slug = $derived(page.params.slug ?? '');

	let ready = $state(false);
	let metaList = $state<{ data: CollectionMeta[]; loading: boolean; error: Error | null }>({
		data: [],
		loading: true,
		error: null
	});
	let records = $state<{ data: CollectionRecord[]; loading: boolean; error: Error | null }>({
		data: [],
		loading: true,
		error: null
	});

	const collection = $derived(metaList.data.find((item) => item.slug === slug) ?? null);
	const rows = $derived(
		collection
			? sortRecords(records.data.filter((row) => row.collectionId === collection.id))
			: []
	);

	const connected = $derived(
		!metaList.loading && !metaList.error && !records.loading && !records.error
	);

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
			metaList = value;
		});
	});

	$effect(() => {
		if (!ready || !collection) return;
		const collectionId = collection.id;
		const store = entitiesStore(client, CollectionRecordType, { where: { collectionId } });
		return store.subscribe((value) => {
			records = value;
		});
	});

	async function addRecord(event: SubmitEvent) {
		event.preventDefault();
		if (!collection) return;
		const title = newTitle.trim();
		if (!title || creating) return;
		creating = true;
		try {
			await recordMut.create({
				collectionId: collection.id,
				title,
				sortOrder: rows.length,
				laneId: MAIN_LANE
			});
			newTitle = '';
		} finally {
			creating = false;
		}
	}

	async function removeRecord(id: string) {
		if (!confirm('Delete this record?')) return;
		await recordMut.remove(id);
	}

	async function updateTitle(record: CollectionRecord, title: string) {
		const trimmed = title.trim();
		if (!trimmed || trimmed === record.title) return;
		await recordMut.update(record.id, { title: trimmed });
	}
</script>

<main class="mx-auto max-w-3xl space-y-6 p-6" data-testid="collection-records">
	<header class="flex items-start justify-between gap-4">
		<div class="space-y-2">
			<a href={resolve('/')} class="inline-flex items-center gap-1 text-sm text-carbon-interactive no-underline">
				<ArrowLeft size={16} />
				Collections
			</a>
			{#if collection}
				<div class="flex items-center gap-2">
					<span class="text-2xl" aria-hidden="true">{collection.icon ?? '📁'}</span>
					<h1 class="carbon-section-title">{collection.title}</h1>
				</div>
				{#if collection.description}
					<p class="text-sm text-carbon-text-secondary">{collection.description}</p>
				{/if}
			{:else if !metaList.loading}
				<h1 class="carbon-section-title">Collection not found</h1>
			{/if}
		</div>
		<LiveIndicator {connected} />
	</header>

	{#if collection}
		<form class="flex gap-2" onsubmit={addRecord}>
			<input
				bind:value={newTitle}
				class="carbon-text-input flex-1"
				placeholder="Add a record…"
				aria-label="New record title"
				data-testid="new-record-input"
			/>
			<button type="submit" class="carbon-btn-primary" disabled={creating || !newTitle.trim()}>
				<Add size={16} />
				Add
			</button>
		</form>

		{#if records.loading}
			<p class="text-sm text-carbon-text-secondary">Loading records…</p>
		{:else if rows.length === 0}
			<p class="text-sm text-carbon-text-secondary">No records yet.</p>
		{:else}
			<ul class="divide-y divide-carbon-border border border-carbon-border" data-testid="record-list">
				{#each rows as record (record.id)}
					<li class="flex items-start gap-2 p-3" data-testid="record-row" data-record-id={record.id}>
						<input
							class="carbon-text-input flex-1"
							value={record.title}
							aria-label="Record title"
							onchange={(e) => updateTitle(record, e.currentTarget.value)}
						/>
						<button
							type="button"
							class="carbon-btn-ghost p-2"
							aria-label="Delete record"
							onclick={() => removeRecord(record.id)}
						>
							<TrashCan size={16} />
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</main>
