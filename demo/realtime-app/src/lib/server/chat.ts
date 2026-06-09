import type { EntityData } from 'trellis/client';
import {
	MESSAGES_QUERY,
	fromMessageRow,
	mergeChatMessage,
	sortMessages,
	type ChatMessage
} from '$lib/schemas/chat';
import { createEntityCollection } from '$lib/trellis/collection';

function fromEntity(entity: EntityData): ChatMessage {
	return fromMessageRow({
		'?e': entity.id,
		text: entity.text,
		author: entity.author,
		color: entity.color,
		room: entity.room,
		createdAt: entity.createdAt
	});
}

const messages = createEntityCollection<ChatMessage>({
	entityType: 'message',
	eqlQuery: MESSAGES_QUERY,
	mapEntity: fromEntity,
	mapBinding: (row) => fromMessageRow(row),
	mergeEntity: mergeChatMessage,
	sort: sortMessages
});

export async function listMessages(room: string): Promise<ChatMessage[]> {
	const all = await messages.list();
	return sortMessages(all.filter((message) => message.room === room));
}

export function subscribeMessages(room: string, onUpdate: (messages: ChatMessage[]) => void) {
	return messages.subscribe((items) => {
		onUpdate(sortMessages(items.filter((message) => message.room === room)));
	});
}

export async function createMessage(input: {
	room: string;
	author: string;
	color: string;
	text: string;
}): Promise<void> {
	await messages.create({
		room: input.room,
		author: input.author,
		color: input.color,
		text: input.text,
		createdAt: Date.now()
	});
}
