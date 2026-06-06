<script lang="ts">
	import { onDestroy } from 'svelte';
	import { createRoom } from 'trellis/svelte';
	import { joinPresence } from 'trellis/realtime';
	import {
		normalize,
		makeIdentity,
		OFFSCREEN,
		RELAY_URL,
		ROOM,
		type CursorPresence
	} from '../shared';

	const me = makeIdentity('Svelte');

	const { room, presence, others, destroy } = createRoom<CursorPresence>(() =>
		joinPresence<CursorPresence>({
			peerId: me.peerId,
			room: ROOM,
			initialPresence: { name: me.name, color: me.color, x: OFFSCREEN, y: OFFSCREEN },
			relayUrl: RELAY_URL
		})
	);
	onDestroy(destroy);

	function onMove(event: PointerEvent) {
		room.setPresence(normalize(event));
	}

	// Render everyone on-surface — self included — so your own cursor is visible.
	const visible = $derived($presence.filter((p) => p.state.x >= 0 && p.state.y >= 0));
	const otherCount = $derived($others.filter((p) => p.state.x >= 0).length);
</script>

<div class="app">
	<header>
		<h1>Svelte</h1>
		<span class="count">{otherCount} other cursor(s)</span>
	</header>
	<p class="hint">Same room as the React & Vue tabs — one BroadcastChannel mesh, three frameworks.</p>
	<div class="surface" onpointermove={onMove}>
		{#each visible as peer (peer.id)}
			<div
				class="cursor"
				class:self={peer.self}
				style:left="{peer.state.x * 100}%"
				style:top="{peer.state.y * 100}%"
				style:color={peer.state.color}
			>
				<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
					<path
						d="M2 2 L2 16 L6 12 L9 18 L11 17 L8 11 L14 11 Z"
						fill="currentColor"
						stroke="white"
						stroke-width="1"
					/>
				</svg>
				<span class="label" style:background={peer.state.color}
					>{peer.state.name}{peer.self ? ' (you)' : ''}</span
				>
			</div>
		{/each}
	</div>
</div>
