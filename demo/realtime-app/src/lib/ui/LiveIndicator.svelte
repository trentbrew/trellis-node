<script lang="ts">
	import DotMark from 'carbon-icons-svelte/lib/DotMark.svelte';
	import Renew from 'carbon-icons-svelte/lib/Renew.svelte';

	interface Props {
		connected: boolean;
	}

	let { connected }: Props = $props();
</script>

<p class="inline-flex items-center gap-1 text-xs text-carbon-text-secondary" aria-live="polite">
	{#if connected}
		<DotMark size={16} class="text-carbon-success" aria-hidden="true" />
		<span>live</span>
	{:else}
		<Renew size={16} class="animate-spin text-carbon-warning-text" aria-hidden="true" />
		<span>reconnecting…</span>
	{/if}
</p>
