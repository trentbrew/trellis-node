<script lang="ts">
	import { getThing, updateFramework } from '../../routes/data.remote';
	import { submitWithoutReset } from '$lib/trellis/forms';
	import { resolveShell, vantageLabel } from './shells';

	interface Props {
		id: string;
		vantage: number;
		lane?: string;
		editable?: boolean;
	}

	let { id, vantage, lane = 'main', editable = false }: Props = $props();

	// The kernel: one live query keyed by (id, lane). Vantage never reaches the
	// server — it is purely a representation concern handled below in CSS.
	const thing = $derived(getThing({ id, lane }));
	const shell = $derived(resolveShell(vantage));
	const update = $derived(updateFramework.for(id));
</script>

<div
	class="thing"
	data-shell={shell}
	data-thing-id={id}
	data-lane={lane}
	style="--vantage: {vantage}"
>
	<header class="meta">
		<span class="pip" aria-hidden="true"></span>
		<span class="vantage">{vantage.toFixed(1)} · {vantageLabel(Math.round(vantage))}</span>
	</header>

	{#if await thing}
		{@const value = (await thing)!}
		<span class="name">{value.title}</span>
		<span class="slug">{value.slug ?? value.id}</span>
		<span class="lane-badge">{value.laneId}</span>

		{#if shell === 'card' && editable}
			<form {...update.enhance(submitWithoutReset)} class="edit">
				<input {...update.fields.id.as('hidden', value.id)} />
				<input
					{...update.fields.title.as('text', value.title)}
					class="edit-input"
					aria-label="Edit title"
				/>
				<button type="submit">Save</button>
			</form>
		{/if}
	{:else}
		<span class="missing">— not present in {lane} —</span>
	{/if}
</div>

<style>
	/* One generic shell. `data-shell` switches layout shape; `--vantage` morphs
	   individual properties continuously. Entity types would accent, not fork.
	   Literal colors here because scoped <style> is not processed by Tailwind. */
	.thing {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		border: 1px solid #e0e0e0;
		background: #ffffff;
		font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
	}

	.thing[data-shell='node'] {
		width: max-content;
		padding: 0.25rem 0.6rem;
		font-size: 0.75rem;
	}

	.thing[data-shell='row'] {
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
	}

	.thing[data-shell='card'] {
		flex-direction: column;
		align-items: flex-start;
		padding: 1rem;
		min-width: 14rem;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		order: -1;
	}

	/* Invariant property: the status pip is identical at every vantage. */
	.pip {
		width: 0.5rem;
		height: 0.5rem;
		background: #24a148;
		flex: none;
	}

	.vantage {
		font-size: 0.625rem;
		color: #6f6f6f;
		font-variant-numeric: tabular-nums;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
	}

	/* name: visible from vantage 2 up, invariant once shown. */
	.name {
		font-weight: 500;
		color: #161616;
	}
	.thing[data-shell='card'] .name {
		font-size: 1.125rem;
	}

	/* slug: fades in across the row→card boundary via --vantage curve. */
	.slug {
		font-size: 0.75rem;
		color: #525252;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		opacity: clamp(0, (var(--vantage) - 4) * 0.5, 1);
	}

	/* lane badge: the version axis, surfaced from row up. */
	.lane-badge {
		font-size: 0.625rem;
		padding: 0.05rem 0.4rem;
		background: #f4f4f4;
		color: #525252;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		opacity: clamp(0, (var(--vantage) - 4) * 0.5, 1);
	}

	.edit {
		display: flex;
		gap: 0.4rem;
		width: 100%;
		margin-top: 0.25rem;
		/* edit affordance appears only deep in the card territory. */
		opacity: clamp(0, (var(--vantage) - 8) * 1, 1);
	}
	.edit-input {
		flex: 1;
		border: 1px solid #e0e0e0;
		padding: 0.25rem 0.5rem;
		font-size: 0.875rem;
	}
	.edit button {
		border: 1px solid #0f62fe;
		background: #0f62fe;
		color: #ffffff;
		padding: 0.25rem 0.6rem;
		font-size: 0.875rem;
	}

	.pending,
	.missing {
		font-size: 0.75rem;
		color: #6f6f6f;
	}
</style>
