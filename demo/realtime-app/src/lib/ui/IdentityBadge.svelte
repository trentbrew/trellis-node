<script lang="ts">
	import { onMount } from 'svelte';
	import { COLOR_CHOICES, identity } from '$lib/presence/identity.svelte';

	let mounted = $state(false);
	let open = $state(false);
	let draft = $state('');

	onMount(() => {
		mounted = true;
	});

	function toggle() {
		open = !open;
		if (open) draft = identity.name;
	}

	function close() {
		open = false;
	}

	// Commit on blur/Enter, not per keystroke — name is in the presence join key,
	// so committing once avoids a resubscribe on every character.
	function commitName() {
		identity.setName(draft);
		draft = identity.name;
	}

	function handleNameKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		if (event.key === 'Enter') {
			event.preventDefault();
			event.currentTarget.blur();
		}
	}
</script>

{#if mounted}
	<div class="relative">
		<button
			type="button"
			class="flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-white/10"
			onclick={toggle}
			aria-haspopup="dialog"
			aria-expanded={open}
		>
			<span
				class="inline-block h-3 w-3 rounded-full ring-1 ring-white/30"
				style:background={identity.color}
			></span>
			<span class="max-w-[10rem] truncate">{identity.name}</span>
		</button>

		{#if open}
			<!-- backdrop closes the panel on outside click -->
			<button
				type="button"
				class="fixed inset-0 z-10 cursor-default"
				aria-label="Close identity editor"
				onclick={close}
			></button>

			<div
				class="bg-carbon-panel absolute right-0 z-20 mt-1 w-64 space-y-3 border border-carbon-border p-3 text-carbon-text shadow-lg"
				role="dialog"
				aria-label="Edit your identity"
			>
				<div class="space-y-1">
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label class="carbon-label">Display name</label>
					<input
						class="carbon-input w-full"
						bind:value={draft}
						maxlength="40"
						onblur={commitName}
						onkeydown={handleNameKeydown}
						placeholder="Your name"
					/>
				</div>

				<div class="space-y-1">
					<span class="carbon-label">Color</span>
					<div class="flex flex-wrap gap-1.5">
						{#each COLOR_CHOICES as choice (choice)}
							<button
								type="button"
								class="h-6 w-6 rounded-full ring-1 ring-carbon-border transition-transform hover:scale-110"
								class:ring-2={identity.color === choice}
								style:background={choice}
								style:outline={identity.color === choice ? '2px solid var(--cds-focus, #fff)' : ''}
								style:outline-offset="1px"
								aria-label="Use color {choice}"
								aria-pressed={identity.color === choice}
								onclick={() => identity.setColor(choice)}
							></button>
						{/each}
						<label
							class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full ring-1 ring-carbon-border"
							title="Custom color"
						>
							<span aria-hidden="true" class="text-xs">+</span>
							<input
								type="color"
								class="sr-only"
								value={identity.color}
								oninput={(event) => identity.setColor(event.currentTarget.value)}
							/>
						</label>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}
