<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import IdentityBadge from '$lib/ui/IdentityBadge.svelte';

	let { children } = $props();

	const links = [
		{ href: resolve('/'), label: 'Frameworks' },
		{ href: resolve('/fractal'), label: 'Fractal' },
		{ href: resolve('/presence'), label: 'Cursors' },
		{ href: resolve('/chat'), label: 'Chat' },
		{ href: resolve('/editor'), label: 'Editor' }
	];

	function isActive(href: string) {
		const path = page.url.pathname;
		if (href === resolve('/')) return path === '/';
		return path.startsWith(href);
	}
</script>

<div class="min-h-screen bg-carbon-bg">
	<header class="bg-carbon-header text-white">
		<div class="mx-auto flex h-12 max-w-5xl items-center justify-between gap-4 px-4">
			<span class="shrink-0 text-sm font-medium tracking-wide">Trellis · live graph</span>
			<nav class="flex items-center gap-1 overflow-x-auto text-sm">
				{#each links as link (link.href)}
					<a
						href={link.href}
						class="px-3 py-2 whitespace-nowrap transition-colors hover:bg-white/10 {isActive(
							link.href
						)
							? 'bg-white/15'
							: ''}"
						aria-current={isActive(link.href) ? 'page' : undefined}
					>
						{link.label}
					</a>
				{/each}
			</nav>
			<div class="shrink-0">
				<IdentityBadge />
			</div>
		</div>
	</header>
	{@render children()}
</div>
