/**
 * Browser transport that relays {@link RealtimeMessage} frames through a
 * shared WebSocket hub (demo server or custom relay). Unlike
 * {@link BroadcastChannelTransport}, this works across different browsers on
 * the same origin.
 */

import type { RealtimeMessage, RealtimeTransport } from './types.js';

export interface WebSocketRelayTransportOptions {
  /** Local peer identity. */
  id: string;
  /** Hub URL, e.g. `ws://localhost:8231/rt`. */
  url: string;
  /** Injectable WebSocket for tests. */
  WebSocketImpl?: typeof WebSocket;
}

export class WebSocketRelayTransport implements RealtimeTransport {
  readonly id: string;
  private ws: WebSocket;
  private handlers = new Set<(message: RealtimeMessage) => void>();
  private closed = false;
  private pending: RealtimeMessage[] = [];

  constructor(opts: WebSocketRelayTransportOptions) {
    this.id = opts.id;
    const WS = opts.WebSocketImpl ?? globalThis.WebSocket;
    if (!WS) {
      throw new Error(
        'WebSocketRelayTransport requires WebSocket or opts.WebSocketImpl.',
      );
    }

    this.ws = new WS(opts.url);
    this.ws.addEventListener('open', () => this.flushPending());
    this.ws.addEventListener('message', (event) => {
      let message: RealtimeMessage;
      try {
        message = JSON.parse(String(event.data)) as RealtimeMessage;
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
    this.ws.addEventListener('close', () => {
      if (!this.closed) this.pending = [];
    });
  }

  send(message: RealtimeMessage): void {
    if (this.closed) return;
    // OPEN === 1 in browsers and in the `ws` package.
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(message));
      return;
    }
    this.pending.push(message);
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
    this.pending = [];
    this.handlers.clear();
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }

  private flushPending(): void {
    if (this.ws.readyState !== 1) return;
    const batch = this.pending.splice(0);
    for (const message of batch) {
      this.ws.send(JSON.stringify(message));
    }
  }
}
