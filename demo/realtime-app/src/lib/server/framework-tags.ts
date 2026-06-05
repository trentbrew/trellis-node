import {
	groupTagsByFramework,
	TAG_ASSIGNMENTS_QUERY,
	TAG_ASSIGNMENT_TYPE,
	type FrameworkTag
} from '$lib/schemas/tagged';
import { getTrellis } from '$lib/trellis/client';
import type { Framework } from '$lib/schemas/framework';

export async function loadFrameworkTagMap(): Promise<Map<string, FrameworkTag[]>> {
	const { bindings } = await getTrellis().query(TAG_ASSIGNMENTS_QUERY);
	return groupTagsByFramework(bindings);
}

export async function assignTag(frameworkId: string, tagId: string): Promise<void> {
	const existing = await findAssignmentIds(frameworkId, tagId);
	if (existing.length === 0) {
		await getTrellis().create(TAG_ASSIGNMENT_TYPE, { frameworkId, tagId });
	}
	await pingFrameworkTagRevision(frameworkId);
}

export async function unassignTag(frameworkId: string, tagId: string): Promise<void> {
	const existing = await findAssignmentIds(frameworkId, tagId);
	await Promise.all(existing.map((id) => getTrellis().delete(id)));
	await pingFrameworkTagRevision(frameworkId);
}

/** Promote: copy materialized lane tags onto a main-lane graph entity. */
export async function mergeMaterializedTagsToGraph(
	draft: Framework & { tags: FrameworkTag[] },
	toId: string
): Promise<void> {
	if (draft.tags.length === 0) return;

	const tagMap = await loadFrameworkTagMap();
	const assigned = new Set((tagMap.get(toId) ?? []).map((tag) => tag.id));

	for (const tag of draft.tags) {
		if (assigned.has(tag.id)) continue;
		await getTrellis().create(TAG_ASSIGNMENT_TYPE, { frameworkId: toId, tagId: tag.id });
		assigned.add(tag.id);
	}

	await pingFrameworkTagRevision(toId);
}

/** Merge all tag assignment entities from one graph framework onto another. */
export async function mergeTagsToFramework(fromId: string, toId: string): Promise<void> {
	if (fromId === toId) return;

	const tagMap = await loadFrameworkTagMap();
	const fromTags = tagMap.get(fromId) ?? [];
	const assigned = new Set((tagMap.get(toId) ?? []).map((tag) => tag.id));

	for (const tag of fromTags) {
		if (assigned.has(tag.id)) continue;
		await getTrellis().create(TAG_ASSIGNMENT_TYPE, { frameworkId: toId, tagId: tag.id });
		assigned.add(tag.id);
	}

	if (fromTags.length > 0) {
		await pingFrameworkTagRevision(toId);
	}
}

/** Bump a mutable attribute so framework live subscriptions receive a diff. */
async function pingFrameworkTagRevision(frameworkId: string): Promise<void> {
	await getTrellis().update(frameworkId, { tagRevision: Date.now() });
}

async function findAssignmentIds(frameworkId: string, tagId: string): Promise<string[]> {
	const { bindings } = await getTrellis().query(TAG_ASSIGNMENTS_QUERY);

	return bindings
		.filter((row) => String(row['?framework'] ?? row.framework ?? '') === frameworkId)
		.filter((row) => String(row['?tag'] ?? row.tag ?? '') === tagId)
		.map((row) => String(row['?assignment'] ?? row.assignment ?? ''))
		.filter(Boolean);
}
