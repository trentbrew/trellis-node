<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { createRoom, toStore } from 'trellis/svelte';
	import {
		joinPresence,
		PersistentChannel,
		localStorageChannelStore
	} from 'trellis/realtime';
	import {
		CHAT_ROOM,
		RELAY_URL,
		makeIdentity,
		storageKey,
		timeFmt,
		createTypingTracker,
		formatTyping,
		formatOnline,
		type TypingPeer
	} from '../../shared';

	const me = makeIdentity('Svelte');

	const { room, presence, destroy } = createRoom(() =>
		joinPresence({
			peerId: me.peerId,
			room: CHAT_ROOM,
			initialPresence: { name: me.name, color: me.color },
			relayUrl: RELAY_URL
		})
	);

	const chat = PersistentChannel.create(room, 'chat', {
		store: localStorageChannelStore(storageKey('chat', CHAT_ROOM)),
		resolveMeta: (event) => {
			const peer = room.getPresence().find((p) => p.id === event.from);
			if (!peer) return undefined;
			return { name: peer.state.name, color: peer.state.color };
		}
	});
	const messages = toStore(chat.messages);
	const typingTracker = createTypingTracker(room, me);
	let typing = $state<TypingPeer[]>([]);
	const unsubTyping = typingTracker.subscribe((peers) => {
		typing = peers;
	});

	let draft = $state('');
	let logEl = $state<HTMLDivElement | null>(null);

	onDestroy(() => {
		unsubTyping();
		typingTracker.dispose();
		chat.dispose();
		destroy();
	});

	async function scrollToBottom() {
		await tick();
		if (logEl) logEl.scrollTop = logEl.scrollHeight;
	}

	$effect(() => {
		$messages;
		void scrollToBottom();
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const text = draft.trim();
		if (!text) return;
		draft = '';
		typingTracker.stop();
		chat.send({ text }, { name: me.name, color: me.color });
	}
</script>

<div class="app chat-layout">
	<header>
		<h1>Svelte · Chat</h1>
		<span class="count">{formatOnline($presence.length)}</span>
	</header>
	<p class="hint">
		Same room as React & Vue — <code>toStore(chat.messages)</code> drives the log.
	</p>
	<div class="chat-log" bind:this={logEl}>
		{#each $messages as msg (msg.id)}
			{@const name = (msg.meta?.name as string) ?? msg.from}
			{@const color = (msg.meta?.color as string) ?? '#6d5bfa'}
			{@const mine = msg.from === me.peerId}
			<div class="chat-msg" class:mine>
				<span class="chat-avatar" style:background={color}>{(name[0] ?? '?').toUpperCase()}</span>
				<div class="chat-body">
					<div class="chat-meta">
						<span style:color>{name}</span>
						<span>{timeFmt.format(msg.ts)}</span>
					</div>
					<span class="chat-bubble">{msg.payload.text}</span>
				</div>
			</div>
		{/each}
	</div>
	<p class="typing-indicator">{formatTyping(typing)}</p>
	<form class="chat-form" onsubmit={submit}>
		<input
			bind:value={draft}
			placeholder="Message the room…"
			oninput={() => {
				if (draft.trim()) typingTracker.ping();
				else typingTracker.stop();
			}}
		/>
		<button type="submit" disabled={!draft.trim()}>Send</button>
	</form>
</div>
