/**
 * Collections demo — named tables (CollectionMeta) + rows (CollectionRecord).
 * Product-shaped user schemas; not kernel primitives. See docs/ontology-glossary.md.
 */
import { defineType, type InferType } from 'trellis/schema';
import { z } from 'zod';
import { MAIN_LANE, type LaneId } from '$lib/trellis/lane';

export const DEMO_NS = 'https://trellis.dev/ns/demo/v1' as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be #RRGGBB');

export const CollectionMetaType = defineType(
	'CollectionMeta',
	{
		title: z.string().min(1),
		slug: z.string().min(1).max(64),
		icon: z.string().optional(),
		color: hexColor.optional(),
		description: z.string().max(500).optional(),
		sortOrder: z.number().int().optional()
	},
	{
		title: 'title',
		extends: 'core:Record',
		label: 'Collection'
	}
);

export const CollectionRecordType = defineType(
	'CollectionRecord',
	{
		collectionId: z.string().min(1),
		title: z.string().min(1),
		body: z.string().max(4000).optional(),
		sortOrder: z.number().int().optional(),
		laneId: z.string().optional()
	},
	{
		title: 'title',
		extends: 'core:Record',
		label: 'CollectionRecord'
	}
);

export type CollectionMeta = InferType<typeof CollectionMetaType>;
export type CollectionRecord = InferType<typeof CollectionRecordType>;

export const LaneQueryInput = z.object({
	lane: z.string().optional().default(MAIN_LANE)
});

export const ThingQueryInput = z.object({
	id: z.string().min(1),
	lane: z.string().optional().default(MAIN_LANE)
});

export const UpdateCollectionRecordInput = z.object({
	id: z.string().min(1),
	title: z.string().min(1)
});

export const PromoteLaneInput = z.object({
	lane: z.string()
});

export const DiscardLaneInput = z.object({
	lane: z.string()
});

export const COLLECTION_META_QUERY = `SELECT ?e ?title ?slug ?icon ?color ?description ?sortOrder
WHERE {
  [?e "type" "CollectionMeta"]
  [?e "title" ?title]
}`;

export const COLLECTION_RECORDS_QUERY = `SELECT ?e ?title ?collectionId ?body ?sortOrder ?laneId
WHERE {
  [?e "type" "CollectionRecord"]
  [?e "title" ?title]
}`;

export function slugify(title: string): string {
	return title
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

export function fromMetaRow(row: Record<string, unknown>): CollectionMeta {
	const id = String(row['?e'] ?? row.id ?? row.e ?? '');
	return {
		id,
		type: 'CollectionMeta',
		title: String(row.title ?? id),
		slug: row.slug != null ? String(row.slug) : slugify(String(row.title ?? id)),
		icon: row.icon != null ? String(row.icon) : undefined,
		color: row.color != null ? String(row.color) : undefined,
		description: row.description != null ? String(row.description) : undefined,
		sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : undefined
	};
}

export function fromRecordRow(row: Record<string, unknown>): CollectionRecord {
	const id = String(row['?e'] ?? row.id ?? row.e ?? '');
	return {
		id,
		type: 'CollectionRecord',
		collectionId: String(row.collectionId ?? ''),
		title: String(row.title ?? id),
		body: row.body != null ? String(row.body) : undefined,
		sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : undefined,
		laneId: row.laneId != null ? (String(row.laneId) as LaneId) : MAIN_LANE
	};
}

export function sortMeta(items: CollectionMeta[]): CollectionMeta[] {
	return [...items].sort((a, b) => {
		const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
		const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
		if (orderA !== orderB) return orderA - orderB;
		return a.title.localeCompare(b.title);
	});
}

export function sortRecords(items: CollectionRecord[]): CollectionRecord[] {
	return [...items].sort((a, b) => {
		const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
		const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
		if (orderA !== orderB) return orderA - orderB;
		return a.title.localeCompare(b.title);
	});
}

export function recordIdPrefix(): string {
	return 'collectionRecord:';
}

export function metaIdPrefix(): string {
	return 'collectionMeta:';
}
