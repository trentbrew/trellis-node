<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Toggle } from 'bits-ui';
	import Add from 'carbon-icons-svelte/lib/Add.svelte';
	import TrashCan from 'carbon-icons-svelte/lib/TrashCan.svelte';
	import Save from 'carbon-icons-svelte/lib/Save.svelte';
	import {
		getFrameworks,
		addFramework,
		removeFramework,
		updateFramework,
		promoteLaneDrafts,
		discardLaneDrafts,
		toggleFrameworkTag
	} from './data.remote';
	import { getPlatformStatus } from './platform.remote';
	import { addTag, getTags, removeTag } from './tags.remote';
	import { remoteFormAction, submitWithoutReset } from '$lib/trellis/forms';
	import { MAIN_LANE, normalizeLaneId } from '$lib/trellis/lane';
	import LiveIndicator from '$lib/ui/LiveIndicator.svelte';
	import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
	import LaneSelect from '$lib/ui/LaneSelect.svelte';

	const lane = $derived(normalizeLaneId(page.url.searchParams.get('lane')));
	const isDraftLane = $derived(lane !== MAIN_LANE);
	const frameworks = $derived(getFrameworks({ lane }));
	const tagList = getTags();
	const status = getPlatformStatus();
	let hydrated = $state(false);

	onMount(() => {
		hydrated = true;
	});
</script>

<main
	class="mx-auto max-w-lg space-y-6 p-6"
	data-testid="frameworks-app"
	data-hydrated={hydrated ? 'true' : 'false'}
>
	<div class="flex items-start justify-between gap-4">
		<div class="space-y-3">
			<h1 class="carbon-section-title">Frameworks</h1>
			<div class="space-y-1">
				<p class="carbon-label">Lane</p>
				<LaneSelect {lane} />
			</div>
		</div>
		<LiveIndicator connected={frameworks.connected} />
	</div>

	{#if isDraftLane}
		<div
			class="flex flex-wrap items-center gap-2 border border-carbon-warning-border bg-carbon-warning-bg px-3 py-2 text-sm text-carbon-warning-text"
		>
			<span>Draft lane (journal): <code>{lane}</code></span>
			<ConfirmDialog
				title="Promote lane drafts"
				description="Merge all draft changes in {lane} into main. This cannot be undone from the UI."
				triggerLabel="Promote"
				confirmLabel="Promote"
				onConfirm={() => promoteLaneDrafts({ lane })}
			/>
			<ConfirmDialog
				title="Discard lane drafts"
				description="Permanently discard all draft changes in {lane}."
				triggerLabel="Discard"
				confirmLabel="Discard"
				variant="danger"
				onConfirm={() => discardLaneDrafts({ lane })}
			/>
			<a class="carbon-btn-ghost px-2" href={resolve('/')}>View main</a>
		</div>
	{/if}

	<form {...addFramework} action={remoteFormAction(addFramework)} class="flex gap-2">
		<input {...addFramework.fields.lane.as('hidden', lane)} />
		<label class="sr-only" for="add-framework">Framework name</label>
		<input
			{...addFramework.fields.title.as('text')}
			id="add-framework"
			placeholder="Add a framework…"
			class="carbon-input"
		/>
		<button type="submit" class="carbon-btn-primary">
			<Add size={16} />
			Add
		</button>
	</form>

	<ul class="space-y-2">
		{#each await frameworks as framework (framework.id)}
			{@const remove = removeFramework.for(framework.id)}
			{@const update = updateFramework.for(framework.id)}
			<li class="carbon-panel flex flex-col gap-2 p-3">
				<div class="flex items-center gap-2">
					<form
						{...update.enhance(submitWithoutReset)}
						action={remoteFormAction(update)}
						class="flex flex-1 gap-2"
					>
						<input {...update.fields.id.as('hidden', framework.id)} />
						<input
							{...update.fields.title.as('text', framework.title)}
							class="carbon-input"
						/>
						<button type="submit" class="carbon-btn-secondary">
							<Save size={16} />
							Save
						</button>
					</form>

					<form {...remove} action={remoteFormAction(remove)}>
						<input {...remove.fields.id.as('hidden', framework.id)} />
						<button type="submit" class="carbon-btn-danger" aria-label="Remove {framework.title}">
							<TrashCan size={16} />
						</button>
					</form>
				</div>

				<p class="text-xs text-carbon-text-helper" data-testid="framework-computed-{framework.id}">
					{#if framework.titleLength != null}
						<span data-testid="framework-title-length-{framework.id}">
							{framework.titleLength} chars · kernel formula
						</span>
					{/if}
					{#if framework.titleLength != null && framework.tagCount > 0}
						<span aria-hidden="true"> · </span>
					{/if}
					<span data-testid="framework-tag-count-{framework.id}">
						{framework.tagCount} tag{framework.tagCount === 1 ? '' : 's'} · kernel rollup
					</span>
				</p>

				{#await tagList then tags}
					{#if tags.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each tags as tag (tag.id)}
								{@const assigned = framework.tags.some((item) => item.id === tag.id)}
								<Toggle.Root
									pressed={assigned}
									class="carbon-tag-toggle"
									data-testid="framework-tag-{framework.id}-{tag.id}"
									onPressedChange={(pressed) =>
										toggleFrameworkTag({
											frameworkId: framework.id,
											tagId: tag.id,
											assign: pressed
										})}
								>
									{tag.name}
								</Toggle.Root>
							{/each}
						</div>
					{/if}
				{/await}
			</li>
		{:else}
			<li class="text-sm text-carbon-text-secondary">No frameworks yet.</li>
		{/each}
	</ul>

	<section class="space-y-3 border-t border-carbon-border pt-6">
		<div class="flex items-center justify-between gap-4">
			<h2 class="carbon-section-title">Tags</h2>
			<LiveIndicator connected={tagList.connected} />
		</div>

		<form {...addTag} action={remoteFormAction(addTag)} class="flex gap-2">
			<label class="sr-only" for="add-tag">Tag name</label>
			<input
				{...addTag.fields.name.as('text')}
				id="add-tag"
				placeholder="Add a tag…"
				class="carbon-input"
			/>
			<button type="submit" class="carbon-btn-primary">
				<Add size={16} />
				Add
			</button>
		</form>

		<ul class="flex flex-wrap gap-2">
			{#each await tagList as tag (tag.id)}
				{@const remove = removeTag.for(tag.id)}
				<li class="flex items-center gap-1 border border-carbon-border px-3 py-1 text-sm">
					<span>{tag.name}</span>
					<form {...remove} action={remoteFormAction(remove)}>
						<input {...remove.fields.id.as('hidden', tag.id)} />
						<button
							type="submit"
							class="text-carbon-danger hover:text-carbon-danger-hover"
							aria-label="Remove {tag.name}"
						>
							<TrashCan size={14} />
						</button>
					</form>
				</li>
			{:else}
				<li class="text-sm text-carbon-text-secondary">No tags yet.</li>
			{/each}
		</ul>
	</section>

	<p class="text-xs text-carbon-text-helper" data-testid="platform-status">
		{#await status}
			Checking platform…
		{:then value}
			{#if value.configured && value.trellis}
				Trellis connected · {value.mainFrameworks} main / {value.totalFrameworks} total · {value.tags}
				tags
				{#if value.vcs && value.vcsLane}
					· VCS lane {value.vcsLane.appLane}: {value.vcsLane.laneOpCount} op(s)
				{:else if value.vcs}
					· VCS ready
				{/if}
			{:else if value.configured}
				Trellis sidecar unreachable — run `pnpm dev:all`
			{:else}
				Trellis not configured — run `pnpm trellis:init`
			{/if}
		{/await}
	</p>
</main>
