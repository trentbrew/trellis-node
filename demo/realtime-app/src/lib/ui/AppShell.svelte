<script lang="ts">
	import { browser } from '$app/environment';
	import { env } from '$env/dynamic/public';
	import type { Component } from 'svelte';
	import IdentityBadge from '$lib/ui/IdentityBadge.svelte';
	import OperatorInset from '$lib/ui/OperatorInset.svelte';
	import TrellisInspectorLoader from '$lib/ui/TrellisInspectorLoader.svelte';
	import {
		setAppShellContext,
		type AppSelection
	} from '$lib/ui/app-shell-context';

	let {
		children,
		selection: selectionProp = null
	}: {
		children: import('svelte').Snippet;
		selection?: AppSelection;
	} = $props();

	let GraphNav = $state<Component | null>(null);
	let selection = $state<AppSelection>(selectionProp);
	let insetOpen = $state(false);

	const useNativeInset =
		import.meta.env.DEV || env.PUBLIC_TRELLIS_NATIVE_INSET === 'true';
	// TRL-25: replace with ACL capability check
	const showInsetFab = import.meta.env.DEV;

	$effect(() => {
		selection = selectionProp;
	});

	setAppShellContext({
		get selection() {
			return selection;
		},
		setSelection(next) {
			selection = next;
			if (next) insetOpen = true;
		},
		get insetOpen() {
			return insetOpen;
		},
		toggleInset() {
			insetOpen = !insetOpen;
		}
	});

	$effect(() => {
		if (!browser) return;
		import('$lib/ui/GraphNav.svelte').then((m) => {
			GraphNav = m.default;
		});
	});
</script>

<div class="grid min-h-screen grid-cols-[220px_1fr] bg-carbon-bg">
	{#if GraphNav}
		<GraphNav />
	{:else}
		<aside
			class="flex h-full flex-col border-r border-white/10 bg-carbon-header px-3 py-4 text-white"
			aria-hidden="true"
		>
			<div class="mb-4 flex items-center gap-2 px-1 text-sm font-medium tracking-wide">
				<span class="h-2.5 w-2.5 rounded-full bg-violet-500"></span>
				Trellis · <span class="text-white/50">graph nav</span>
			</div>
			<p class="px-1 text-xs text-white/50">Loading…</p>
		</aside>
	{/if}
	<div class="relative flex min-h-screen min-w-0 flex-col">
		<header
			class="flex h-12 shrink-0 items-center justify-end gap-4 border-b border-black/20 bg-carbon-header px-4 text-white"
		>
			<IdentityBadge />
		</header>
		<main class="min-h-0 flex-1">
			{@render children()}
		</main>

		{#if useNativeInset}
			<OperatorInset bind:open={insetOpen} {selection} />
		{/if}

		{#if showInsetFab}
			<button
				type="button"
				class="fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-lg text-white shadow-lg hover:bg-violet-500"
				aria-label="Toggle operator inset"
				data-testid="inset-fab"
				onclick={() => {
					insetOpen = !insetOpen;
				}}
			>
				⚙
			</button>
		{/if}
	</div>
</div>

<TrellisInspectorLoader nativeInsetEnabled={useNativeInset} />
