<script lang="ts">
	import { variantConfig, type PageVariant } from '$lib/ui/page-variants';

	let {
		variant,
		title,
		hideHeader = false,
		hideToolbar = false,
		header,
		toolbar,
		actions,
		children
	}: {
		variant: PageVariant;
		title?: string;
		hideHeader?: boolean;
		hideToolbar?: boolean;
		header?: import('svelte').Snippet;
		toolbar?: import('svelte').Snippet;
		actions?: import('svelte').Snippet;
		children: import('svelte').Snippet;
	} = $props();

	const config = $derived(variantConfig(variant));
	const showHeader = $derived(!hideHeader && config.showHeader && (title || header));
	const showToolbar = $derived(!hideToolbar && config.showToolbar);
</script>

<main
	class="space-y-6 {config.contentPadding} {config.maxWidth} {config.fillHeight
		? 'flex min-h-0 flex-1 flex-col'
		: ''}"
	data-testid="collection-records"
	data-page-variant={variant}
>
	{#if showHeader || actions}
		<header class="flex items-start justify-between gap-4">
			<div class="min-w-0 flex-1 space-y-2">
				{#if header}
					{@render header()}
				{:else if title}
					<h1 class="carbon-section-title">{title}</h1>
				{/if}
			</div>
			{#if actions}
				<div class="shrink-0">
					{@render actions()}
				</div>
			{/if}
		</header>
	{/if}

	{#if showToolbar && toolbar}
		<div class="collection-page-toolbar" data-testid="collection-page-toolbar">
			{@render toolbar()}
		</div>
	{/if}

	<div class={config.fillHeight ? 'min-h-0 flex-1 space-y-6' : 'space-y-6'}>
		{@render children()}
	</div>
</main>

<style>
	.collection-page-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding-bottom: 0.25rem;
		border-bottom: 1px solid var(--carbon-border, rgb(57 57 57 / 1));
	}
</style>
