/**
 * In-Memory Sync Transport
 *
 * A simple in-memory transport for testing and local multi-engine sync.
 * Messages are delivered synchronously between connected peers.
 */

import type { SyncTransport, SyncMessage, PeerId } from './types.js';

// ---------------------------------------------------------------------------
// In-memory transport
// ---------------------------------------------------------------------------

export class MemoryTransport implements SyncTransport {
  private peerId: string;
  private peerName: string;
  private handlers: ((message: SyncMessage) => void)[] = [];
  private connectedPeers: Map<string, MemoryTransport> = new Map();

  constructor(peerId: string, peerName: string = peerId) {
    this.peerId = peerId;
    this.peerName = peerName;
  }

  /**
   * Connect two transports so they can exchange messages.
   */
  static connect(a: MemoryTransport, b: MemoryTransport): void {
    a.connectedPeers.set(b.peerId, b);
    b.connectedPeers.set(a.peerId, a);
  }

  /**
   * Disconnect two transports.
   */
  static disconnect(a: MemoryTransport, b: MemoryTransport): void {
    a.connectedPeers.delete(b.peerId);
    b.connectedPeers.delete(a.peerId);
  }

  async send(peerId: string, message: SyncMessage): Promise<void> {
    const peer = this.connectedPeers.get(peerId);
    if (!peer) {
      throw new Error(`Peer not connected: ${peerId}`);
    }
    // Deliver to peer's handlers
    for (const handler of peer.handlers) {
      handler(message);
    }
  }

  onMessage(handler: (message: SyncMessage) => void): void {
    this.handlers.push(handler);
  }

  peers(): PeerId[] {
    return [...this.connectedPeers.entries()].map(([id, transport]) => ({
      id,
      name: transport.peerName,
    }));
  }

  getPeerId(): string {
    return this.peerId;
  }
}
