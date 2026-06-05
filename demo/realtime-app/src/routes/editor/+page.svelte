<script lang="ts">
	import { page } from '$app/state';
	import Add from 'carbon-icons-svelte/lib/Add.svelte';
	import { createBlock, deleteBlock, editBlock, getBlocks } from '../editor.remote';
	import { identity } from '$lib/presence/identity.svelte';
	import BlockRow from '$lib/ui/BlockRow.svelte';
	import LiveIndicator from '$lib/ui/LiveIndicator.svelte';

	const doc = $derived(page.url.searchParams.get('doc')?.trim() || 'draft');
	const blocks = $derived(getBlocks({ doc }));

	function edit(id: string, text: string) {
		void editBlock({ id, text, author: identity.name, color: identity.color });
	}

	function add() {
		void createBlock({ doc, author: identity.name, color: identity.color });
	}

	function remove(id: string) {
		void deleteBlock({ id });
	}
</script>

<main class="mx-auto max-w-2xl space-y-4 p-6" data-testid="editor-app">
	<div class="flex items-start justify-between gap-4">
		<div class="space-y-1">
			<h1 class="carbon-section-title">Block editor</h1>
			<p class="text-sm text-carbon-text-secondary">
				Doc <code>{doc}</code> · block-level last-writer-wins. Edit different blocks in two tabs and they
				merge; edit the same block and the last save wins.
			</p>
		</div>
		<LiveIndicator connected={blocks.connected} />
	</div>

	<div class="space-y-2" data-testid="block-list">
		{#each await blocks as block (block.id)}
			<BlockRow {block} onedit={(text) => edit(block.id, text)} onremove={() => remove(block.id)} />
		{:else}
			<p class="text-sm text-carbon-text-secondary">Empty doc — add the first block.</p>
		{/each}
	</div>

	<button type="button" class="carbon-btn-secondary" onclick={add}>
		<Add size={16} />
		Add block
	</button>
</main>
