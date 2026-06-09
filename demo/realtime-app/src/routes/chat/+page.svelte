<script lang="ts">
	import { tick } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { page } from '$app/state';
	import SendAlt from 'carbon-icons-svelte/lib/SendAlt.svelte';
	import { createRoom } from 'trellis/svelte';
	import { joinPresence } from 'trellis/realtime';
	import { createTypingTracker, formatTyping, type TypingPeer } from '$lib/chat/typing';
	import { getMessages, sendMessage } from '../chat.remote';
	import { identity } from '$lib/presence/identity.svelte';
	import LiveIndicator from '$lib/ui/LiveIndicator.svelte';

	const RELAY_URL = import.meta.env.VITE_PRESENCE_RELAY_URL as string | undefined;

	const room = $derived(page.url.searchParams.get('room')?.trim() || 'lobby');
	const messages = $derived(getMessages({ room }));

	let draft = $state('');
	let sending = $state(false);
	let scroller = $state<HTMLElement | null>(null);
	let typing = $state<TypingPeer[]>([]);
	let typingTracker: ReturnType<typeof createTypingTracker> | null = null;

	const captureScroller: Attachment<HTMLElement> = (node) => {
		scroller = node;
	};

	const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

	async function scrollToBottom() {
		await tick();
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	}

	$effect(() => {
		const roomKey = room;
		const { peerId, name, color } = identity;

		const handle = createRoom(() =>
			joinPresence({
				peerId,
				room: roomKey,
				initialPresence: { name, color },
				relayUrl: RELAY_URL
			})
		);

		const tracker = createTypingTracker(handle.room, { peerId, name, color });
		typingTracker = tracker;
		const unsub = tracker.subscribe((peers) => {
			typing = peers;
		});

		return () => {
			unsub();
			tracker.dispose();
			handle.destroy();
			typingTracker = null;
			typing = [];
		};
	});

	$effect(() => {
		const stream = messages;
		void (async () => {
			await stream;
			await scrollToBottom();
		})();
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const text = draft.trim();
		if (!text || sending) return;
		sending = true;
		draft = '';
		typingTracker?.stop();
		try {
			await sendMessage({ room, author: identity.name, color: identity.color, text });
		} finally {
			sending = false;
		}
	}
</script>

<main class="mx-auto flex h-[calc(100vh-3rem)] max-w-2xl flex-col gap-3 p-6" data-testid="chat-app">
	<div class="flex items-start justify-between gap-4">
		<div class="space-y-1">
			<h1 class="carbon-section-title">Chat room</h1>
			<p class="text-sm text-carbon-text-secondary">
				Room <code>{room}</code> · durable & ordered. Messages persist in the graph and stream to every
				open tab.
			</p>
		</div>
		<LiveIndicator connected={messages.connected} />
	</div>

	<ul
		{@attach captureScroller}
		class="bg-carbon-panel min-h-0 flex-1 space-y-3 overflow-y-auto border border-carbon-border p-4"
		data-testid="chat-log"
	>
		{#each await messages as message (message.id)}
			{@const mine = message.author === identity.name}
			<li class="flex gap-2" class:flex-row-reverse={mine} data-testid="chat-message">
				<span
					class="mt-0.5 inline-block h-6 w-6 shrink-0 rounded-full text-center text-xs leading-6 text-white"
					style:background={message.color}
					aria-hidden="true"
				>
					{(message.author[0] ?? '?').toUpperCase()}
				</span>
				<div class="max-w-[75%] min-w-0 space-y-0.5" class:text-right={mine}>
					<div
						class="flex items-baseline gap-2 text-xs text-carbon-text-helper"
						class:flex-row-reverse={mine}
					>
						<span class="font-medium" style:color={message.color}>{message.author}</span>
						<span>{timeFmt.format(message.createdAt)}</span>
					</div>
					<p
						class="inline-block border border-carbon-border bg-carbon-bg px-3 py-1.5 text-sm break-words whitespace-pre-wrap"
					>
						{message.text}
					</p>
				</div>
			</li>
		{:else}
			<li class="text-sm text-carbon-text-secondary">No messages yet — say hello.</li>
		{/each}
	</ul>

	<p
		class="min-h-5 text-sm text-carbon-text-helper"
		data-testid="typing-indicator"
		aria-live="polite"
	>
		{formatTyping(typing)}
	</p>

	<form class="flex gap-2" onsubmit={submit}>
		<label class="sr-only" for="chat-input">Message</label>
		<input
			id="chat-input"
			class="carbon-input flex-1"
			bind:value={draft}
			placeholder="Message {room}…"
			autocomplete="off"
			maxlength="2000"
			oninput={() => {
				if (draft.trim()) typingTracker?.ping();
				else typingTracker?.stop();
			}}
		/>
		<button type="submit" class="carbon-btn-primary" disabled={sending || !draft.trim()}>
			<SendAlt size={16} />
			Send
		</button>
	</form>
</main>
