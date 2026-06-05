import { z } from 'zod';

export const TAG_CONTEXT = 'https://trellis.dev/ns/tag/v1' as const;

export const TagEntity = z.object({
	'@context': z.literal(TAG_CONTEXT),
	'@type': z.literal('Tag'),
	'@id': z.string(),
	name: z.string().min(1)
});

export type TagEntity = z.infer<typeof TagEntity>;

export const AddTagInput = z.object({
	name: z.string().min(1)
});

export const RemoveTagInput = z.object({
	id: z.string().min(1)
});

export type Tag = {
	id: string;
	name: string;
};

/** Mutable bindings for Trellis realtime diffs. */
export const TAGS_QUERY = `SELECT ?e ?name
WHERE {
  [?e "type" "tag"]
  [?e "name" ?name]
}`;

export function fromGraphRow(row: Record<string, unknown>): Tag {
	const id = String(row['?e'] ?? row.id ?? row.e ?? '');
	return {
		id,
		name: String(row.name ?? id)
	};
}

export function fromBinding(row: Record<string, unknown>): Partial<Tag> {
	return {
		id: String(row['?e'] ?? row.e ?? row.id ?? ''),
		name: row.name != null ? String(row.name) : undefined
	};
}

export function sortTags(tags: Tag[]): Tag[] {
	return [...tags].sort((a, b) => a.name.localeCompare(b.name));
}
