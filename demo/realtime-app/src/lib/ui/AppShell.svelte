<script lang="ts">
	import { browser } from '$app/environment';
	import type { Component } from 'svelte';
	import IdentityBadge from '$lib/ui/IdentityBadge.svelte';
	import TrellisInspectorLoader from '$lib/ui/TrellisInspectorLoader.svelte';

	let { children } = $props();
	let GraphNav = $state<Component | null>(null);

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
	<div class="flex min-h-screen min-w-0 flex-col">
		<header class="flex h-12 shrink-0 items-center justify-end gap-4 border-b border-black/20 bg-carbon-header px-4 text-white">
			<IdentityBadge />
		</header>
		<main class="min-h-0 flex-1">
			{@render children()}
		</main>
	</div>
</div>

<TrellisInspectorLoader />
