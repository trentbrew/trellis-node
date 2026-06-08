<script lang="ts">
	import { onDestroy } from 'svelte';
	import { createRoom } from 'trellis/svelte';
	import { joinPresence, RealtimeText } from 'trellis/realtime';
	import {
		TEXT_ROOM,
		RELAY_URL,
		makeIdentity,
		textDiff,
		codePointLen,
		measureCaret,
		applyRemoteTextareaValue,
		scheduleCaretSync,
		hideTextCaret,
		syncTextCaretPresence,
		isTextEditorActive,
		bindTextCaretWindowHide,
		formatOnline,
		isRemoteCaretVisible,
		type TextPresence
	} from '../../shared';

	const me = makeIdentity('Svelte');

	const { room, presence, destroy } = createRoom<TextPresence>(() =>
		joinPresence<TextPresence>({
			peerId: me.peerId,
			room: TEXT_ROOM,
			initialPresence: { name: me.name, color: me.color, caret: -1 },
			relayUrl: RELAY_URL
		})
	);

	const doc = new RealtimeText({ peerId: room.selfId, room });
	let charCount = $state(0);
	let last = '';
	let applying = false;
	let taEl = $state<HTMLTextAreaElement | null>(null);
	let remoteCarets = $state<
		{ id: string; name: string; color: string; top: number; left: number }[]
	>([]);

	function syncCaret() {
		if (!taEl) return;
		syncTextCaretPresence(room, taEl);
	}

	function scheduleSyncCaret() {
		scheduleCaretSync(syncCaret);
	}

	function measureRemotes() {
		if (!taEl) return;
		remoteCarets = $presence
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

	const unsub = doc.onChange((next) => {
		if (next === last) return;
		if (applying) {
			last = next;
			charCount = codePointLen(next);
			return;
		}
		applying = true;
		if (taEl) applyRemoteTextareaValue(taEl, next, last);
		last = next;
		charCount = codePointLen(next);
		applying = false;
		const ta = taEl;
		if (ta && isTextEditorActive(ta)) scheduleSyncCaret();
		measureRemotes();
	});

	const unbindWindow = bindTextCaretWindowHide(room, () => taEl);

	$effect(() => {
		if (taEl) {
			const initial = doc.toString();
			if (initial && !taEl.value) {
				taEl.value = initial;
				last = initial;
				charCount = codePointLen(initial);
			}
		}
	});

	$effect(() => {
		charCount;
		$presence;
		measureRemotes();
		const tick = setInterval(measureRemotes, 500);
		return () => clearInterval(tick);
	});

	onDestroy(() => {
		unbindWindow();
		unsub();
		doc.dispose();
		destroy();
	});

	function onInput(event: Event) {
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

<div class="app">
	<header>
		<h1>Svelte · Text</h1>
		<span class="count">{formatOnline($presence.length)} · {charCount} chars</span>
	</header>
	<p class="hint">Uncontrolled textarea — remote carets via presence + mirror measure.</p>
	<div class="text-editor-wrap">
		<div class="text-caret-layer" aria-hidden="true">
			{#each remoteCarets as c (c.id)}
				<div
					class="text-remote-caret"
					style:top="{c.top}px"
					style:left="{c.left}px"
					style:background={c.color}
				>
					<span class="caret-label" style:background={c.color}>{c.name}</span>
				</div>
			{/each}
		</div>
		<textarea
			class="text-editor"
			bind:this={taEl}
			spellcheck="false"
			oninput={onInput}
			onfocus={scheduleSyncCaret}
			onselect={scheduleSyncCaret}
			onkeydown={scheduleSyncCaret}
			onkeyup={scheduleSyncCaret}
			onclick={scheduleSyncCaret}
			onmouseup={scheduleSyncCaret}
			onblur={() => hideTextCaret(room)}
			placeholder="Start typing — edits sync across editors…"
		></textarea>
	</div>
	<div class="text-foot">
		<span>{me.name} (you)</span>
		<span>room: {TEXT_ROOM}</span>
	</div>
</div>
