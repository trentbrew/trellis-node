/**
 * Ephemeral broadcast channel — the transient twin of the durable diff
 * subscriptions in `collection.ts`. Presence/cursors/typing-indicators live
 * here: latest-per-peer, TTL'd, NEVER persisted to the triple-store or VCS
 * journal. A lost update self-heals on the next one, so there are no ordering
 * or durability guarantees by design.
 *
 * This is the framework-agnostic seam. The default `createInMemoryChannel`
 * fans out within a single Node process only — fine for the dev server + a
 * single sidecar. For multi-instance deploys (adapter-vercel Fluid Compute)
 * swap in a broker-backed impl (Redis/Upstash pub-sub) behind this same
 * interface; nothing else changes.
 */

export interface EphemeralPeer<P extends object> {
	peerId: string;
	payload: P;
	/** Epoch ms of the last publish/touch — drives TTL eviction. */
	updatedAt: number;
}

export interface EphemeralSubscription {
	unsubscribe(): void;
}

export interface EphemeralChannel<P extends object> {
	/**
	 * Register a peer in a room and listen for changes. The subscription IS the
	 * membership: unsubscribing (stream close / tab leave) removes the peer and
	 * notifies the room — leave-detection for free.
	 */
	join(
		room: string,
		peerId: string,
		initial: P,
		onUpdate: (peers: EphemeralPeer<P>[]) => void
	): EphemeralSubscription;
	/** Merge a high-frequency patch into a peer's payload. No-op if absent. */
	publish(room: string, peerId: string, patch: Partial<P>): void;
	/** Refresh a peer's TTL without broadcasting (heartbeat for idle peers). */
	touch(room: string, peerId: string): void;
	/** Current peers in a room. */
	snapshot(room: string): EphemeralPeer<P>[];
}

export interface InMemoryChannelOptions {
	/** Evict peers idle longer than this. Default 30_000ms. */
	ttlMs?: number;
	/** Sweep cadence. Default 10_000ms. Set 0 to disable the timer. */
	sweepMs?: number;
	now?: () => number;
}

interface Room<P extends object> {
	peers: Map<string, EphemeralPeer<P>>;
	listeners: Set<(peers: EphemeralPeer<P>[]) => void>;
}

export interface DisposableEphemeralChannel<P extends object> extends EphemeralChannel<P> {
	/** Clear the sweep timer and drop all rooms (tests / HMR teardown). */
	dispose(): void;
}

export function createInMemoryChannel<P extends object>(
	options: InMemoryChannelOptions = {}
): DisposableEphemeralChannel<P> {
	const ttlMs = options.ttlMs ?? 30_000;
	const sweepMs = options.sweepMs ?? 10_000;
	const now = options.now ?? Date.now;

	const rooms = new Map<string, Room<P>>();

	const snapshotOf = (room: Room<P>): EphemeralPeer<P>[] =>
		[...room.peers.values()].map((peer) => ({ ...peer, payload: { ...peer.payload } }));

	const broadcast = (room: Room<P>) => {
		const peers = snapshotOf(room);
		for (const listener of room.listeners) listener(peers);
	};

	const dropIfEmpty = (key: string, room: Room<P>) => {
		if (room.peers.size === 0 && room.listeners.size === 0) rooms.delete(key);
	};

	const sweep = () => {
		const cutoff = now() - ttlMs;
		for (const [key, room] of rooms) {
			let changed = false;
			for (const [peerId, peer] of room.peers) {
				if (peer.updatedAt < cutoff) {
					room.peers.delete(peerId);
					changed = true;
				}
			}
			if (changed) broadcast(room);
			dropIfEmpty(key, room);
		}
	};

	const timer = sweepMs > 0 ? setInterval(sweep, sweepMs) : null;
	// Don't keep the event loop alive solely for the sweep timer.
	timer?.unref?.();

	return {
		join(roomKey, peerId, initial, onUpdate) {
			let room = rooms.get(roomKey);
			if (!room) {
				room = { peers: new Map(), listeners: new Set() };
				rooms.set(roomKey, room);
			}
			const here = room;

			here.peers.set(peerId, { peerId, payload: { ...initial }, updatedAt: now() });
			here.listeners.add(onUpdate);
			broadcast(here);

			return {
				unsubscribe() {
					here.listeners.delete(onUpdate);
					if (here.peers.delete(peerId)) broadcast(here);
					dropIfEmpty(roomKey, here);
				}
			};
		},

		publish(roomKey, peerId, patch) {
			const room = rooms.get(roomKey);
			const peer = room?.peers.get(peerId);
			if (!room || !peer) return;

			let changed = false;
			for (const key of Object.keys(patch) as (keyof P)[]) {
				const value = patch[key];
				if (value !== undefined && peer.payload[key] !== value) {
					peer.payload[key] = value as P[keyof P];
					changed = true;
				}
			}

			peer.updatedAt = now();
			if (changed) broadcast(room);
		},

		touch(roomKey, peerId) {
			const peer = rooms.get(roomKey)?.peers.get(peerId);
			if (peer) peer.updatedAt = now();
		},

		snapshot(roomKey) {
			const room = rooms.get(roomKey);
			return room ? snapshotOf(room) : [];
		},

		dispose() {
			if (timer) clearInterval(timer);
			rooms.clear();
		}
	};
}
