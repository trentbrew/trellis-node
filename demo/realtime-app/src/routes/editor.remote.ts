import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { AddBlockInput, DocInput, RemoveBlockInput, UpdateBlockInput } from '$lib/schemas/block';
import {
	addBlock,
	listBlocks,
	nextOrder,
	removeBlock,
	subscribeBlocks,
	updateBlockText
} from '$lib/server/editor';
import { assertTrellisConfigured, reconnectLiveQuery, runLiveQueryStream } from '$lib/trellis';

export const getBlocks = query.live(DocInput, async function* ({ doc }) {
	assertTrellisConfigured();
	try {
		yield* runLiveQueryStream({
			load: () => listBlocks(doc),
			subscribe: (onUpdate) => subscribeBlocks(doc, onUpdate)
		});
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(503, e instanceof Error ? e.message : 'Trellis sidecar unavailable');
	}
});

export const createBlock = command(AddBlockInput, async ({ doc, author, color }) => {
	assertTrellisConfigured();
	const order = await nextOrder(doc);
	await addBlock({ doc, order, author, color });
	await reconnectLiveQuery(getBlocks({ doc }));
	return { ok: true };
});

export const editBlock = command(UpdateBlockInput, async ({ id, text, author, color }) => {
	assertTrellisConfigured();
	await updateBlockText({ id, text, author, color });
	// No reconnect: the graph subscription fans the diff out to every doc viewer.
	return { ok: true };
});

export const deleteBlock = command(RemoveBlockInput, async ({ id }) => {
	assertTrellisConfigured();
	await removeBlock(id);
	return { ok: true };
});
