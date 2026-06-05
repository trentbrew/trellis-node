/**
 * Trellis Realtime — Ephemeral Presence & Broadcast Types
 *
 * Distinct from the persisted VCS op log: realtime messages are ephemeral,
 * mesh-broadcast, and never written to the causal history. This is the right
 * home for high-frequency, disposable signals like cursors and presence, plus
 * fire-and-forget broadcast (chat, live text edits).
 *
 * The transport is a broadcast mesh: `send` delivers a message to every other
 * peer sharing the channel. Senders never receive their own messages.
 */

export const REALTIME_PROTOCOL = 1 as const;

/** Arbitrary per-peer presence state (name, avatar, color, cursor, …). */
export type PresenceState = Record<string, unknown>;

export interface PresencePeer<P extends PresenceState = PresenceState> {
  /** Peer/client identity. */
  id: string;
  /** Latest published presence state. */
  state: P;
  /** Epoch ms of the last presence heartbeat we saw. */
  lastSeen: number;
  /** True for the local peer. */
  self: boolean;
}

/** A received broadcast on a channel. */
export interface BroadcastEvent {
  from: string;
  channel: string;
  event: string;
  payload: unknown;
  ts: number;
  /**
   * Stable message identity. Assigned by the sender and carried unchanged to
   * every replica, so dedup is order-independent (a grow-only set). Present on
   * all broadcasts emitted by {@link RealtimeRoom.broadcast}; may be absent on
   * legacy frames.
   */
  id?: string;
}

export type RealtimeMessage<P extends PresenceState = PresenceState> =
  | { v: 1; t: 'hello'; from: string }
  | { v: 1; t: 'presence'; from: string; state: P; ts: number }
  | { v: 1; t: 'bye'; from: string; ts: number }
  | {
      v: 1;
      t: 'msg';
      from: string;
      channel: string;
      event: string;
      payload: unknown;
      ts: number;
      /** Stable per-message id (dedup key for grow-only replay). */
      id?: string;
    }
  /** Relay welcome: re-deliver persisted session state to a new connection. */
  | {
      v: 1;
      t: 'replay';
      from: string;
      messages: RealtimeMessage<P>[];
    };

/**
 * Broadcast mesh transport. Implementations: {@link MemoryHub} (in-process /
 * tests / side-by-side panes), {@link BroadcastChannelTransport} (serverless
 * cross-tab in one browser), and {@link WebSocketRelayTransport} (relay-backed
 * cross-browser rooms).
 */
export interface RealtimeTransport {
  /** Local peer identity on this transport. */
  readonly id: string;
  /** Broadcast a message to all other peers. Never echoes to the sender. */
  send(message: RealtimeMessage): void;
  /** Register an inbound message handler. Returns an unsubscribe fn. */
  onMessage(handler: (message: RealtimeMessage) => void): () => void;
  /** Tear down the transport. */
  close(): void;
}
