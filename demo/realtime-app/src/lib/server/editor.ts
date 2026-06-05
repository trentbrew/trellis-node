import type { EntityData } from 'trellis/client';
import { BLOCKS_QUERY, fromBlockRow, sortBlocks, type Block } from '$lib/schemas/block';
import { createEntityCollection } from '$lib/trellis/collection';

function fromEntity(entity: EntityData): Block {
	return fromBlockRow({
		'?e': entity.id,
		text: entity.text,
		doc: entity.doc,
		order: entity.order,
		editedBy: entity.editedBy,
		editedColor: entity.editedColor,
		updatedAt: entity.updatedAt
	});
}

const blocks = createEntityCollection<Block>({
	entityType: 'block',
	eqlQuery: BLOCKS_QUERY,
	mapEntity: fromEntity,
	mapBinding: (row) => fromBlockRow(row),
	sort: sortBlocks
});

export async function listBlocks(doc: string): Promise<Block[]> {
	const all = await blocks.list();
	return sortBlocks(all.filter((block) => block.doc === doc));
}

export function subscribeBlocks(doc: string, onUpdate: (blocks: Block[]) => void) {
	return blocks.subscribe((items) => {
		onUpdate(sortBlocks(items.filter((block) => block.doc === doc)));
	});
}

export async function addBlock(input: {
	doc: string;
	order: number;
	author: string;
	color: string;
}): Promise<void> {
	await blocks.create({
		doc: input.doc,
		order: input.order,
		text: '',
		editedBy: input.author,
		editedColor: input.color,
		updatedAt: Date.now()
	});
}

/** Last-writer-wins on the whole block text. */
export async function updateBlockText(input: {
	id: string;
	text: string;
	author: string;
	color: string;
}): Promise<void> {
	await blocks.update(input.id, {
		text: input.text,
		editedBy: input.author,
		editedColor: input.color,
		updatedAt: Date.now()
	});
}

export async function removeBlock(id: string): Promise<void> {
	await blocks.remove(id);
}

export async function nextOrder(doc: string): Promise<number> {
	const existing = await listBlocks(doc);
	return existing.length ? existing[existing.length - 1]!.order + 1 : 0;
}
