<script lang="ts">
	import type { AnyType } from 'trellis/schema';
	import {
		eligibleCollectionViews,
		suggestDefaultCollectionView,
		type CollectionViewMode
	} from '$lib/registry';

	interface Props {
		schema: AnyType;
		value?: CollectionViewMode;
		onchange?: (mode: CollectionViewMode) => void;
	}

	let { schema, value, onchange }: Props = $props();

	const eligible = $derived(eligibleCollectionViews(schema));
	const defaultMode = $derived(suggestDefaultCollectionView(schema));
	const active = $derived(value ?? defaultMode);

	function select(mode: CollectionViewMode) {
		onchange?.(mode);
	}
</script>

<div class="collection-view-picker" data-testid="collection-view-picker">
	<span class="collection-view-picker-label">View</span>
	<div class="collection-view-picker-options" role="radiogroup" aria-label="Collection view">
		{#each eligible as option (option.mode)}
			<button
				type="button"
				class="collection-view-picker-option"
				role="radio"
				aria-checked={active === option.mode}
				data-view={option.mode}
				data-default={option.isDefault ? 'true' : undefined}
				title={option.reason}
				onclick={() => select(option.mode)}
			>
				{option.label}
				{#if option.isDefault}
					<span class="collection-view-picker-default">default</span>
				{/if}
			</button>
		{/each}
	</div>
</div>

<style>
	.collection-view-picker {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.collection-view-picker-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--carbon-text-secondary, #6f6f6f);
	}

	.collection-view-picker-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.collection-view-picker-option {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid var(--carbon-border, #393939);
		border-radius: 0.25rem;
		background: transparent;
		color: var(--carbon-text-primary, #f4f4f4);
		font-size: 0.8125rem;
		padding: 0.25rem 0.5rem;
		cursor: pointer;
	}

	.collection-view-picker-option[aria-checked='true'] {
		border-color: var(--carbon-interactive, #4589ff);
		background: color-mix(in srgb, var(--carbon-interactive, #4589ff) 12%, transparent);
	}

	.collection-view-picker-default {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.75;
	}
</style>
