import { defineType, type InferType } from 'trellis/schema';
import { z } from 'zod';

const room = z.string().min(1).max(64);

export const ChatMessageType = defineType(
	'message',
	{
		room,
		author: z.string().min(1).max(40),
		color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a 6-digit hex string'),
		text: z.string().min(1).max(2000),
		createdAt: z.number()
	},
	{ title: 'text' }
);

export type ChatMessage = InferType<typeof ChatMessageType>;

export const RoomInput = z.object({
	room: room.optional().default('lobby')
});

export const SendMessageInput = z.object({
	room,
	author: z.string().min(1).max(40),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a 6-digit hex string'),
	text: z.string().min(1).max(2000)
});

/** @deprecated Hand-written EQL — prefer entitiesStore(client, ChatMessageType, { where: { room } }). */
export const MESSAGES_QUERY = `SELECT ?e ?text ?author ?color ?room ?createdAt
WHERE {
  [?e "type" "message"]
  [?e "text" ?text]
}`;

/** @deprecated Prefer typed live reads. */
export function fromMessageRow(row: Record<string, unknown>): ChatMessage {
	const id = String(row['?e'] ?? row.e ?? row.id ?? '');
	const createdAtRaw = row.createdAt;
	const createdAt =
		typeof createdAtRaw === 'number'
			? createdAtRaw
			: createdAtRaw != null
				? Number(createdAtRaw) || 0
				: 0;
	return {
		id,
		type: 'message',
		room: row.room != null ? String(row.room) : 'lobby',
		author: row.author != null && String(row.author) !== '' ? String(row.author) : 'Guest',
		color: row.color != null ? String(row.color) : '#8d8d8d',
		text: row.text != null ? String(row.text) : '',
		createdAt
	};
}

/** Preserve hydrated fields when a sparse diff patch would clobber them. */
export function mergeChatMessage(existing: ChatMessage, patch: Partial<ChatMessage>): ChatMessage {
	const merged = { ...existing, ...patch };
	if (patch.author === 'Guest' && existing.author !== 'Guest') {
		merged.author = existing.author;
	}
	if ((!patch.createdAt || patch.createdAt === 0) && existing.createdAt > 0) {
		merged.createdAt = existing.createdAt;
	}
	if (patch.color === '#8d8d8d' && existing.color !== '#8d8d8d') {
		merged.color = existing.color;
	}
	return merged;
}

export function sortMessages(messages: ChatMessage[]): ChatMessage[] {
	return [...messages].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
