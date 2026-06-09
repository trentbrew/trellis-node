<script lang="ts">
	import IdentityBadge from '$lib/ui/IdentityBadge.svelte';
	import GraphNav from '$lib/ui/GraphNav.svelte';

	let { children } = $props();
</script>

<div class="grid min-h-screen grid-cols-[220px_1fr] bg-carbon-bg">
	<GraphNav />
	<div class="flex min-h-screen min-w-0 flex-col">
		<header class="flex h-12 shrink-0 items-center justify-end gap-4 border-b border-black/20 bg-carbon-header px-4 text-white">
			<IdentityBadge />
		</header>
		<main class="min-h-0 flex-1">
			{@render children()}
		</main>
	</div>
</div>
