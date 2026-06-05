/**
 * RealtimeRoom — presence + broadcast over a {@link RealtimeTransport}.
 *
 *   const room = RealtimeRoom.join({
 *     transport: new BroadcastChannelTransport({ id, channel: 'demo' }),
 *     initialPresence: { name: 'Ada', color: '#6d5bfa' },
 *   });
 *
 *   room.onPresence((peers) => renderAvatars(peers));
 *   room.setPresence({ cursor: { x, y } });
 *   room.on('chat', (e) => appendMessage(e.payload));
 *   room.broadcast('chat', 'message', { text: 'hi' });
 *
 * Presence is heartbeat-based: peers re-announce on an interval and are pruned
 * after a timeout. Transports with explicit teardown (MemoryHub) also emit an
 * immediate `bye` on {@link RealtimeRoom.leave}.
 */

import { Signal } from '../client/reactive.js';
import type {
  BroadcastEvent,
  PresencePeer,
  PresenceState,
  RealtimeMessage,
  RealtimeTransport,
} from './types.js';

export interface RealtimeRoomOptions<P extends PresenceState> {
  transport: RealtimeTransport;
  /** Initial presence for the local peer. */
  initialPresence?: P;
  /** Heartbeat interval (ms). Default 2000. Set 0 to disable timers. */
  heartbeatMs?: number;
  /** Peer expiry after no heartbeat (ms). Default 6000. */
  timeoutMs?: number;
  /** Injectable clock for tests. Default `Date.now`. */
  now?: () => number;
}

type BroadcastHandler = (event: BroadcastEvent) => void;

export class RealtimeRoom<P extends PresenceState = PresenceState> {
  readonly id: string;
  private transport: RealtimeTransport;
  private myState: P;
  private peers = new Map<string, PresencePeer<P>>();
  /** Sender timestamps from presence messages (not local lastSeen). */
  private presenceTsByPeer = new Map<string, number>();
  private channelHandlers = new Map<string, Set<BroadcastHandler>>();
  private _presence = new Signal<PresencePeer<P>[]>([]);
  private now: () => number;
  private heartbeatMs: number;
  private timeoutMs: number;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  private closed = false;
  private pendingReplay: RealtimeMessage[] | null = null;
  /** Ids of broadcasts already delivered — keeps replay idempotent (G-Set). */
  private seenMsgIds = new Set<string>();

  private constructor(opts: RealtimeRoomOptions<P>) {
    this.transport = opts.transport;
    this.id = opts.transport.id;
    this.myState = (opts.initialPresence ?? ({} as P)) as P;
    this.now = opts.now ?? (() => Date.now());
    this.heartbeatMs = opts.heartbeatMs ?? 2000;
    this.timeoutMs = opts.timeoutMs ?? 6000;

    this.unsubscribe = this.transport.onMessage((m) => this.handle(m));
    this.recomputePresence();
  }

  /** Join a room and announce presence. */
  static join<P extends PresenceState = PresenceState>(
    opts: RealtimeRoomOptions<P>,
  ): RealtimeRoom<P> {
    const room = new RealtimeRoom<P>(opts);
    room.announceHello();
    room.announcePresence();
    room.startHeartbeat();
    return room;
  }

  // -------------------------------------------------------------------------
  // Presence
  // -------------------------------------------------------------------------

  /** The local peer id. */
  get selfId(): string {
    return this.id;
  }

  /** Current local presence state. */
  getSelfState(): P {
    return this.myState;
  }

  /** Merge a partial update into local presence and broadcast it. */
  setPresence(partial: Partial<P>): void {
    this.myState = { ...this.myState, ...partial };
    this.recomputePresence();
    this.announcePresence();
  }

  /** Replace local presence wholesale and broadcast it. */
  replacePresence(state: P): void {
    this.myState = state;
    this.recomputePresence();
    this.announcePresence();
  }

  /** All peers including self (self first). */
  getPresence(): PresencePeer<P>[] {
    return this._presence.value;
  }

  /** Peers excluding self. */
  getOthers(): PresencePeer<P>[] {
    return this._presence.value.filter((p) => !p.self);
  }

  /** Subscribe to presence changes. Called immediately with current peers. */
  onPresence(cb: (peers: PresencePeer<P>[]) => void): () => void {
    const unsub = this._presence.subscribe(cb);
    this.flushPendingReplay();
    return unsub;
  }

  /** Reactive presence signal (for framework adapters). */
  get presenceSignal(): Signal<PresencePeer<P>[]> {
    return this._presence;
  }

  // -------------------------------------------------------------------------
  // Broadcast pub/sub
  // -------------------------------------------------------------------------

  /**
   * Fire-and-forget broadcast to all other peers on a channel. Returns the
   * stable message id assigned to this broadcast — persist it alongside an
   * optimistic local render so an echoed copy (relay replay, reconnect) is
   * deduplicated by id rather than re-rendered.
   */
  broadcast(channel: string, event: string, payload: unknown): string {
    const id = this.newMsgId();
    if (this.closed) return id;
    this.seenMsgIds.add(id);
    this.transport.send({
      v: 1,
      t: 'msg',
      from: this.id,
      channel,
      event,
      payload,
      ts: this.now(),
      id,
    });
    return id;
  }

  private newMsgId(): string {
    const rand =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return `${this.id}:${rand}`;
  }

  /** Subscribe to broadcasts on a channel. Returns an unsubscribe fn. */
  on(channel: string, handler: BroadcastHandler): () => void {
    let set = this.channelHandlers.get(channel);
    if (!set) {
      set = new Set();
      this.channelHandlers.set(channel, set);
    }
    set.add(handler);
    this.flushPendingReplay();
    return () => {
      set!.delete(handler);
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Apply a relay replay batch (chat history, text snapshot, presence).
   * Used when reconnecting to a hub with {@link RelayPersistence}.
   */
  replay(messages: RealtimeMessage[]): void {
    for (const message of messages) {
      this.integrateRemote(message);
    }
  }

  /** Announce departure and tear down. */
  leave(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.transport.send({ v: 1, t: 'bye', from: this.id, ts: this.now() });
    } catch {
      /* ignore */
    }
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.unsubscribe();
    this.transport.close();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private handle(message: RealtimeMessage): void {
    if (this.closed) return;
    if (message.t === 'replay') {
      this.pendingReplay = message.messages;
      this.flushPendingReplay();
      return;
    }
    if (message.from === this.id) return;
    this.integrateRemote(message);
  }

  private flushPendingReplay(): void {
    if (!this.pendingReplay || this.pendingReplay.length === 0) return;
    if (!this.hasActiveSubscribers()) return;
    const batch = this.pendingReplay;
    this.pendingReplay = null;
    this.replay(batch);
  }

  private hasActiveSubscribers(): boolean {
    if (this._presence.hasSubscribers()) return true;
    for (const handlers of this.channelHandlers.values()) {
      if (handlers.size > 0) return true;
    }
    return false;
  }

  private integrateRemote(message: RealtimeMessage): void {
    switch (message.t) {
      case 'hello':
        this.announcePresence();
        break;
      case 'presence':
        this.upsertPeer(message.from, message.state as P, message.ts);
        break;
      case 'bye':
        if (this.peers.delete(message.from)) {
          this.presenceTsByPeer.delete(message.from);
          this.recomputePresence();
        }
        break;
      case 'msg': {
        // Grow-only dedup: an id we've already delivered (live or replayed) is
        // dropped, so reconnect/replay is idempotent and order-independent. We
        // only mark an id seen once it's actually delivered — a frame that
        // arrives before any subscriber stays eligible for later replay.
        if (message.id !== undefined && this.seenMsgIds.has(message.id)) return;
        const handlers = this.channelHandlers.get(message.channel);
        if (!handlers || handlers.size === 0) return;
        if (message.id !== undefined) this.seenMsgIds.add(message.id);
        const event: BroadcastEvent = {
          from: message.from,
          channel: message.channel,
          event: message.event,
          payload: message.payload,
          ts: message.ts,
          id: message.id,
        };
        for (const handler of handlers) {
          try {
            handler(event);
          } catch {
            /* ignore */
          }
        }
        break;
      }
      case 'replay':
        break;
    }
  }

  private upsertPeer(id: string, state: P, ts: number): void {
    const prevTs = this.presenceTsByPeer.get(id) ?? 0;
    if (ts < prevTs) {
      // Out-of-order delivery; refresh liveness but keep newer state.
      const existing = this.peers.get(id);
      if (existing) existing.lastSeen = this.now();
      return;
    }
    this.presenceTsByPeer.set(id, ts);
    this.peers.set(id, { id, state, lastSeen: this.now(), self: false });
    this.recomputePresence();
  }

  private announceHello(): void {
    this.transport.send({ v: 1, t: 'hello', from: this.id });
  }

  private announcePresence(): void {
    this.transport.send({
      v: 1,
      t: 'presence',
      from: this.id,
      state: this.myState,
      ts: this.now(),
    });
  }

  private startHeartbeat(): void {
    if (
      this.heartbeatMs <= 0 ||
      typeof setInterval !== 'function'
    ) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      this.announcePresence();
      this.pruneExpired();
    }, this.heartbeatMs);
  }

  private pruneExpired(): void {
    const cutoff = this.now() - this.timeoutMs;
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (peer.lastSeen < cutoff) {
        this.peers.delete(id);
        this.presenceTsByPeer.delete(id);
        changed = true;
      }
    }
    if (changed) this.recomputePresence();
  }

  private recomputePresence(): void {
    const self: PresencePeer<P> = {
      id: this.id,
      state: this.myState,
      lastSeen: this.now(),
      self: true,
    };
    const others = [...this.peers.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    this._presence.value = [self, ...others];
  }
}
