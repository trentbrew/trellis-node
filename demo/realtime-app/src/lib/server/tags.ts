import type { EntityData } from 'trellis/client';
import { TAGS_QUERY, fromBinding, fromGraphRow, sortTags, type Tag } from '$lib/schemas/tag';
import { createEntityCollection } from '$lib/trellis/collection';

function fromEntity(entity: EntityData): Tag {
	return fromGraphRow({ '?e': entity.id, name: entity.name });
}

export const tags = createEntityCollection<Tag>({
	entityType: 'tag',
	eqlQuery: TAGS_QUERY,
	mapEntity: fromEntity,
	mapBinding: fromBinding,
	sort: sortTags
});

export async function listTags(): Promise<Tag[]> {
	return tags.list();
}

export function subscribeTags(onUpdate: (items: Tag[]) => void) {
	return tags.subscribe(onUpdate);
}

export async function createTag(name: string): Promise<Tag> {
	const id = await tags.create({ name });
	return { id, name };
}

export async function deleteTag(id: string): Promise<void> {
	await tags.remove(id);
}
