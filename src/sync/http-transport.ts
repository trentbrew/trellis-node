/**
 * HTTP Sync Transport
 *
 * Implements SyncTransport over HTTP for network-based peer sync.
 * Uses a simple JSON REST protocol:
 *   POST /sync/message — send a sync message
 *   GET  /sync/peers   — list connected peers
 *
 * The server side is a lightweight Bun HTTP server.
 * The client side uses fetch() for outbound messages.
 *
 * @module trellis/sync
 */

import type {
  SyncTransport,
  SyncMessage,
  SyncMessageHandler,
  PeerId,
} from './types.js';

// ---------------------------------------------------------------------------
// HTTP Transport (Client)
// ---------------------------------------------------------------------------

export class HttpSyncTransport implements SyncTransport {
  private localPeerId: string;
  private peerUrls: Map<string, string> = new Map();
  private messageHandler: SyncMessageHandler | null = null;
  private knownPeers: Map<string, PeerId> = new Map();

  constructor(localPeerId: string) {
    this.localPeerId = localPeerId;
  }

  /**
   * Add a remote peer by URL (e.g. "http://192.168.1.10:4200").
   */
  addPeer(peerId: string, url: string, name?: string): void {
    this.peerUrls.set(peerId, url);
    this.knownPeers.set(peerId, {
      id: peerId,
      name: name ?? peerId,
      lastSeen: new Date().toISOString(),
    });
  }

  /**
   * Remove a remote peer.
   */
  removePeer(peerId: string): void {
    this.peerUrls.delete(peerId);
    this.knownPeers.delete(peerId);
  }

  async send(peerId: string, message: SyncMessage): Promise<void> {
    const url = this.peerUrls.get(peerId);
    if (!url) throw new Error(`Unknown peer "${peerId}". Add it with addPeer() first.`);

    const resp = await fetch(`${url}/sync/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!resp.ok) {
      throw new Error(`Sync message to ${peerId} failed: ${resp.status} ${resp.statusText}`);
    }

    // Check if the response contains a reply message
    const contentType = resp.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const reply = await resp.json();
      if (reply && reply.type && this.messageHandler) {
        await this.messageHandler(reply as SyncMessage);
      }
    }
  }

  onMessage(handler: SyncMessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Receive a message (called by the HTTP server handler).
   */
  async receiveMessage(message: SyncMessage): Promise<void> {
    // Track peer
    this.knownPeers.set(message.peerId, {
      id: message.peerId,
      name: message.peerId,
      lastSeen: new Date().toISOString(),
    });

    if (this.messageHandler) {
      await this.messageHandler(message);
    }
  }

  peers(): PeerId[] {
    return [...this.knownPeers.values()];
  }

  getLocalPeerId(): string {
    return this.localPeerId;
  }
}

// ---------------------------------------------------------------------------
// HTTP Sync Server (creates Bun.serve handler)
// ---------------------------------------------------------------------------

export interface HttpSyncServerConfig {
  port: number;
  transport: HttpSyncTransport;
}

/**
 * Create a Bun-compatible HTTP request handler for sync messages.
 * Can be used with Bun.serve() or as middleware.
 */
export function createSyncHandler(transport: HttpSyncTransport): (req: Request) => Response | null {
  return (req: Request): Response | null => {
    const url = new URL(req.url);

    if (url.pathname === '/sync/message' && req.method === 'POST') {
      // Handle async parsing synchronously for Bun
      return new Response(
        req.json().then(async (body: any) => {
          await transport.receiveMessage(body as SyncMessage);
          return JSON.stringify({ ok: true });
        }) as any,
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.pathname === '/sync/peers' && req.method === 'GET') {
      return new Response(
        JSON.stringify({
          localPeerId: transport.getLocalPeerId(),
          peers: transport.peers(),
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    return null; // Not a sync route
  };
}
