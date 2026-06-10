<script lang="ts">
	import { goto } from '$app/navigation';
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
		validateRecordFields,
		type CollectionMeta,
		type CollectionRecord
	} from '$lib/schemas/collection';
	import { MAIN_LANE } from '$lib/trellis/lane';
	import { suggestDefaultCollectionView, type CollectionViewMode } from '$lib/registry';
	import { getViewerBand } from '$lib/ui/band';
	import CollectionPageShell from '$lib/ui/CollectionPageShell.svelte';
	import CollectionViewPicker from '$lib/ui/CollectionViewPicker.svelte';
	import LiveIndicator from '$lib/ui/LiveIndicator.svelte';
	import { resolveCollectionPageVariant } from '$lib/ui/page-variants';
	import { getAppShellContext } from '$lib/ui/app-shell-context';

	const appShell = getAppShellContext();
	const band = getViewerBand();
	const isEditor = $derived(band === 'L2' || band === 'L3');

	const client = new TrellisDb({ url: trellisClientUrl() });
	const metaMut = mutations(client, CollectionMetaType);
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
	let newBody = $state('');
	let creating = $state(false);
	let createError = $state<string | null>(null);
	let fieldErrors = $state<Record<string, string>>({});
	let viewMode = $state<CollectionViewMode>(suggestDefaultCollectionView(CollectionRecordType));

	const variant = $derived(resolveCollectionPageVariant(viewMode, band));

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

	function clearFieldError(id: string) {
		if (!(id in fieldErrors)) return;
		const next = { ...fieldErrors };
		delete next[id];
		fieldErrors = next;
	}

	async function addRecord(event: SubmitEvent) {
		event.preventDefault();
		if (!collection) return;
		createError = null;
		const title = newTitle.trim();
		const body = newBody.trim();
		const check = validateRecordFields({ title, body: body || undefined });
		if (!check.ok) {
			createError = check.message;
			return;
		}
		if (creating) return;
		creating = true;
		try {
			await recordMut.create({
				collectionId: collection.id,
				title,
				body: body || undefined,
				sortOrder: rows.length,
				laneId: MAIN_LANE
			});
			newTitle = '';
			newBody = '';
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
		const check = validateRecordFields({ title: trimmed, body: record.body });
		if (!check.ok) {
			fieldErrors = { ...fieldErrors, [`${record.id}:title`]: check.message };
			return;
		}
		clearFieldError(`${record.id}:title`);
		if (trimmed === record.title) return;
		await recordMut.update(record.id, { title: trimmed });
	}

	async function updateBody(record: CollectionRecord, body: string) {
		const trimmed = body.trim();
		const check = validateRecordFields({ title: record.title, body: trimmed || undefined });
		if (!check.ok) {
			fieldErrors = { ...fieldErrors, [`${record.id}:body`]: check.message };
			return;
		}
		clearFieldError(`${record.id}:body`);
		const nextBody = trimmed || undefined;
		if (nextBody === (record.body ?? undefined)) return;
		await recordMut.update(record.id, { body: nextBody });
	}

	async function updateMetaTitle(title: string) {
		if (!collection || !isEditor) return;
		const trimmed = title.trim();
		if (!trimmed || trimmed === collection.title) return;
		await metaMut.update(collection.id, { title: trimmed });
	}

	async function updateMetaDescription(description: string) {
		if (!collection || !isEditor) return;
		const trimmed = description.trim();
		if (trimmed === (collection.description ?? '')) return;
		await metaMut.update(collection.id, { description: trimmed || undefined });
	}

	async function removeCollection() {
		if (!collection || !isEditor) return;
		if (!confirm(`Delete “${collection.title}” and all ${rows.length} record(s)?`)) return;
		for (const row of rows) {
			await recordMut.remove(row.id);
		}
		await metaMut.remove(collection.id);
		await goto(resolve('/'));
	}

	function openRecordSelection(record: CollectionRecord) {
		appShell.setSelection({
			id: record.id,
			entityClass: 'document'
		});
	}
</script>

<CollectionPageShell {variant}>
	{#snippet header()}
		<a href={resolve('/')} class="inline-flex items-center gap-1 text-sm text-carbon-interactive no-underline">
			<ArrowLeft size={16} />
			Collections
		</a>
		{#if collection}
			<div class="flex items-center gap-2">
				<span class="text-2xl" aria-hidden="true">{collection.icon ?? '📁'}</span>
				{#if isEditor}
					<input
						class="carbon-text-input carbon-section-title flex-1 border-0 bg-transparent p-0"
						value={collection.title}
						aria-label="Collection title"
						data-testid="collection-meta-title"
						onchange={(e) => updateMetaTitle(e.currentTarget.value)}
					/>
				{:else}
					<h1 class="carbon-section-title">{collection.title}</h1>
				{/if}
			</div>
			{#if isEditor}
				<textarea
					class="carbon-text-input min-h-[4rem] w-full resize-y text-sm text-carbon-text-secondary"
					value={collection.description ?? ''}
					placeholder="Description…"
					aria-label="Collection description"
					data-testid="collection-meta-description"
					onchange={(e) => updateMetaDescription(e.currentTarget.value)}
				></textarea>
				<button
					type="button"
					class="carbon-btn-danger text-sm"
					data-testid="delete-collection"
					onclick={removeCollection}
				>
					<TrashCan size={16} />
					Delete collection
				</button>
			{:else if collection.description}
				<p class="text-sm text-carbon-text-secondary">{collection.description}</p>
			{/if}
		{:else if !metaList.loading}
			<h1 class="carbon-section-title">Collection not found</h1>
		{/if}
	{/snippet}

	{#snippet toolbar()}
		<CollectionViewPicker
			schema={CollectionRecordType}
			value={viewMode}
			onchange={(mode) => {
				viewMode = mode;
			}}
		/>
	{/snippet}

	{#snippet actions()}
		<LiveIndicator {connected} />
	{/snippet}

	{#snippet children()}
		{#if collection}
			{#if variant === 'calendar' || variant === 'grid'}
				<CollectionViewPicker
					schema={CollectionRecordType}
					value={viewMode}
					onchange={(mode) => {
						viewMode = mode;
					}}
				/>
			{/if}

			{#if isEditor}
				<form class="space-y-2 rounded border border-carbon-border p-4" onsubmit={addRecord}>
					<div class="flex gap-2">
						<input
							bind:value={newTitle}
							class="carbon-text-input flex-1"
							placeholder="Title…"
							aria-label="New record title"
							data-testid="new-record-input"
						/>
						<button type="submit" class="carbon-btn-primary" disabled={creating || !newTitle.trim()}>
							<Add size={16} />
							Add
						</button>
					</div>
					<textarea
						bind:value={newBody}
						class="carbon-text-input min-h-[5rem] w-full resize-y text-sm"
						placeholder="Body (optional)…"
						aria-label="New record body"
						data-testid="new-record-body"
					></textarea>
					{#if createError}
						<p class="text-sm text-carbon-support-error" data-testid="create-record-error">{createError}</p>
					{/if}
				</form>
			{/if}

			{#if records.loading}
				<p class="text-sm text-carbon-text-secondary">Loading records…</p>
			{:else if rows.length === 0}
				<p class="text-sm text-carbon-text-secondary">No records yet.</p>
			{:else}
				<ul class="divide-y divide-carbon-border border border-carbon-border" data-testid="record-list">
					{#each rows as record (record.id)}
						<li
							class="cursor-pointer space-y-2 p-3 hover:bg-carbon-layer-01"
							data-testid="record-row"
							data-record-id={record.id}
							data-record-title={record.title}
							data-record-body={record.body ?? ''}
							role="button"
							tabindex="0"
							onclick={() => openRecordSelection(record)}
							onkeydown={(e) => {
								if (e.key !== 'Enter' && e.key !== ' ') return;
								e.preventDefault();
								openRecordSelection(record);
							}}
						>
							<div class="flex items-start gap-2">
								{#if isEditor}
									<input
										class="carbon-text-input flex-1 font-medium"
										value={record.title}
										aria-label="Record title"
										onchange={(e) => updateTitle(record, e.currentTarget.value)}
									/>
									<button
										type="button"
										class="carbon-btn-ghost p-2"
										aria-label="Delete record"
										onclick={(e) => {
											e.stopPropagation();
											void removeRecord(record.id);
										}}
									>
										<TrashCan size={16} />
									</button>
								{:else}
									<span class="flex-1 font-medium">{record.title}</span>
								{/if}
							</div>
							{#if fieldErrors[`${record.id}:title`]}
								<p class="text-xs text-carbon-support-error">{fieldErrors[`${record.id}:title`]}</p>
							{/if}
							{#if isEditor}
								<textarea
									class="carbon-text-input min-h-[4rem] w-full resize-y text-sm text-carbon-text-secondary"
									value={record.body ?? ''}
									placeholder="Body…"
									aria-label="Record body"
									data-testid="record-body"
									onchange={(e) => updateBody(record, e.currentTarget.value)}
								></textarea>
							{:else if record.body}
								<p class="text-sm text-carbon-text-secondary">{record.body}</p>
							{/if}
							{#if fieldErrors[`${record.id}:body`]}
								<p class="text-xs text-carbon-support-error">{fieldErrors[`${record.id}:body`]}</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{/snippet}
</CollectionPageShell>
