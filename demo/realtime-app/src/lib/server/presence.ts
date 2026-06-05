import { createInMemoryChannel, type DisposableEphemeralChannel } from '$lib/trellis';
import type { CursorPayload } from '$lib/schemas/presence';

/**
 * Process-wide presence hub — a SEPARATE transport from the durable graph diff
 * subscriptions in `server/trellis.ts`. Cursor spam (≈30fps × peers) must never
 * compete with persisted mutations on the same pipe, so it gets its own channel.
 *
 * Stashed on globalThis so Vite HMR re-imports reuse the one instance instead of
 * leaking a sweep timer and orphaning connected peers on every hot reload.
 */
type PresenceGlobal = typeof globalThis & {
	__presenceChannel?: DisposableEphemeralChannel<CursorPayload>;
};

const g = globalThis as PresenceGlobal;

export const presenceChannel: DisposableEphemeralChannel<CursorPayload> = (g.__presenceChannel ??=
	createInMemoryChannel<CursorPayload>());
