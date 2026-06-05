<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import TrashCan from 'carbon-icons-svelte/lib/TrashCan.svelte';
	import type { Block } from '$lib/schemas/block';

	interface Props {
		block: Block;
		onedit: (text: string) => void;
		onremove: () => void;
	}

	let { block, onedit, onremove }: Props = $props();

	const DEBOUNCE_MS = 350;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function autosize(node: HTMLTextAreaElement) {
		node.style.height = 'auto';
		node.style.height = `${node.scrollHeight}px`;
	}

	/**
	 * Reconcile server → DOM, but ONLY when this textarea isn't focused. The
	 * person typing here keeps their text (their next flush wins = LWW for this
	 * block); everyone else's blocks update live. Re-runs whenever block.text
	 * changes because it reads it as a dependency.
	 */
	const reconcile: Attachment<HTMLTextAreaElement> = (node) => {
		const incoming = block.text;
		if (document.activeElement !== node) {
			node.value = incoming;
			autosize(node);
		}
	};

	function flush(text: string) {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		onedit(text);
	}

	function handleInput(event: Event & { currentTarget: HTMLTextAreaElement }) {
		autosize(event.currentTarget);
		const text = event.currentTarget.value;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			onedit(text);
		}, DEBOUNCE_MS);
	}

	function handleBlur(event: FocusEvent & { currentTarget: HTMLTextAreaElement }) {
		flush(event.currentTarget.value);
	}
</script>

<div class="group flex items-start gap-2" data-testid="block-row-{block.id}">
	<textarea
		{@attach reconcile}
		class="carbon-input min-h-[2.5rem] flex-1 resize-none overflow-hidden"
		rows="1"
		oninput={handleInput}
		onblur={handleBlur}
		placeholder="Write a block…"
		data-testid="block-input-{block.id}"
	></textarea>
	<div class="flex w-24 shrink-0 flex-col items-end gap-1 pt-2">
		<button
			type="button"
			class="text-carbon-danger opacity-0 transition-opacity group-hover:opacity-100 hover:text-carbon-danger-hover"
			onclick={onremove}
			aria-label="Delete block"
		>
			<TrashCan size={16} />
		</button>
		{#if block.editedBy}
			<span
				class="max-w-full truncate text-[10px] text-carbon-text-helper"
				style:color={block.editedColor}
				title="Last edited by {block.editedBy}"
			>
				{block.editedBy}
			</span>
		{/if}
	</div>
</div>
