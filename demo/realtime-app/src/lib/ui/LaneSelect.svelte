<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Select } from 'bits-ui';
	import ChevronDown from 'carbon-icons-svelte/lib/ChevronDown.svelte';
	import Checkmark from 'carbon-icons-svelte/lib/Checkmark.svelte';
	import type { LaneId } from '$lib/trellis/lane';

	interface Props {
		lane: LaneId;
		extraLanes?: LaneId[];
	}

	let { lane, extraLanes = ['agent:demo'] }: Props = $props();

	const items = $derived.by(() => {
		const seen = new Set<LaneId>();
		const options: { value: LaneId; label: string }[] = [];

		for (const value of ['main', ...extraLanes, lane] as LaneId[]) {
			if (seen.has(value)) continue;
			seen.add(value);
			options.push({ value, label: value });
		}

		return options;
	});

	function onLaneChange(value: string) {
		if (!value || value === lane) return;
		const href =
			value === 'main' ? resolve('/') : `${resolve('/')}?lane=${encodeURIComponent(value)}`;
		goto(href);
	}
</script>

<Select.Root type="single" {items} value={lane} onValueChange={onLaneChange}>
	<Select.Trigger class="carbon-select-trigger" aria-label="Select lane">
		<Select.Value />
		<ChevronDown size={16} class="text-carbon-text-secondary" />
	</Select.Trigger>
	<Select.Portal>
		<Select.Content class="carbon-select-content" sideOffset={4}>
			<Select.Viewport>
				{#each items as item (item.value)}
					<Select.Item class="carbon-select-item" value={item.value} label={item.label}>
						{#snippet children({ selected })}
							<span>{item.label}</span>
							{#if selected}
								<Checkmark size={16} class="ml-auto text-carbon-interactive" />
							{/if}
						{/snippet}
					</Select.Item>
				{/each}
			</Select.Viewport>
		</Select.Content>
	</Select.Portal>
</Select.Root>
