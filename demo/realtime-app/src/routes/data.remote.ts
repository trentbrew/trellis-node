import { error } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import {
	DiscardLaneInput,
	LaneQueryInput,
	PromoteLaneInput,
	ThingQueryInput,
	UpdateCollectionRecordInput
} from '$lib/schemas/collection';
import {
	assertTrellisConfigured,
	refreshAfterLaneMutation,
	runLiveQueryStream
} from '$lib/trellis';
import { MAIN_LANE, normalizeLaneId } from '$lib/trellis/lane';
import {
	discardLane,
	findCollectionRecord,
	listCollectionRecords,
	promoteLane,
	subscribeCollectionRecords,
	updateCollectionRecord
} from '$lib/server/records';

export const getCollectionRecords = query.live(LaneQueryInput, async function* ({ lane }) {
	assertTrellisConfigured();
	const laneId = normalizeLaneId(lane);

	try {
		yield* runLiveQueryStream({
			load: () => listCollectionRecords(laneId),
			subscribe: (onUpdate) => subscribeCollectionRecords(laneId, onUpdate)
		});
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(503, e instanceof Error ? e.message : 'Trellis sidecar unavailable');
	}
});

/** @deprecated Use getCollectionRecords */
export const getCustomEntities = getCollectionRecords;

/**
 * Single-Thing live query — fractal kernel. Keyed by (id, lane), so the same
 * record rendered at multiple vantages shares one stream.
 */
export const getThing = query.live(ThingQueryInput, async function* ({ id, lane }) {
	assertTrellisConfigured();
	const laneId = normalizeLaneId(lane);

	try {
		yield* runLiveQueryStream({
			load: async () => (await listCollectionRecords(laneId)).find((item) => item.id === id) ?? null,
			subscribe: (onUpdate) =>
				subscribeCollectionRecords(laneId, (items) =>
					onUpdate(items.find((item) => item.id === id) ?? null)
				)
		});
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(503, e instanceof Error ? e.message : 'Trellis sidecar unavailable');
	}
});

export const updateCollectionRecordForm = form(UpdateCollectionRecordInput, async ({ id, title }) => {
	assertTrellisConfigured();
	const existing = await findCollectionRecord(id);
	await updateCollectionRecord(id, title);
	await refreshAfterLaneMutation(getCollectionRecords, existing?.lane ?? MAIN_LANE);
	return { success: true };
});

/** @deprecated Use updateCollectionRecordForm */
export const updateCustomEntity = updateCollectionRecordForm;

export const promoteLaneDrafts = command(PromoteLaneInput, async ({ lane }) => {
	assertTrellisConfigured();
	const laneId = normalizeLaneId(lane);
	const result = await promoteLane(laneId);
	await refreshAfterLaneMutation(getCollectionRecords, lane);
	return result;
});

export const discardLaneDrafts = command(DiscardLaneInput, async ({ lane }) => {
	assertTrellisConfigured();
	const laneId = normalizeLaneId(lane);
	const result = await discardLane(laneId);
	await refreshAfterLaneMutation(getCollectionRecords, lane);
	return result;
});
