/**
 * Serverless cross-tab realtime transport using the browser BroadcastChannel
 * API. All tabs/windows of the same origin that open a channel with the same
 * name form a broadcast mesh — no server required.
 *
 * BroadcastChannel does not deliver a message back to the posting channel
 * object, so the mesh semantics (no self-echo) hold naturally.
 */

import type { RealtimeMessage, RealtimeTransport } from './types.js';

interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  addEventListener?(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener?(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
}

type BroadcastChannelCtor = new (name: string) => BroadcastChannelLike;

export interface BroadcastChannelTransportOptions {
  /** Local peer identity. */
  id: string;
  /** Channel name — all peers in the room share this. */
  channel: string;
  /** Injectable implementation for tests / non-browser hosts. */
  BroadcastChannelImpl?: BroadcastChannelCtor;
}

export class BroadcastChannelTransport implements RealtimeTransport {
  readonly id: string;
  private bc: BroadcastChannelLike;
  private handlers = new Set<(message: RealtimeMessage) => void>();
  private closed = false;

  constructor(opts: BroadcastChannelTransportOptions) {
    this.id = opts.id;

    const Impl =
      opts.BroadcastChannelImpl ??
      (globalThis as { BroadcastChannel?: BroadcastChannelCtor })
        .BroadcastChannel;
    if (!Impl) {
      throw new Error(
        'BroadcastChannelTransport requires BroadcastChannel or opts.BroadcastChannelImpl.',
      );
    }

    this.bc = new Impl(opts.channel);
    const onIncoming = (event: { data: unknown }) => {
      const message = event.data as RealtimeMessage;
      if (!message || typeof message !== 'object' || message.v !== 1) return;
      for (const handler of this.handlers) {
        try {
          handler(message);
        } catch {
          /* ignore */
        }
      }
    };
    if (this.bc.addEventListener) {
      this.bc.addEventListener('message', onIncoming);
    } else {
      this.bc.onmessage = onIncoming;
    }
  }

  send(message: RealtimeMessage): void {
    if (this.closed) return;
    this.bc.postMessage(message);
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
    this.handlers.clear();
    try {
      this.bc.close();
    } catch {
      /* ignore */
    }
  }
}
