<script lang="ts">
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';

	/**
	 * L3 operator inset — drop-in Trellis DB inspector (Vue CE) as a floating FAB.
	 * Loads same-origin via Vite proxy (`/__trellis/inspector.js` → sidecar :3920).
	 *
	 * Enable in prod with PUBLIC_TRELLIS_INSPECTOR=true.
	 */
	const enabled =
		import.meta.env.DEV || env.PUBLIC_TRELLIS_INSPECTOR === 'true';

	onMount(() => {
		if (!enabled) return;
		if (document.querySelector('script[data-trellis-inspector]')) return;

		const script = document.createElement('script');
		script.src = '/__trellis/inspector.js';
		script.defer = true;
		script.dataset.trellisInspector = '';
		script.dataset.clientUrl = window.location.origin;
		document.body.appendChild(script);
	});
</script>
