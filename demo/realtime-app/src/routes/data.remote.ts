import { error } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import {
	AddFrameworkInput,
	DiscardLaneInput,
	LaneQueryInput,
	PromoteLaneInput,
	RemoveFrameworkInput,
	ThingQueryInput,
	UpdateFrameworkInput
} from '$lib/schemas/framework';
import { ToggleFrameworkTagInput } from '$lib/schemas/tagged';
import { assignTag, unassignTag } from '$lib/server/framework-tags';
import { journalTagLink, usesJournalLane } from '$lib/server/vcs-lane';
import {
	assertTrellisConfigured,
	refreshAfterEntityMutation,
	refreshAfterLaneMutation,
	runLiveQueryStream
} from '$lib/trellis';
import { MAIN_LANE, normalizeLaneId } from '$lib/trellis/lane';
import {
	createFramework,
	deleteFrameworkRecord,
	discardLane,
	findFramework,
	listFrameworks,
	promoteLane,
	subscribeFrameworks,
	updateFrameworkRecord
} from '$lib/server/trellis';

export const getFrameworks = query.live(LaneQueryInput, async function* ({ lane }) {
	assertTrellisConfigured();
	const laneId = normalizeLaneId(lane);

	try {
		yield* runLiveQueryStream({
			load: () => listFrameworks(laneId),
			subscribe: (onUpdate) => subscribeFrameworks(laneId, onUpdate)
		});
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(503, e instanceof Error ? e.message : 'Trellis sidecar unavailable');
	}
});

/**
 * Single-Thing live query — the fractal kernel. Keyed by (id, lane), so the same
 * Thing rendered at multiple vantages shares one stream. Lane is the version axis;
 * the same id resolves to a different value per lane.
 */
export const getThing = query.live(ThingQueryInput, async function* ({ id, lane }) {
	assertTrellisConfigured();
	const laneId = normalizeLaneId(lane);

	try {
		yield* runLiveQueryStream({
			load: async () => (await listFrameworks(laneId)).find((item) => item.id === id) ?? null,
			subscribe: (onUpdate) =>
				subscribeFrameworks(laneId, (items) =>
					onUpdate(items.find((item) => item.id === id) ?? null)
				)
		});
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(503, e instanceof Error ? e.message : 'Trellis sidecar unavailable');
	}
});

export const addFramework = form(AddFrameworkInput, async ({ title, lane }) => {
	assertTrellisConfigured();
	await createFramework(title, { laneId: normalizeLaneId(lane) });
	await refreshAfterLaneMutation(getFrameworks, lane);
	return { success: true };
});

export const removeFramework = form(RemoveFrameworkInput, async ({ id }) => {
	assertTrellisConfigured();
	const existing = await findFramework(id);
	await deleteFrameworkRecord(id);
	await refreshAfterEntityMutation(getFrameworks, existing ? existing.lane : MAIN_LANE);
	return { success: true };
});

export const updateFramework = form(UpdateFrameworkInput, async ({ id, title }) => {
	assertTrellisConfigured();
	const existing = await findFramework(id);
	await updateFrameworkRecord(id, title);
	await refreshAfterEntityMutation(getFrameworks, existing ? existing.lane : MAIN_LANE);
	return { success: true };
});

export const promoteLaneDrafts = command(PromoteLaneInput, async ({ lane }) => {
	assertTrellisConfigured();
	const laneId = normalizeLaneId(lane);
	const result = await promoteLane(laneId);
	await refreshAfterLaneMutation(getFrameworks, lane);
	return result;
});

export const discardLaneDrafts = command(DiscardLaneInput, async ({ lane }) => {
	assertTrellisConfigured();
	const laneId = normalizeLaneId(lane);
	const result = await discardLane(laneId);
	await refreshAfterLaneMutation(getFrameworks, lane);
	return result;
});

export const toggleFrameworkTag = command(
	ToggleFrameworkTagInput,
	async ({ frameworkId, tagId, assign }) => {
		assertTrellisConfigured();
		const existing = await findFramework(frameworkId);
		const lane = existing?.lane ?? MAIN_LANE;

		if (usesJournalLane(lane)) {
			await journalTagLink(lane, frameworkId, tagId, assign ? 'add' : 'remove');
		} else if (assign) {
			await assignTag(frameworkId, tagId);
		} else {
			await unassignTag(frameworkId, tagId);
		}

		await refreshAfterEntityMutation(getFrameworks, lane);
		return { success: true };
	}
);
