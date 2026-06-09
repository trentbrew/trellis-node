<script lang="ts">
	import { onDestroy } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { createRoom, type RoomHandle } from 'trellis/svelte';
	import { joinPresence, RealtimeText, type PresencePeer } from 'trellis/realtime';
	import {
		applyRemoteTextareaValue,
		bindTextCaretWindowHide,
		codePointLen,
		hideTextCaret,
		isTextEditorActive,
		measureCaret,
		scheduleCaretSync,
		syncTextCaretPresence,
		textDiff
	} from '$lib/collab/text';
	import { identity } from '$lib/presence/identity.svelte';
	import { isRemoteCaretVisible, type TextPresence } from '$lib/schemas/presence';
	import LiveIndicator from '$lib/ui/LiveIndicator.svelte';

	const RELAY_URL = import.meta.env.VITE_PRESENCE_RELAY_URL as string | undefined;
	const peerId = identity.peerId;

	let displayRoomKey = $state('draft');
	let charCount = $state(0);
	let last = '';
	let applying = false;
	let taEl = $state<HTMLTextAreaElement | null>(null);
	let connected = $state(false);
	let peers = $state<PresencePeer<TextPresence>[]>([]);
	let remoteCarets = $state<
		{ id: string; name: string; color: string; top: number; left: number }[]
	>([]);

	let current: RoomHandle<TextPresence> | null = null;
	let doc: RealtimeText | null = null;
	let docUnsub: (() => void) | null = null;
	let windowUnbind: (() => void) | null = null;
	let presenceUnsub: (() => void) | null = null;
	let sessionKey = '';
	let sessionIdentity = '';

	function readRoomKey(): string {
		return page.url.searchParams.get('room')?.trim() || 'draft';
	}

	function measureRemotes() {
		if (!taEl) return;
		remoteCarets = peers
			.filter((p) => !p.self && isRemoteCaretVisible(p.state))
			.map((p) => {
				const pos = measureCaret(taEl!, p.state.caret);
				if (!pos) return null;
				return {
					id: p.id,
					name: p.state.name,
					color: p.state.color,
					top: pos.top,
					left: pos.left
				};
			})
			.filter((c): c is NonNullable<typeof c> => c !== null);
	}

	function syncCaret() {
		if (!current || !taEl) return;
		syncTextCaretPresence(current.room, taEl);
	}

	function scheduleSyncCaret() {
		scheduleCaretSync(syncCaret);
	}

	function seedTextarea() {
		if (!taEl || !doc) return;
		const initial = doc.toString();
		if (initial && !taEl.value) {
			taEl.value = initial;
			last = initial;
			charCount = codePointLen(initial);
		}
	}

	function stopSession() {
		presenceUnsub?.();
		presenceUnsub = null;
		docUnsub?.();
		docUnsub = null;
		windowUnbind?.();
		windowUnbind = null;
		doc?.dispose();
		doc = null;
		current?.destroy();
		current = null;
		connected = false;
		peers = [];
		last = '';
		charCount = 0;
	}

	function startSession(key: string) {
		stopSession();

		sessionKey = key;
		displayRoomKey = key;
		sessionIdentity = `${identity.name}\0${identity.color}`;

		const handle = createRoom<TextPresence>(() =>
			joinPresence<TextPresence>({
				peerId,
				room: key,
				initialPresence: {
					name: identity.name,
					color: identity.color,
					caret: -1
				},
				relayUrl: RELAY_URL
			})
		);
		current = handle;
		const text = new RealtimeText({ peerId: handle.room.selfId, room: handle.room });
		doc = text;
		connected = true;

		docUnsub = text.onChange((next) => {
			if (next === last) return;
			if (applying) {
				last = next;
				charCount = codePointLen(next);
				return;
			}
			applying = true;
			const ta = taEl;
			if (ta) applyRemoteTextareaValue(ta, next, last);
			last = next;
			charCount = codePointLen(next);
			applying = false;
			if (ta && isTextEditorActive(ta)) scheduleSyncCaret();
			measureRemotes();
		});

		windowUnbind = bindTextCaretWindowHide(handle.room, () => taEl);
		presenceUnsub = handle.presence.subscribe((next) => {
			peers = next;
			measureRemotes();
		});

		queueMicrotask(seedTextarea);
	}

	function ensureSession() {
		const key = readRoomKey();
		const id = `${identity.name}\0${identity.color}`;
		if (key === sessionKey && id === sessionIdentity && current) return;
		startSession(key);
	}

	afterNavigate(() => {
		ensureSession();
	});

	$effect(() => {
		if (!taEl) return;
		seedTextarea();
	});

	$effect(() => {
		peers;
		if (!taEl) return;
		measureRemotes();
		const tick = setInterval(measureRemotes, 500);
		return () => clearInterval(tick);
	});

	onDestroy(() => {
		stopSession();
	});

	function onInput(event: Event) {
		if (!doc) return;
		const ta = event.target as HTMLTextAreaElement;
		const next = ta.value;
		applying = true;
		const d = textDiff(last, next);
		if (d.removed > 0) doc.delete(d.index, d.removed);
		if (d.inserted) doc.insert(d.index, d.inserted);
		last = doc.toString();
		charCount = codePointLen(last);
		applying = false;
		scheduleSyncCaret();
	}
</script>

<main class="mx-auto max-w-3xl space-y-4 p-6" data-testid="collab-app">
	<header class="flex items-start justify-between gap-4">
		<div class="space-y-1">
			<h1 class="carbon-section-title">Collab text</h1>
			<p class="text-sm text-carbon-text-secondary">
				<code>RealtimeText</code> CRDT · room <code>{displayRoomKey}</code>
				{#if RELAY_URL}
					· relay <code>{RELAY_URL}</code>
				{:else}
					· BroadcastChannel (cross-tab)
				{/if}
			</p>
		</div>
		<LiveIndicator {connected} />
	</header>

	<div class="collab-editor-wrap">
		<div class="collab-caret-layer" aria-hidden="true">
			{#each remoteCarets as c (c.id)}
				<div
					class="collab-remote-caret"
					style:top="{c.top}px"
					style:left="{c.left}px"
					style:background={c.color}
				>
					<span class="collab-caret-label" style:background={c.color}>{c.name}</span>
				</div>
			{/each}
		</div>
		<textarea
			class="collab-editor carbon-text-input font-mono"
			bind:this={taEl}
			spellcheck="false"
			data-testid="collab-editor"
			placeholder="Start typing — edits sync across tabs and browsers (with relay)…"
			oninput={onInput}
			onfocus={scheduleSyncCaret}
			onselect={scheduleSyncCaret}
			onkeydown={scheduleSyncCaret}
			onkeyup={scheduleSyncCaret}
			onclick={scheduleSyncCaret}
			onmouseup={scheduleSyncCaret}
			onblur={() => current && hideTextCaret(current.room)}
		></textarea>
	</div>

	<footer class="flex justify-between text-xs text-carbon-text-secondary">
		<span>{identity.name} · {charCount} chars</span>
		<span>{peers.length} online</span>
	</footer>
</main>
