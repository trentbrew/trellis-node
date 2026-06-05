<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { page } from '$app/state';
	import { getPresence, heartbeatPresence, publishCursor } from '../presence.remote';
	import { identity } from '$lib/presence/identity.svelte';
	import { CURSOR_OFFSCREEN } from '$lib/schemas/presence';
	import LiveIndicator from '$lib/ui/LiveIndicator.svelte';

	const THROTTLE_MS = 33; // ~30fps cursor publishes
	const HEARTBEAT_MS = 10_000; // < server TTL (30s)

	const room = $derived(page.url.searchParams.get('room')?.trim() || 'lobby');
	const peerId = identity.peerId;

	// name/color in the key: editing your identity is one clean leave+rejoin.
	const presence = $derived(
		getPresence({ room, peerId, name: identity.name, color: identity.color })
	);

	// Local self-cursor: rendered instantly from the pointer, no round-trip.
	let self = $state<{ x: number; y: number } | null>(null);

	let surface = $state<HTMLElement | null>(null);
	const captureSurface: Attachment<HTMLElement> = (node) => {
		surface = node;
		return () => {
			surface = null;
		};
	};

	let lastSent = 0;
	let throttleTimer: ReturnType<typeof setTimeout> | null = null;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

	const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

	function send(x: number, y: number) {
		lastSent = Date.now();
		void publishCursor({ room, peerId, x, y });
	}

	function schedule(x: number, y: number) {
		const elapsed = Date.now() - lastSent;
		if (elapsed >= THROTTLE_MS) {
			if (throttleTimer) {
				clearTimeout(throttleTimer);
				throttleTimer = null;
			}
			send(x, y);
		} else {
			if (throttleTimer) clearTimeout(throttleTimer);
			throttleTimer = setTimeout(() => {
				throttleTimer = null;
				send(x, y);
			}, THROTTLE_MS - elapsed);
		}
	}

	function handlePointerMove(event: PointerEvent) {
		if (!surface) return;
		const rect = surface.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		const x = clamp01((event.clientX - rect.left) / rect.width);
		const y = clamp01((event.clientY - rect.top) / rect.height);
		self = { x, y };
		schedule(x, y);
	}

	function handlePointerLeave() {
		if (throttleTimer) {
			clearTimeout(throttleTimer);
			throttleTimer = null;
		}
		self = null;
		send(CURSOR_OFFSCREEN, CURSOR_OFFSCREEN);
	}

	onMount(() => {
		heartbeatTimer = setInterval(() => {
			void heartbeatPresence({ room, peerId });
		}, HEARTBEAT_MS);
	});

	onDestroy(() => {
		if (throttleTimer) clearTimeout(throttleTimer);
		if (heartbeatTimer) clearInterval(heartbeatTimer);
	});
</script>

<main class="mx-auto max-w-5xl space-y-4 p-6" data-testid="presence-app">
	<div class="flex items-start justify-between gap-4">
		<div class="space-y-1">
			<h1 class="carbon-section-title">Live cursors</h1>
			<p class="text-sm text-carbon-text-secondary">
				Room <code>{room}</code> · open this page in a second tab to see another cursor. Presence is ephemeral
				— nothing here is persisted.
			</p>
		</div>
		<LiveIndicator connected={presence.connected} />
	</div>

	<section
		{@attach captureSurface}
		role="application"
		aria-label="Shared cursor surface for room {room}"
		class="presence-surface"
		onpointermove={handlePointerMove}
		onpointerleave={handlePointerLeave}
	>
		{#each await presence as peer (peer.peerId)}
			{#if peer.peerId !== peerId && peer.payload.x >= 0 && peer.payload.y >= 0}
				<div
					class="cursor"
					style:left="{peer.payload.x * 100}%"
					style:top="{peer.payload.y * 100}%"
					style:color={peer.payload.color}
					data-testid="cursor-{peer.peerId}"
				>
					{@render pointer()}
					<span class="cursor-label" style:background={peer.payload.color}>
						{peer.payload.name || 'Guest'}
					</span>
				</div>
			{/if}
		{/each}

		{#if self}
			<div
				class="cursor cursor-self"
				style:left="{self.x * 100}%"
				style:top="{self.y * 100}%"
				style:color={identity.color}
				data-testid="cursor-self"
			>
				{@render pointer()}
				<span class="cursor-label" style:background={identity.color}>{identity.name} (you)</span>
			</div>
		{/if}
	</section>

	<p class="text-xs text-carbon-text-helper" data-testid="presence-count">
		{(await presence).filter((peer) => peer.payload.x >= 0).length} cursor(s) active · you are
		<span style:color={identity.color}>{identity.name}</span>
	</p>
</main>

{#snippet pointer()}
	<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
		<path
			d="M2 2 L2 16 L6 12 L9 18 L11 17 L8 11 L14 11 Z"
			fill="currentColor"
			stroke="white"
			stroke-width="1"
		/>
	</svg>
{/snippet}

<style>
	.presence-surface {
		position: relative;
		height: 60vh;
		min-height: 320px;
		overflow: hidden;
		border: 1px solid var(--cds-border-subtle, #393939);
		background:
			linear-gradient(var(--cds-border-subtle, #2622221a) 1px, transparent 1px) 0 0 / 24px 24px,
			linear-gradient(90deg, var(--cds-border-subtle, #2622221a) 1px, transparent 1px) 0 0 / 24px
				24px;
		cursor: none;
		touch-action: none;
	}

	.cursor {
		position: absolute;
		transform: translate(-2px, -2px);
		pointer-events: none;
		transition:
			left 60ms linear,
			top 60ms linear;
		will-change: left, top;
	}

	/* Self cursor follows the pointer locally, so no smoothing lag. */
	.cursor-self {
		transition: none;
	}

	.cursor-label {
		position: absolute;
		left: 16px;
		top: 12px;
		white-space: nowrap;
		border-radius: 2px;
		padding: 1px 6px;
		font-size: 11px;
		line-height: 1.4;
		color: #fff;
	}
</style>
