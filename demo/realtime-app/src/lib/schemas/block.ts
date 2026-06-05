import { z } from 'zod';

const doc = z.string().min(1).max(64);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a 6-digit hex string');

export const DocInput = z.object({
	doc: doc.optional().default('draft')
});

export const AddBlockInput = z.object({
	doc,
	author: z.string().min(1).max(40),
	color
});

/**
 * Block-level last-writer-wins. Concurrent edits to DIFFERENT blocks merge
 * cleanly (they're separate entities); same-block edits last-writer-wins. This
 * is the in-stack merge model — Notion-grain, not character-grain.
 */
export const UpdateBlockInput = z.object({
	id: z.string().min(1),
	text: z.string().max(5000),
	author: z.string().min(1).max(40),
	color
});

export const RemoveBlockInput = z.object({
	id: z.string().min(1)
});

export type Block = {
	id: string;
	doc: string;
	order: number;
	text: string;
	editedBy: string;
	editedColor: string;
	updatedAt: number;
};

export const BLOCKS_QUERY = `SELECT ?e ?text ?doc ?order ?editedBy ?editedColor ?updatedAt
WHERE {
  [?e "type" "block"]
  [?e "doc" ?doc]
}`;

export function fromBlockRow(row: Record<string, unknown>): Block {
	const id = String(row['?e'] ?? row.e ?? row.id ?? '');
	const order = typeof row.order === 'number' ? row.order : Number(row.order ?? 0) || 0;
	const updatedAt =
		typeof row.updatedAt === 'number' ? row.updatedAt : Number(row.updatedAt ?? 0) || 0;
	return {
		id,
		doc: row.doc != null ? String(row.doc) : 'draft',
		order,
		text: row.text != null ? String(row.text) : '',
		editedBy: row.editedBy != null ? String(row.editedBy) : '',
		editedColor: row.editedColor != null ? String(row.editedColor) : '#8d8d8d',
		updatedAt
	};
}

export function sortBlocks(blocks: Block[]): Block[] {
	return [...blocks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
