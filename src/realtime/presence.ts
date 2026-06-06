/**
 * Transport-agnostic presence — the one place the local-first → cloud-optional
 * gradient is encoded.
 *
 * Presence is ephemeral and self-healing; it is never written to the causal op
 * log. That makes the *transport* a free choice, and this helper picks it by
 * intent rather than hardcoding a hub:
 *
 *   - no `relayUrl`  → {@link BroadcastChannelTransport}: cross-tab, $0, no
 *     socket, works with the network killed. This is the free / local tier and
 *     the default. (Telos principle 7: kill the network, presence across tabs
 *     still works — you just stop seeing remote peers.)
 *   - `relayUrl` set → {@link DurableObjectRelayTransport}: a hosted relay room.
 *     This opens a socket, so per the ecosystem economics it is a *paid* tier.
 *   - `transport`    → bring your own (tests, or an Iroh gossip transport at
 *     Boulder 2) — the escape hatch that keeps the seam honest.
 *
 * Frameworks consume this inside their room hooks, e.g. Svelte:
 *
 *   import { createRoom } from 'trellis/svelte';
 *   import { joinPresence } from 'trellis/realtime';
 *
 *   const { presence, others, destroy } = createRoom(() =>
 *     joinPresence({ peerId, room: 'doc:42', initialPresence: { name, color } }),
 *   );
 */

import { BroadcastChannelTransport } from './broadcast-channel-transport.js';
import { DurableObjectRelayTransport } from './durable-object-relay-transport.js';
import { RealtimeRoom } from './room.js';
import type { PresenceState, RealtimeTransport } from './types.js';

export interface PresenceOptions<P extends PresenceState = PresenceState> {
  /** Local peer identity (stable per tab/device). */
  peerId: string;
  /** Logical room — peers sharing it see each other. */
  room: string;
  /** Initial local presence (name, color, cursor, …). */
  initialPresence?: P;
  /**
   * Hosted relay base URL. When set, presence syncs cross-device through the
   * relay (paid tier). When omitted, presence stays local/cross-tab (free).
   */
  relayUrl?: string;
  /** Auth token for the hosted relay. */
  auth?: string;
  /**
   * Explicit transport — overrides the `relayUrl`/local selection entirely.
   * Use for tests or an alternative transport (e.g. future Iroh gossip).
   */
  transport?: RealtimeTransport;
  /** Heartbeat interval (ms). Default 2000 (see {@link RealtimeRoom}). */
  heartbeatMs?: number;
  /** Peer expiry after no heartbeat (ms). Default 6000. */
  timeoutMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Injectable WebSocket (hosted relay) for tests / non-browser hosts. */
  WebSocketImpl?: ConstructorParameters<
    typeof DurableObjectRelayTransport
  >[0]['WebSocketImpl'];
  /** Injectable BroadcastChannel (local) for tests / non-browser hosts. */
  BroadcastChannelImpl?: ConstructorParameters<
    typeof BroadcastChannelTransport
  >[0]['BroadcastChannelImpl'];
}

/**
 * Select the presence transport for the given options without joining a room.
 * Exposed so callers can inspect or wrap the choice; most code should use
 * {@link joinPresence}.
 */
export function createPresenceTransport(
  opts: PresenceOptions,
): RealtimeTransport {
  if (opts.transport) return opts.transport;
  if (opts.relayUrl) {
    return new DurableObjectRelayTransport({
      id: opts.peerId,
      url: opts.relayUrl,
      room: opts.room,
      auth: opts.auth,
      WebSocketImpl: opts.WebSocketImpl,
    });
  }
  return new BroadcastChannelTransport({
    id: opts.peerId,
    channel: `presence:${opts.room}`,
    BroadcastChannelImpl: opts.BroadcastChannelImpl,
  });
}

/**
 * Join a presence room with a transport chosen by intent (local vs hosted).
 * Returns a {@link RealtimeRoom}; pair it with a framework room hook
 * (`createRoom` / `useRoom`) for reactive presence + broadcast.
 */
export function joinPresence<P extends PresenceState = PresenceState>(
  opts: PresenceOptions<P>,
): RealtimeRoom<P> {
  return RealtimeRoom.join<P>({
    transport: createPresenceTransport(opts),
    initialPresence: opts.initialPresence,
    heartbeatMs: opts.heartbeatMs,
    timeoutMs: opts.timeoutMs,
    now: opts.now,
  });
}
