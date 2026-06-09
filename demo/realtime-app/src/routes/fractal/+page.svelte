<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Select, Slider, ToggleGroup } from 'bits-ui';
	import ChevronDown from 'carbon-icons-svelte/lib/ChevronDown.svelte';
	import Checkmark from 'carbon-icons-svelte/lib/Checkmark.svelte';
	import { getCustomEntities } from '../data.remote';
	import Thing from '$lib/fractal/Thing.svelte';
	import LiveIndicator from '$lib/ui/LiveIndicator.svelte';

	let lane = $state('main');
	let vantage = $state(8);
	let selectedId = $state<string | null>(null);

	const entities = $derived(getCustomEntities({ lane }));

	const ctA = $derived(page.url.searchParams.get('ctA'));
	const ctB = $derived(page.url.searchParams.get('ctB'));

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	const LANES = ['main', 'agent:demo'];
	const SPECTRUM = [2, 5, 8];
</script>

<main class="mx-auto max-w-3xl space-y-6 p-6" data-testid="fractal-app" data-hydrated={hydrated}>
	<header class="flex items-start justify-between gap-4">
		<div class="space-y-1">
			<h1 class="carbon-section-title">Fractal wedge</h1>
			<p class="max-w-xl text-sm text-carbon-text-secondary">
				One identity, rendered at many <strong class="font-medium text-carbon-text">vantages</strong>
				(representation), observed in a chosen
				<strong class="font-medium text-carbon-text">lane</strong> (version). All shells read one live
				kernel — edit the card and watch the others move.
			</p>
		</div>
		<LiveIndicator connected={entities.connected} />
	</header>

	<section class="flex flex-wrap items-end gap-6 border-b border-carbon-border pb-4">
		<div class="space-y-1">
			<p class="carbon-label">Lane (version)</p>
			<ToggleGroup.Root type="single" bind:value={lane} class="carbon-toggle-group">
				{#each LANES as option (option)}
					<ToggleGroup.Item value={option} class="carbon-toggle-item">
						{option}
					</ToggleGroup.Item>
				{/each}
			</ToggleGroup.Root>
		</div>

		<div class="space-y-1">
			<p class="carbon-label">Thing (identity)</p>
			{#await entities then list}
				{@const items = list.map((f) => ({ value: f.id, label: f.title }))}
				<Select.Root
					type="single"
					{items}
					value={selectedId ?? list[0]?.id ?? ''}
					onValueChange={(value) => (selectedId = value)}
				>
					<Select.Trigger class="carbon-select-trigger min-w-[14rem]" aria-label="Select thing">
						<Select.Value placeholder="Select thing" />
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
			{/await}
		</div>

		<div class="min-w-[12rem] space-y-1">
			<p class="carbon-label">Vantage (representation): {vantage.toFixed(1)}</p>
			<Slider.Root
				type="single"
				bind:value={vantage}
				min={1}
				max={13}
				step={0.1}
				class="relative flex w-48 touch-none items-center select-none"
			>
				<span class="carbon-slider-track grow">
					<Slider.Range class="carbon-slider-range" />
				</span>
				<Slider.Thumb index={0} class="carbon-slider-thumb" />
			</Slider.Root>
		</div>
	</section>

	{#if await entities}
		{@const list = await entities}
		{@const effectiveId = selectedId ?? list[0]?.id ?? null}
		{#if effectiveId}
			<section class="space-y-3">
				<h2 class="carbon-label">Spectrum — same kernel, fixed vantages</h2>
				<div class="flex flex-wrap items-start gap-4">
					{#each SPECTRUM as v (v)}
						<Thing id={effectiveId} vantage={v} {lane} />
					{/each}
				</div>
			</section>

			<section class="space-y-3">
				<h2 class="carbon-label">Focus — vantage from slider, editable</h2>
				<Thing id={effectiveId} {vantage} {lane} editable />
			</section>
		{:else}
			<p class="text-sm text-carbon-text-secondary">No Things in <code>{lane}</code>.</p>
		{/if}
	{/if}

	{#if ctA && ctB}
		<section class="space-y-3 border-t border-dashed border-carbon-border pt-6">
			<h2 class="carbon-label">Cross-term — mixed lane × vantage (edit B, watch A)</h2>
			<div class="flex flex-wrap items-start gap-4">
				<Thing id={ctA} vantage={2} lane="main" />
				<Thing id={ctB} vantage={13} lane="agent:demo" editable />
			</div>
		</section>
	{/if}
</main>
