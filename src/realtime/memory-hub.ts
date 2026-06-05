/**
 * In-process broadcast mesh for realtime presence/broadcast.
 *
 * Useful for tests and for "side-by-side" demos where several simulated peers
 * share one page. Each {@link MemoryRealtimeTransport} delivers messages to
 * every other transport on the same hub (never to itself).
 */

import type { RealtimeMessage, RealtimeTransport } from './types.js';

export class MemoryHub {
  private transports = new Set<MemoryRealtimeTransport>();

  /** Create a transport bound to this hub for the given peer id. */
  connect(id: string): MemoryRealtimeTransport {
    const transport = new MemoryRealtimeTransport(this, id);
    this.transports.add(transport);
    return transport;
  }

  /** Number of currently connected transports. */
  size(): number {
    return this.transports.size;
  }

  /** @internal */
  _broadcast(from: MemoryRealtimeTransport, message: RealtimeMessage): void {
    for (const transport of this.transports) {
      if (transport === from) continue;
      transport._deliver(message);
    }
  }

  /** @internal */
  _remove(transport: MemoryRealtimeTransport): void {
    this.transports.delete(transport);
  }
}

export class MemoryRealtimeTransport implements RealtimeTransport {
  readonly id: string;
  private hub: MemoryHub;
  private handlers = new Set<(message: RealtimeMessage) => void>();
  private closed = false;

  constructor(hub: MemoryHub, id: string) {
    this.hub = hub;
    this.id = id;
  }

  send(message: RealtimeMessage): void {
    if (this.closed) return;
    this.hub._broadcast(this, message);
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
    this.hub._remove(this);
    this.handlers.clear();
  }

  /** @internal */
  _deliver(message: RealtimeMessage): void {
    if (this.closed) return;
    for (const handler of this.handlers) {
      try {
        handler(message);
      } catch {
        /* ignore subscriber errors */
      }
    }
  }
}
