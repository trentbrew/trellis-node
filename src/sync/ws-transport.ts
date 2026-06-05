/**
 * WebSocket Sync Transport
 *
 * Implements SyncTransport over WebSocket for real-time peer sync.
 * Uses Bun's native WebSocket support for both server and client.
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
// WebSocket Transport
// ---------------------------------------------------------------------------

export class WebSocketSyncTransport implements SyncTransport {
  private localPeerId: string;
  private connections: Map<string, WebSocket> = new Map();
  private knownPeers: Map<string, PeerId> = new Map();
  private messageHandler: SyncMessageHandler | null = null;

  constructor(localPeerId: string) {
    this.localPeerId = localPeerId;
  }

  /**
   * Connect to a remote peer's WebSocket endpoint.
   */
  async connect(peerId: string, url: string, name?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        this.connections.set(peerId, ws);
        this.knownPeers.set(peerId, {
          id: peerId,
          name: name ?? peerId,
          lastSeen: new Date().toISOString(),
        });
        resolve();
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as SyncMessage;
          this.knownPeers.set(msg.peerId, {
            id: msg.peerId,
            name: msg.peerId,
            lastSeen: new Date().toISOString(),
          });
          if (this.messageHandler) {
            await this.messageHandler(msg);
          }
        } catch {}
      };

      ws.onclose = () => {
        this.connections.delete(peerId);
      };

      ws.onerror = (err) => {
        reject(new Error(`WebSocket connection to ${peerId} failed`));
      };
    });
  }

  /**
   * Accept an incoming WebSocket connection (server side).
   */
  acceptConnection(peerId: string, ws: WebSocket): void {
    this.connections.set(peerId, ws);
    this.knownPeers.set(peerId, {
      id: peerId,
      name: peerId,
      lastSeen: new Date().toISOString(),
    });

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as SyncMessage;
        this.knownPeers.set(msg.peerId, {
          id: msg.peerId,
          name: msg.peerId,
          lastSeen: new Date().toISOString(),
        });
        if (this.messageHandler) {
          await this.messageHandler(msg);
        }
      } catch {}
    };

    ws.onclose = () => {
      this.connections.delete(peerId);
    };
  }

  async send(peerId: string, message: SyncMessage): Promise<void> {
    const ws = this.connections.get(peerId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`No open connection to peer "${peerId}".`);
    }
    ws.send(JSON.stringify(message));
  }

  onMessage(handler: SyncMessageHandler): void {
    this.messageHandler = handler;
  }

  peers(): PeerId[] {
    return [...this.knownPeers.values()];
  }

  /**
   * Disconnect from a peer.
   */
  disconnect(peerId: string): void {
    const ws = this.connections.get(peerId);
    if (ws) {
      ws.close();
      this.connections.delete(peerId);
    }
  }

  /**
   * Disconnect from all peers.
   */
  disconnectAll(): void {
    for (const [id, ws] of this.connections) {
      ws.close();
    }
    this.connections.clear();
  }

  /**
   * Check if connected to a specific peer.
   */
  isConnected(peerId: string): boolean {
    const ws = this.connections.get(peerId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  getLocalPeerId(): string {
    return this.localPeerId;
  }
}
