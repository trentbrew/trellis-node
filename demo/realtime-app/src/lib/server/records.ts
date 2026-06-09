/**
 * Server-side CollectionRecord access for fractal remotes (lane materialization).
 * Main Collections UI uses client typed SDK — not this module.
 */
import type { EntityData } from 'trellis/client';
import {
	COLLECTION_RECORDS_QUERY,
	fromRecordRow,
	sortRecords,
	type CollectionRecord
} from '$lib/schemas/collection';
import { createEntityCollection } from '$lib/trellis/collection';
import {
	createDraftRecordId,
	dropVcsLane,
	journalRecordCreate,
	journalRecordDelete,
	journalRecordUpdate,
	listMappedAppLanes,
	materializeLaneView,
	promoteVcsLane,
	subscribeLaneJournal,
	usesJournalLane
} from '$lib/server/vcs-lane';
import { entityLaneId, filterByLane, isAgentLane, MAIN_LANE, normalizeLaneId, type LaneId } from '$lib/trellis/lane';

function fromEntity(entity: EntityData): CollectionRecord {
	return fromRecordRow({
		'?e': entity.id,
		title: entity.title,
		collectionId: entity.collectionId,
		body: entity.body,
		sortOrder: entity.sortOrder,
		laneId: entity.laneId
	});
}

export const collectionRecords = createEntityCollection<CollectionRecord>({
	entityType: 'CollectionRecord',
	eqlQuery: COLLECTION_RECORDS_QUERY,
	mapEntity: fromEntity,
	mapBinding: (row) => fromRecordRow(row),
	sort: sortRecords
});

export async function listCollectionRecords(lane: LaneId = MAIN_LANE): Promise<CollectionRecord[]> {
	if (usesJournalLane(lane)) {
		return materializeLaneView(lane);
	}
	return filterByLane(await collectionRecords.list(), lane);
}

export function subscribeCollectionRecords(
	lane: LaneId,
	onUpdate: (items: CollectionRecord[]) => void
) {
	if (usesJournalLane(lane)) {
		return subscribeLaneJournal(lane, onUpdate);
	}
	return collectionRecords.subscribe(async () => {
		onUpdate(await listCollectionRecords(lane));
	});
}

export async function findCollectionRecord(
	id: string
): Promise<{ record: CollectionRecord; lane: LaneId } | null> {
	const fromGraph = await collectionRecords.read(id);
	if (fromGraph) {
		return { record: fromGraph, lane: entityLaneId(fromGraph) };
	}
	for (const appLane of listMappedAppLanes()) {
		if (!usesJournalLane(appLane)) continue;
		const hit = (await materializeLaneView(appLane)).find((item) => item.id === id);
		if (hit) return { record: hit, lane: appLane };
	}
	return null;
}

export async function updateCollectionRecord(id: string, title: string): Promise<void> {
	const found = await findCollectionRecord(id);
	if (!found) return;
	if (usesJournalLane(found.lane)) {
		await journalRecordUpdate(found.lane, id, { title });
		return;
	}
	await collectionRecords.update(id, { title });
}

export async function createCollectionRecord(
	collectionId: string,
	title: string,
	opts: { laneId?: LaneId; sortOrder?: number; body?: string } = {}
): Promise<CollectionRecord> {
	const laneId = normalizeLaneId(opts.laneId);
	if (usesJournalLane(laneId)) {
		const id = createDraftRecordId();
		await journalRecordCreate(laneId, id, {
			collectionId,
			title,
			body: opts.body,
			sortOrder: opts.sortOrder,
			laneId
		});
		return { id, type: 'CollectionRecord', collectionId, title, body: opts.body, sortOrder: opts.sortOrder, laneId };
	}
	const id = await collectionRecords.create({
		collectionId,
		title,
		body: opts.body,
		sortOrder: opts.sortOrder,
		laneId
	});
	return { id, type: 'CollectionRecord', collectionId, title, body: opts.body, sortOrder: opts.sortOrder, laneId };
}

export async function promoteLane(laneId: LaneId): Promise<{ promoted: number }> {
	if (!isAgentLane(laneId)) return { promoted: 0 };
	const drafts = await listCollectionRecords(laneId);
	const main = await listCollectionRecords(MAIN_LANE);
	const mainByTitle = new Map(main.map((item) => [`${item.collectionId}:${item.title}`, item]));

	for (const draft of drafts) {
		const key = `${draft.collectionId}:${draft.title}`;
		const existing = mainByTitle.get(key);
		if (existing) {
			await collectionRecords.update(existing.id, { title: draft.title, body: draft.body, sortOrder: draft.sortOrder });
		} else {
			const created = await createCollectionRecord(draft.collectionId, draft.title, {
				sortOrder: draft.sortOrder,
				body: draft.body,
				laneId: MAIN_LANE
			});
			mainByTitle.set(key, created);
		}
	}

	if (!usesJournalLane(laneId)) {
		for (const draft of drafts) {
			await collectionRecords.remove(draft.id);
		}
	}
	await promoteVcsLane(laneId).catch(() => {});
	return { promoted: drafts.length };
}

export async function discardLane(laneId: LaneId): Promise<{ removed: number }> {
	if (!isAgentLane(laneId)) return { removed: 0 };
	const drafts = usesJournalLane(laneId)
		? await materializeLaneView(laneId)
		: filterByLane(await collectionRecords.list(), laneId);
	if (!usesJournalLane(laneId)) {
		for (const draft of drafts) {
			await collectionRecords.remove(draft.id);
		}
	}
	await dropVcsLane(laneId).catch(() => {});
	return { removed: drafts.length };
}

export { collectionRecords as graphRecords };
