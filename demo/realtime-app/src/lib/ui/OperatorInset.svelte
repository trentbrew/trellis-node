<script lang="ts">
	import { browser } from '$app/environment';
	import { Dialog, ScrollArea, Tabs } from 'bits-ui';
	import { resolveInsetTemplate } from '$lib/registry';
	import {
		QUERY_EXAMPLES,
		entityAttrs,
		entityTypeCounts,
		fetchEntities,
		fetchHealth,
		runQuery,
		type TrellisEntity
	} from '$lib/inspector/inspector-api';
	import { trellisClientUrl } from '$lib/trellis/bootstrap-schemas';
	import type { AppSelection } from '$lib/ui/app-shell-context';

	let {
		open = $bindable(false),
		selection = null
	}: {
		open?: boolean;
		selection?: AppSelection;
	} = $props();

	const template = $derived(
		selection
			? resolveInsetTemplate({
					entityClass: selection.entityClass,
					dialogShell: selection.dialogShell
				})
			: null
	);

	let activeTab = $state<'entities' | 'query' | 'stats'>('entities');
	let entities = $state<TrellisEntity[]>([]);
	let entityTypes = $state<string[]>([]);
	let selectedType = $state<string | null>(null);
	let expandedIds = $state<Set<string>>(new Set());
	let loadingEntities = $state(false);

	let queryText = $state('');
	let queryResult = $state<unknown>(null);
	let queryError = $state<string | null>(null);
	let queryLoading = $state(false);

	let health = $state<unknown>(null);
	let entityCounts = $state<Record<string, number>>({});
	let totalEntities = $state(0);
	let statsError = $state<string | null>(null);

	const filteredEntities = $derived(
		selectedType ? entities.filter((e) => e.type === selectedType) : entities
	);

	const baseUrl = $derived(browser ? trellisClientUrl() || window.location.origin : '');

	async function loadEntities() {
		if (!browser || !baseUrl) return;
		loadingEntities = true;
		try {
			const json = await fetchEntities(baseUrl);
			entities = json.data;
			entityTypes = [...new Set(entities.map((e) => String(e.type ?? 'unknown')))];
			if (selection?.id) {
				expandedIds = new Set([selection.id]);
			}
		} catch {
			entities = [];
			entityTypes = [];
		} finally {
			loadingEntities = false;
		}
	}

	async function loadStats() {
		if (!browser || !baseUrl) return;
		statsError = null;
		try {
			const [h, e] = await Promise.all([
				fetchHealth(baseUrl),
				fetchEntities(baseUrl, 500)
			]);
			health = h;
			entityCounts = entityTypeCounts(e.data);
			totalEntities = e.total ?? e.data.length;
		} catch (err) {
			statsError = err instanceof Error ? err.message : 'Failed to load stats';
		}
	}

	async function submitQuery() {
		if (!browser || !baseUrl || !queryText.trim()) return;
		queryLoading = true;
		queryError = null;
		queryResult = null;
		try {
			queryResult = await runQuery(baseUrl, queryText.trim());
		} catch (err) {
			queryError = err instanceof Error ? err.message : 'Query failed';
		} finally {
			queryLoading = false;
		}
	}

	function toggleExpand(id: string) {
		const next = new Set(expandedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expandedIds = next;
	}

	function onTabChange(value: string) {
		if (value !== 'entities' && value !== 'query' && value !== 'stats') return;
		activeTab = value;
		if (value === 'entities') void loadEntities();
		else if (value === 'stats') void loadStats();
	}

	$effect(() => {
		if (!open || !browser) return;
		onTabChange(activeTab);
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
		/>
		<Dialog.Content
			class="fixed right-0 top-12 bottom-0 z-50 flex w-80 flex-col border-l border-white/10 bg-carbon-header text-white shadow-xl outline-none sm:w-96 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
			data-testid="operator-inset"
			aria-label="Operator inset"
		>
			<div class="border-b border-white/10 px-4 py-3">
				<Dialog.Title class="text-sm font-medium">
					{#if template}
						Inset: {template.label} (anchored)
					{:else}
						Graph tools (ambient)
					{/if}
				</Dialog.Title>
				{#if selection?.id}
					<Dialog.Description class="mt-1 truncate text-xs text-white/60">
						Selection: {selection.id}
					</Dialog.Description>
				{/if}
			</div>

			<Tabs.Root value={activeTab} onValueChange={onTabChange} class="flex min-h-0 flex-1 flex-col">
				<Tabs.List
					class="flex shrink-0 gap-1 border-b border-white/10 px-3 py-2"
					aria-label="Inspector tabs"
				>
					{#each ['entities', 'query', 'stats'] as tab (tab)}
						<Tabs.Trigger
							value={tab}
							class="rounded px-2 py-1 text-xs capitalize text-white/60 data-[state=active]:bg-white/10 data-[state=active]:text-white"
						>
							{tab}
						</Tabs.Trigger>
					{/each}
				</Tabs.List>

				<Tabs.Content value="entities" class="min-h-0 flex-1 outline-none">
					<ScrollArea.Root class="h-full">
						<ScrollArea.Viewport class="h-full max-h-[calc(100vh-12rem)] px-3 py-2">
							<div class="mb-2 flex flex-wrap gap-1">
								<button
									type="button"
									class="rounded px-2 py-0.5 text-xs {selectedType === null
										? 'bg-violet-600 text-white'
										: 'bg-white/10 text-white/70'}"
									onclick={() => {
										selectedType = null;
									}}
								>
									All
								</button>
								{#each entityTypes as type (type)}
									<button
										type="button"
										class="rounded px-2 py-0.5 text-xs {selectedType === type
											? 'bg-violet-600 text-white'
											: 'bg-white/10 text-white/70'}"
										onclick={() => {
											selectedType = type;
										}}
									>
										{type}
									</button>
								{/each}
								<button
									type="button"
									class="ml-auto rounded px-2 py-0.5 text-xs text-white/60 hover:bg-white/10"
									onclick={loadEntities}
								>
									Refresh
								</button>
							</div>
							{#if loadingEntities}
								<p class="text-xs text-white/50">Loading…</p>
							{:else if filteredEntities.length === 0}
								<p class="text-xs text-white/50">No entities.</p>
							{:else}
								<ul class="space-y-1">
									{#each filteredEntities as entity (String(entity.id))}
										{@const id = String(entity.id ?? '')}
										<li
											class="rounded border border-white/10 {selection?.id === id
												? 'border-violet-500/60 bg-violet-500/10'
												: 'bg-white/5'}"
										>
											<button
												type="button"
												class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
												onclick={() => toggleExpand(id)}
											>
												<span class="text-white/40">{expandedIds.has(id) ? '▼' : '▶'}</span>
												<span class="truncate font-medium">{entity.type}</span>
												<span class="truncate text-white/50">{id}</span>
											</button>
											{#if expandedIds.has(id)}
												<dl class="space-y-0.5 border-t border-white/10 px-2 py-1.5 text-[11px]">
													{#each entityAttrs(entity) as [key, value] (key)}
														<div class="grid grid-cols-[6rem_1fr] gap-1">
															<dt class="text-white/40">{key}</dt>
															<dd class="truncate text-white/80">{JSON.stringify(value)}</dd>
														</div>
													{/each}
												</dl>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
						</ScrollArea.Viewport>
						<ScrollArea.Scrollbar orientation="vertical" />
					</ScrollArea.Root>
				</Tabs.Content>

				<Tabs.Content value="query" class="min-h-0 flex-1 px-3 py-2 outline-none">
					<div class="mb-2 flex flex-wrap gap-1">
						{#each QUERY_EXAMPLES as example (example)}
							<button
								type="button"
								class="rounded bg-white/10 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/15"
								onclick={() => {
									queryText = example;
								}}
							>
								{example}
							</button>
						{/each}
					</div>
					<textarea
						bind:value={queryText}
						class="carbon-text-input mb-2 min-h-[5rem] w-full resize-y text-xs"
						placeholder="EQL-S query…"
						aria-label="EQL-S query"
					></textarea>
					<button
						type="button"
						class="carbon-btn-primary mb-2 text-xs"
						disabled={queryLoading || !queryText.trim()}
						onclick={submitQuery}
					>
						{queryLoading ? 'Running…' : 'Run query'}
					</button>
					{#if queryError}
						<p class="text-xs text-carbon-support-error">{queryError}</p>
					{/if}
					{#if queryResult}
						<pre
							class="max-h-48 overflow-auto rounded border border-white/10 bg-black/30 p-2 text-[10px] text-white/80"
						>{JSON.stringify(queryResult, null, 2)}</pre>
					{/if}
				</Tabs.Content>

				<Tabs.Content value="stats" class="min-h-0 flex-1 px-3 py-2 text-xs outline-none">
					{#if statsError}
						<p class="text-carbon-support-error">{statsError}</p>
					{:else}
						<p class="mb-2 text-white/70">Total entities: {totalEntities}</p>
						{#if health}
							<pre
								class="mb-3 max-h-32 overflow-auto rounded border border-white/10 bg-black/30 p-2 text-[10px] text-white/80"
							>{JSON.stringify(health, null, 2)}</pre>
						{/if}
						<ul class="space-y-1">
							{#each Object.entries(entityCounts) as [type, count] (type)}
								<li class="flex justify-between text-white/70">
									<span>{type}</span>
									<span>{count}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</Tabs.Content>
			</Tabs.Root>

			<div class="shrink-0 border-t border-white/10 px-3 py-2">
				<Dialog.Close class="carbon-btn-secondary w-full text-xs">Close</Dialog.Close>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
