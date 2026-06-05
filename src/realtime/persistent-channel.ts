/**
 * PersistentChannel — a durable, convergent view over one broadcast channel.
 *
 * Wraps a {@link RealtimeRoom} channel as a **grow-only set** keyed by message
 * id: every record is deduplicated by id and ordered by `(ts, id)`, so the same
 * message arriving from any source (optimistic local send, live broadcast, or a
 * relay replay on reconnect) lands exactly once and in a stable order.
 *
 * There is no single source of truth. Each peer holds its own replica (a
 * pluggable {@link ChannelStore} — `localStorage`, IndexedDB, …) and the relay
 * holds another. They converge on reconnect because union + id-dedup is
 * commutative and idempotent. The store is an instant first-paint cache, not an
 * authority: a refresh repaints from it immediately, then merges whatever the
 * relay replays.
 *
 *   const chat = PersistentChannel.create(room, 'chat', {
 *     store: localStorageChannelStore(`chat:${roomUrl}`),
 *     resolveMeta: (e) => presenceById()[e.from],   // capture name/color
 *   });
 *
 *   chat.messages.subscribe((msgs) => render(msgs)); // deduped + sorted
 *   chat.send({ text });                             // optimistic + broadcast + persist
 *
 * Only the channel's "message" event (configurable) is persisted; transient
 * events like typing indicators stay the caller's concern via `room.on`.
 */

import { Signal } from '../client/reactive.js';
import type { RealtimeRoom } from './room.js';
import type { BroadcastEvent } from './types.js';

/** A persisted member of the grow-only set. */
export interface ChannelRecord<T = unknown> {
  /** Stable dedup key (sender-assigned message id). */
  id: string;
  /** Originating peer id. */
  from: string;
  /** Sender clock (epoch ms) — primary sort key. */
  ts: number;
  /** Application payload (e.g. `{ text }`). */
  payload: T;
  /** Optional sender metadata captured at send/receipt (name, color, …). */
  meta?: Record<string, unknown>;
}

/**
 * Durable backing store for a peer's local replica. Implementations may be sync
 * (`localStorage`) or async (IndexedDB/OPFS); `load` may return a promise.
 */
export interface ChannelStore<T = unknown> {
  load(): ChannelRecord<T>[] | Promise<ChannelRecord<T>[]>;
  save(records: ChannelRecord<T>[]): void | Promise<void>;
}

export interface PersistentChannelOptions<T = unknown> {
  /** Broadcast event name treated as a persisted message. Default `'message'`. */
  event?: string;
  /** Durable replica for this peer. Omit for in-memory only. */
  store?: ChannelStore<T>;
  /** Keep at most the N most recent records. Default 200. */
  max?: number;
  /** Capture sender metadata for an inbound message (e.g. from presence). */
  resolveMeta?: (event: BroadcastEvent) => Record<string, unknown> | undefined;
  /** Injectable clock for local sends. Default `Date.now`. */
  now?: () => number;
}

export const DEFAULT_MAX_RECORDS = 200;

export class PersistentChannel<T = unknown> {
  /** Reactive, deduped, `(ts, id)`-sorted message list. */
  readonly messages = new Signal<ChannelRecord<T>[]>([]);

  private readonly room: RealtimeRoom;
  private readonly channel: string;
  private readonly event: string;
  private readonly store?: ChannelStore<T>;
  private readonly max: number;
  private readonly resolveMeta?: (
    event: BroadcastEvent,
  ) => Record<string, unknown> | undefined;
  private readonly now: () => number;

  private records: ChannelRecord<T>[] = [];
  private byId = new Map<string, ChannelRecord<T>>();
  private unsubscribe: () => void;
  private disposed = false;

  private constructor(
    room: RealtimeRoom,
    channel: string,
    opts: PersistentChannelOptions<T>,
  ) {
    this.room = room;
    this.channel = channel;
    this.event = opts.event ?? 'message';
    this.store = opts.store;
    this.max = opts.max ?? DEFAULT_MAX_RECORDS;
    this.resolveMeta = opts.resolveMeta;
    this.now = opts.now ?? (() => Date.now());

    // Subscribe first so a buffered relay replay flushes into us; then hydrate
    // the local cache. Order is irrelevant — dedup makes the merge commutative.
    this.unsubscribe = this.room.on(this.channel, this.handleEvent);
    void this.hydrate();
  }

  /** Create a persistent view over `room`'s `channel`. */
  static create<T = unknown>(
    room: RealtimeRoom,
    channel: string,
    opts: PersistentChannelOptions<T> = {},
  ): PersistentChannel<T> {
    return new PersistentChannel<T>(room, channel, opts);
  }

  /**
   * Optimistically record locally, broadcast to peers, and persist. Returns the
   * stable message id. The room dedups its own id, so the broadcast never
   * echoes back into this channel.
   */
  send(payload: T, meta?: Record<string, unknown>): string {
    const id = this.room.broadcast(this.channel, this.event, payload);
    this.commitOne({ id, from: this.room.selfId, ts: this.now(), payload, meta });
    return id;
  }

  /** Current records (deduped + sorted). Read without subscribing. */
  snapshot(): ChannelRecord<T>[] {
    return this.messages.peek();
  }

  /** Stop listening. Does not clear the durable store. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
  }

  // --- internal --------------------------------------------------------------

  private handleEvent = (event: BroadcastEvent): void => {
    if (event.event !== this.event) return;
    this.commitOne({
      id: event.id ?? `${event.from}:${event.ts}`,
      from: event.from,
      ts: event.ts,
      payload: event.payload as T,
      meta: this.resolveMeta?.(event),
    });
  };

  private async hydrate(): Promise<void> {
    if (!this.store) return;
    let loaded: ChannelRecord<T>[];
    try {
      loaded = await this.store.load();
    } catch {
      return; // corrupt/unavailable cache — relay replay rebuilds it
    }
    if (this.disposed) return;
    let changed = false;
    for (const rec of loaded) {
      if (this.add(rec)) changed = true;
    }
    if (changed) this.commit();
  }

  /** Insert one record and publish if it was new. */
  private commitOne(rec: ChannelRecord<T>): void {
    if (this.add(rec)) this.commit();
  }

  /** Pure insert with dedup + cap. Returns true when a new record was added. */
  private add(rec: ChannelRecord<T>): boolean {
    if (!rec || !rec.id || this.byId.has(rec.id)) return false;
    this.byId.set(rec.id, rec);
    this.records.push(rec);
    this.records.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    if (this.records.length > this.max) {
      const evicted = this.records.splice(0, this.records.length - this.max);
      for (const m of evicted) this.byId.delete(m.id);
    }
    return true;
  }

  private commit(): void {
    this.messages.value = [...this.records];
    void this.store?.save(this.records);
  }
}

/**
 * A {@link ChannelStore} backed by Web Storage (`localStorage` by default).
 * Degrades to in-memory if storage is unavailable or over quota — durability is
 * best-effort, since the relay replica remains authoritative for catch-up.
 */
export function localStorageChannelStore<T = unknown>(
  key: string,
  storage: Storage | undefined = (globalThis as { localStorage?: Storage })
    .localStorage,
): ChannelStore<T> {
  return {
    load() {
      try {
        const raw = storage?.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as ChannelRecord<T>[]) : [];
      } catch {
        return [];
      }
    },
    save(records) {
      try {
        storage?.setItem(key, JSON.stringify(records));
      } catch {
        /* quota exceeded / disabled — best-effort */
      }
    },
  };
}
