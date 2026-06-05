import type { EntityData } from 'trellis/client';
import type { FrameworkTag } from '$lib/schemas/tagged';
import {
	FRAMEWORKS_QUERY,
	fromGraphRow,
	slugify,
	sortFrameworks,
	type Framework
} from '$lib/schemas/framework';
import { mergeMaterializedTagsToGraph } from '$lib/server/framework-tags';
import {
	createDraftFrameworkId,
	dropVcsLane,
	journalFrameworkCreate,
	journalFrameworkDelete,
	journalFrameworkUpdate,
	listMappedAppLanes,
	materializeLaneView,
	promoteVcsLane,
	subscribeLaneJournal,
	usesJournalLane
} from '$lib/server/vcs-lane';
import { createEntityCollection } from '$lib/trellis/collection';
import {
	entityLaneId,
	filterByLane,
	isAgentLane,
	MAIN_LANE,
	normalizeLaneId,
	type LaneId
} from '$lib/trellis/lane';

export type FrameworkWithTags = Framework & {
	tags: FrameworkTag[];
	/** Kernel rollup (main lane) or join-entity count fallback (journal lane). */
	tagCount: number;
};

function withTagRollup<T extends Framework & { tags: FrameworkTag[] }>(item: T): FrameworkWithTags {
	const tagCount = typeof item.tagCount === 'number' ? item.tagCount : item.tags.length;
	return { ...item, tagCount };
}

function fromEntity(entity: EntityData): Framework {
	return fromGraphRow({
		'?e': entity.id,
		title: entity.title,
		slug: entity.slug,
		sortOrder: entity.sortOrder,
		laneId: entity.laneId
	});
}

export const frameworks = createEntityCollection<Framework>({
	entityType: 'framework',
	eqlQuery: FRAMEWORKS_QUERY,
	mapEntity: fromEntity,
	mapBinding: (row) => fromGraphRow(row),
	sort: sortFrameworks
});

async function listGraphFrameworksWithTags(lane: LaneId = MAIN_LANE): Promise<FrameworkWithTags[]> {
	const { loadFrameworkTagMap } = await import('$lib/server/framework-tags');
	const [items, tagMap] = await Promise.all([
		frameworks.list().then((rows) => filterByLane(rows, lane)),
		loadFrameworkTagMap()
	]);

	return items.map((item) =>
		withTagRollup({
			...item,
			tags: tagMap.get(item.id) ?? []
		})
	);
}

export async function listFrameworks(lane: LaneId = MAIN_LANE): Promise<FrameworkWithTags[]> {
	if (usesJournalLane(lane)) {
		return materializeLaneView(lane);
	}
	return listGraphFrameworksWithTags(lane);
}

export function subscribeFrameworks(
	lane: LaneId,
	onUpdate: (frameworks: FrameworkWithTags[]) => void
) {
	if (usesJournalLane(lane)) {
		return subscribeLaneJournal(lane, onUpdate);
	}

	return frameworks.subscribe(async () => {
		onUpdate(await listGraphFrameworksWithTags(lane));
	});
}

export async function findFramework(
	id: string
): Promise<{ framework: FrameworkWithTags; lane: LaneId } | null> {
	const fromGraph = await frameworks.read(id);
	if (fromGraph) {
		const { loadFrameworkTagMap } = await import('$lib/server/framework-tags');
		const tagMap = await loadFrameworkTagMap();
		return {
			framework: withTagRollup({ ...fromGraph, tags: tagMap.get(id) ?? [] }),
			lane: entityLaneId(fromGraph)
		};
	}

	for (const appLane of listMappedAppLanes()) {
		if (!usesJournalLane(appLane)) continue;
		const hit = (await materializeLaneView(appLane)).find((item) => item.id === id);
		if (hit) return { framework: hit, lane: appLane };
	}

	return null;
}

export async function createFramework(
	title: string,
	opts: { sortOrder?: number; laneId?: LaneId } = {}
): Promise<Framework> {
	const laneId = normalizeLaneId(opts.laneId);
	const slug = slugify(title);

	if (usesJournalLane(laneId)) {
		const id = createDraftFrameworkId();
		await journalFrameworkCreate(laneId, id, {
			title,
			slug,
			sortOrder: opts.sortOrder,
			laneId
		});
		return { id, title, slug, sortOrder: opts.sortOrder, laneId };
	}

	const id = await frameworks.create({
		title,
		slug,
		sortOrder: opts.sortOrder,
		laneId
	});
	return { id, title, slug, sortOrder: opts.sortOrder, laneId };
}

export async function updateFrameworkRecord(id: string, title: string): Promise<void> {
	const found = await findFramework(id);
	if (!found) return;

	const slug = slugify(title);
	if (usesJournalLane(found.lane)) {
		await journalFrameworkUpdate(found.lane, id, { title, slug });
		return;
	}

	await frameworks.update(id, { title, slug });
}

export async function deleteFrameworkRecord(id: string): Promise<void> {
	const found = await findFramework(id);
	if (found && usesJournalLane(found.lane)) {
		await journalFrameworkDelete(found.lane, id);
		return;
	}
	await frameworks.remove(id);
}

export async function getFramework(id: string): Promise<Framework | null> {
	const found = await findFramework(id);
	return found?.framework ?? null;
}

export async function promoteLane(laneId: LaneId): Promise<{ promoted: number }> {
	if (!isAgentLane(laneId)) return { promoted: 0 };

	const drafts = usesJournalLane(laneId)
		? await materializeLaneView(laneId)
		: await listGraphFrameworksWithTags(laneId);

	const main = await listGraphFrameworksWithTags(MAIN_LANE);
	const mainBySlug = new Map(main.map((item) => [item.slug ?? slugify(item.title), item]));

	for (const draft of drafts) {
		const slug = draft.slug ?? slugify(draft.title);
		const existing = mainBySlug.get(slug);

		if (existing) {
			await frameworks.update(existing.id, {
				title: draft.title,
				slug,
				sortOrder: draft.sortOrder
			});
			await mergeMaterializedTagsToGraph(draft, existing.id);
		} else {
			const created = await createFramework(draft.title, {
				sortOrder: draft.sortOrder,
				laneId: MAIN_LANE
			});
			await mergeMaterializedTagsToGraph(draft, created.id);
			mainBySlug.set(slug, withTagRollup({ ...created, tags: [] }));
		}
	}

	if (!usesJournalLane(laneId)) {
		for (const draft of drafts) {
			await frameworks.remove(draft.id);
		}
	}

	await promoteVcsLane(laneId).catch(() => {});

	return { promoted: drafts.length };
}

export async function discardLane(laneId: LaneId): Promise<{ removed: number }> {
	if (!isAgentLane(laneId)) return { removed: 0 };

	const drafts = usesJournalLane(laneId)
		? await materializeLaneView(laneId)
		: filterByLane(await frameworks.list(), laneId);

	if (!usesJournalLane(laneId)) {
		for (const draft of drafts) {
			await frameworks.remove(draft.id);
		}
	}

	await dropVcsLane(laneId).catch(() => {});

	return { removed: drafts.length };
}

const SEED_TITLES = ['svelte', 'sveltekit', 'solid', 'react', 'vue'];

let seedPromise: Promise<void> | null = null;

export async function ensureFrameworkSeed(): Promise<void> {
	if (!seedPromise) {
		seedPromise = seedFrameworksOnce().catch((error) => {
			seedPromise = null;
			throw error;
		});
	}
	await seedPromise;
}

async function seedFrameworksOnce(): Promise<void> {
	const existing = filterByLane(await frameworks.list(), MAIN_LANE);
	const slugs = new Set(existing.map((f) => f.slug ?? slugify(f.title)));

	for (let i = 0; i < SEED_TITLES.length; i++) {
		const title = SEED_TITLES[i]!;
		const slug = slugify(title);
		if (slugs.has(slug)) continue;
		await createFramework(title, { sortOrder: i, laneId: MAIN_LANE });
	}
}

export { trellisConfigured, getTrellisUrl, getTrellisApiKey, getTrellis } from '$lib/trellis';
