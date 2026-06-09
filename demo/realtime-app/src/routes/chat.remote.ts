import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { RoomInput, SendMessageInput } from '$lib/schemas/chat';
import { createMessage, listMessages, subscribeMessages } from '$lib/server/chat';
import { assertTrellisConfigured, runLiveQueryStream } from '$lib/trellis';

export const getMessages = query.live(RoomInput, async function* ({ room }) {
	assertTrellisConfigured();
	try {
		yield* runLiveQueryStream({
			load: () => listMessages(room),
			subscribe: (onUpdate) => subscribeMessages(room, onUpdate)
		});
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(503, e instanceof Error ? e.message : 'Trellis sidecar unavailable');
	}
});

export const sendMessage = command(SendMessageInput, async ({ room, author, color, text }) => {
	assertTrellisConfigured();
	await createMessage({ room, author, color, text });
	return { ok: true };
});
