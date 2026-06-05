import { error } from '@sveltejs/kit';
import { form, query } from '$app/server';
import { AddTagInput, RemoveTagInput } from '$lib/schemas/tag';
import { assertTrellisConfigured, reconnectLiveQuery, runLiveQueryStream } from '$lib/trellis';
import { createTag, deleteTag, listTags, subscribeTags } from '$lib/server/tags';

export const getTags = query.live(async function* () {
	assertTrellisConfigured();

	try {
		yield* runLiveQueryStream({
			load: () => listTags(),
			subscribe: (onUpdate) => subscribeTags(onUpdate)
		});
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(503, e instanceof Error ? e.message : 'Trellis sidecar unavailable');
	}
});

export const addTag = form(AddTagInput, async ({ name }) => {
	assertTrellisConfigured();
	await createTag(name);
	await reconnectLiveQuery(getTags());
	return { success: true };
});

export const removeTag = form(RemoveTagInput, async ({ id }) => {
	assertTrellisConfigured();
	await deleteTag(id);
	await reconnectLiveQuery(getTags());
	return { success: true };
});
