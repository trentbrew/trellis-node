import { command, query } from '$app/server';
import {
	CURSOR_OFFSCREEN,
	HeartbeatInput,
	PresenceJoinInput,
	PublishCursorInput,
	type PresencePeer
} from '$lib/schemas/presence';
import { presenceChannel } from '$lib/server/presence';
import { runLiveQueryStream } from '$lib/trellis';

/**
 * Live presence for a room. The subscription IS the membership: the stream
 * closing (tab close / navigate away) unsubscribes, which removes the peer and
 * notifies everyone else — no explicit "leave" call needed.
 */
export const getPresence = query.live(
	PresenceJoinInput,
	async function* ({ room, peerId, name, color }) {
		yield* runLiveQueryStream<PresencePeer[]>({
			load: async () => presenceChannel.snapshot(room),
			subscribe: (onUpdate) =>
				presenceChannel.join(
					room,
					peerId,
					{ name, color, x: CURSOR_OFFSCREEN, y: CURSOR_OFFSCREEN },
					onUpdate
				)
		});
	}
);

/** High-frequency cursor move. Throttle on the client before calling this. */
export const publishCursor = command(PublishCursorInput, ({ room, peerId, x, y }) => {
	presenceChannel.publish(room, peerId, { x, y });
});

/** Idle keepalive so a present-but-still peer survives the TTL sweep. */
export const heartbeatPresence = command(HeartbeatInput, ({ room, peerId }) => {
	presenceChannel.touch(room, peerId);
});
