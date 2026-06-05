import { z } from 'zod';

/** Link attribute from framework → tag entities. */
export const TAGGED_ATTRIBUTE = 'tagged' as const;
export const TAG_ASSIGNMENT_TYPE = 'frameworkTag' as const;

export const ToggleFrameworkTagInput = z.object({
	frameworkId: z.string().min(1),
	tagId: z.string().min(1),
	assign: z.coerce.boolean()
});

export type FrameworkTag = {
	id: string;
	name: string;
};

export const TAG_ASSIGNMENTS_QUERY = `SELECT ?assignment ?framework ?tag
WHERE {
  [?assignment "type" "${TAG_ASSIGNMENT_TYPE}"]
  [?assignment "frameworkId" ?framework]
  [?assignment "tagId" ?tag]
}`;

export function groupTagsByFramework(
	bindings: Record<string, unknown>[]
): Map<string, FrameworkTag[]> {
	const map = new Map<string, FrameworkTag[]>();

	for (const row of bindings) {
		const frameworkId = String(row['?framework'] ?? row.framework ?? '');
		const tagId = String(row['?tag'] ?? row.tag ?? '');
		const name = String(row['?tagName'] ?? row.tagName ?? tagId);
		if (!frameworkId || !tagId) continue;

		const tags = map.get(frameworkId) ?? [];
		if (!tags.some((tag) => tag.id === tagId)) {
			tags.push({ id: tagId, name });
		}
		map.set(frameworkId, tags);
	}

	return map;
}
