import { z } from 'zod';
import { MAIN_LANE, type LaneId } from '$lib/trellis/lane';

export const FRAMEWORK_CONTEXT = 'https://trellis.dev/ns/framework/v1' as const;

export const FrameworkEntity = z.object({
	'@context': z.literal(FRAMEWORK_CONTEXT),
	'@type': z.literal('Framework'),
	'@id': z.string(),
	title: z.string().min(1),
	slug: z.string().optional(),
	sortOrder: z.number().int().optional(),
	laneId: z.string().optional()
});

export type FrameworkEntity = z.infer<typeof FrameworkEntity>;

export const LaneQueryInput = z.object({
	lane: z.string().optional().default(MAIN_LANE)
});

/** Single-Thing live query, keyed by entity id + lane (version). */
export const ThingQueryInput = z.object({
	id: z.string().min(1),
	lane: z.string().optional().default(MAIN_LANE)
});

export const AddFrameworkInput = z.object({
	title: z.string().min(1),
	lane: z.string().optional().default(MAIN_LANE)
});

export const RemoveFrameworkInput = z.object({
	id: z.string().min(1)
});

export const UpdateFrameworkInput = z.object({
	id: z.string().min(1),
	title: z.string().min(1)
});

export const PromoteLaneInput = z.object({
	lane: z.string()
});

export const DiscardLaneInput = z.object({
	lane: z.string()
});

export type Framework = {
	id: string;
	title: string;
	slug?: string;
	sortOrder?: number;
	laneId?: LaneId;
	/** Kernel formula field — $len($title) via logic-middleware */
	titleLength?: number;
	/** Kernel rollup over frameworkTag rows (TRL-21) */
	tagCount?: number;
};

/** Mutable fields in bindings so Trellis realtime diffs fire on edits. */
export const FRAMEWORKS_QUERY = `SELECT ?e ?title ?slug ?sortOrder ?laneId ?titleLength ?tagCount
WHERE {
  [?e "type" "framework"]
  [?e "title" ?title]
}`;

export function slugify(title: string): string {
	return title
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

export function fromGraphRow(row: Record<string, unknown>): Framework {
	const id = String(row['?e'] ?? row.id ?? row.e ?? '');
	return {
		id,
		title: String(row.title ?? id),
		slug: row.slug != null ? String(row.slug) : undefined,
		sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : undefined,
		laneId: row.laneId != null ? (String(row.laneId) as LaneId) : MAIN_LANE,
		titleLength: typeof row.titleLength === 'number' ? row.titleLength : undefined,
		tagCount: typeof row.tagCount === 'number' ? row.tagCount : undefined
	};
}

export function fromBinding(row: Record<string, unknown>): Partial<Framework> {
	return {
		id: String(row['?e'] ?? row.e ?? row.id ?? ''),
		title: row.title != null ? String(row.title) : undefined,
		laneId: row.laneId != null ? (String(row.laneId) as LaneId) : MAIN_LANE,
		titleLength: typeof row.titleLength === 'number' ? row.titleLength : undefined,
		tagCount: typeof row.tagCount === 'number' ? row.tagCount : undefined
	};
}

export function sortFrameworks(frameworks: Framework[]): Framework[] {
	return [...frameworks].sort((a, b) => {
		const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
		const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
		if (orderA !== orderB) return orderA - orderB;
		return a.title.localeCompare(b.title);
	});
}

export function toJsonLd(framework: Framework): FrameworkEntity {
	return {
		'@context': FRAMEWORK_CONTEXT,
		'@type': 'Framework',
		'@id': framework.id,
		title: framework.title,
		slug: framework.slug,
		sortOrder: framework.sortOrder,
		laneId: framework.laneId === MAIN_LANE ? undefined : framework.laneId
	};
}
