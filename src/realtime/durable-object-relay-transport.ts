/**
 * Browser transport for a hosted relay room — the paid-tier accelerator.
 *
 * Functionally a {@link WebSocketRelayTransport} with three additions a hosted
 * deployment needs: a room-aware URL convention, an auth token, and automatic
 * reconnect with backoff. The server it talks to is the same dumb fan-out +
 * disposable replay contract as {@link createRealtimeRelay} — whether that
 * server is a Cloudflare Durable Object, a self-hosted relay, or PartyKit is
 * irrelevant to this code. The name reflects the *recommended* hosted target
 * (DO: single-writer-per-object matches Trellis's per-graph causality), not a
 * hard dependency on it.
 *
 * Telos alignment: this is one swappable {@link RealtimeTransport} behind the
 * stable seam. Local/free presence uses {@link BroadcastChannelTransport}; this
 * is what you inject when "sync" is enabled. An Iroh gossip transport slots in
 * the same way later with zero client change.
 *
 *   new DurableObjectRelayTransport({
 *     id: peerId,
 *     url: 'wss://relay.example.com',
 *     room: 'doc:42',
 *     auth: sessionToken,
 *   });
 *
 * Reconnect self-heals presence for free: the room's heartbeat re-announces
 * local presence after the socket comes back, and this transport re-sends a
 * `hello` on every (re)open so the relay replays peers/chat tail immediately.
 */

import type { RealtimeMessage, RealtimeTransport } from './types.js';

interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

type SocketCtor = new (url: string) => SocketLike;

export interface DurableObjectRelayReconnect {
  /** Max reconnect attempts after an unexpected close. 0 = unlimited. Default 0. */
  maxAttempts?: number;
  /** Initial backoff (ms). Default 500. */
  baseDelayMs?: number;
  /** Max backoff (ms). Default 10_000. */
  maxDelayMs?: number;
}

export interface DurableObjectRelayTransportOptions {
  /** Local peer identity. */
  id: string;
  /**
   * Base relay URL, e.g. `wss://relay.example.com` or
   * `wss://x.partykit.dev/parties/main`. The room segment and auth token are
   * appended per {@link buildUrl} unless you pass a fully-formed URL and omit
   * `room`/`auth`.
   */
  url: string;
  /** Logical room id, appended as a path segment (`/{room}`) when set. */
  room?: string;
  /** Auth token, appended as `?token=` (or `&token=`) when set. */
  auth?: string;
  /**
   * Override URL assembly entirely (e.g. a different DO routing convention).
   * Receives the constructor options; returns the final `ws(s)://…` URL.
   */
  buildUrl?: (opts: { url: string; room?: string; auth?: string }) => string;
  /** Reconnect policy. Pass `false` to disable reconnect. */
  reconnect?: DurableObjectRelayReconnect | false;
  /** Cap on frames buffered while disconnected (oldest dropped). Default 128. */
  maxPending?: number;
  /** Injectable WebSocket for tests / non-browser hosts. */
  WebSocketImpl?: SocketCtor;
}

const DEFAULT_RECONNECT: Required<DurableObjectRelayReconnect> = {
  maxAttempts: 0,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
};

function defaultBuildUrl(opts: { url: string; room?: string; auth?: string }): string {
  let url = opts.url;
  if (opts.room) {
    url = `${url.replace(/\/$/, '')}/${encodeURIComponent(opts.room)}`;
  }
  if (opts.auth) {
    url += `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(opts.auth)}`;
  }
  return url;
}

export class DurableObjectRelayTransport implements RealtimeTransport {
  readonly id: string;
  private readonly url: string;
  private readonly WS: SocketCtor;
  private readonly reconnect: Required<DurableObjectRelayReconnect> | null;
  private readonly maxPending: number;

  private ws: SocketLike | null = null;
  private handlers = new Set<(message: RealtimeMessage) => void>();
  private pending: RealtimeMessage[] = [];
  private closed = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: DurableObjectRelayTransportOptions) {
    this.id = opts.id;
    const WS = opts.WebSocketImpl ?? (globalThis as { WebSocket?: SocketCtor }).WebSocket;
    if (!WS) {
      throw new Error(
        'DurableObjectRelayTransport requires WebSocket or opts.WebSocketImpl.',
      );
    }
    this.WS = WS;
    this.url = (opts.buildUrl ?? defaultBuildUrl)({
      url: opts.url,
      room: opts.room,
      auth: opts.auth,
    });
    this.reconnect =
      opts.reconnect === false
        ? null
        : { ...DEFAULT_RECONNECT, ...(opts.reconnect ?? {}) };
    this.maxPending = opts.maxPending ?? 128;
    this.open();
  }

  send(message: RealtimeMessage): void {
    if (this.closed) return;
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(message));
      return;
    }
    this.pending.push(message);
    if (this.pending.length > this.maxPending) {
      this.pending.splice(0, this.pending.length - this.maxPending);
    }
  }

  onMessage(handler: (message: RealtimeMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.pending = [];
    this.handlers.clear();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  private open(): void {
    if (this.closed) return;
    const ws = new this.WS(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (this.closed) return;
      this.attempts = 0;
      // Re-announce presence on (re)connect: a `hello` makes the relay replay
      // current peers + chat tail to us immediately, rather than waiting for
      // other peers' heartbeats.
      try {
        ws.send(JSON.stringify({ v: 1, t: 'hello', from: this.id }));
      } catch {
        /* ignore */
      }
      this.flushPending();
    });

    ws.addEventListener('message', (event: unknown) => {
      const data = (event as { data?: unknown }).data;
      let message: RealtimeMessage;
      try {
        message = JSON.parse(String(data)) as RealtimeMessage;
      } catch {
        return;
      }
      if (!message || typeof message !== 'object' || message.v !== 1) return;
      for (const handler of this.handlers) {
        try {
          handler(message);
        } catch {
          /* ignore */
        }
      }
    });

    ws.addEventListener('close', () => {
      if (this.ws === ws) this.ws = null;
      this.scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // `close` follows; reconnect is scheduled there.
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || !this.reconnect || this.reconnectTimer) return;
    if (this.reconnect.maxAttempts > 0 && this.attempts >= this.reconnect.maxAttempts) {
      return;
    }
    const delay = Math.min(
      this.reconnect.baseDelayMs * 2 ** this.attempts,
      this.reconnect.maxDelayMs,
    );
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
    this.reconnectTimer?.unref?.();
  }

  private flushPending(): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    const batch = this.pending.splice(0);
    for (const message of batch) {
      this.ws.send(JSON.stringify(message));
    }
  }
}
