import type {
  PeerId,
  SyncMessage,
  SyncMessageHandler,
  SyncTransport,
} from './types.js';
import {
  SyncRoomCore,
  type SyncRoomAppendRejection,
  type SyncRoomAppendResult,
} from './room-core.js';

export type MemorySyncRoomAppendRejection = SyncRoomAppendRejection;
export type MemorySyncRoomAppendResult = SyncRoomAppendResult;

/**
 * In-process room relay that models a PartyKit room for sync tests.
 *
 * The room keeps a canonical catch-up log, asks clients for missing ops,
 * serves catch-up requests, and broadcasts newly accepted ops.
 */
export class MemorySyncRoom {
  private core: SyncRoomCore;
  private transports = new Map<string, MemoryRoomTransport>();

  constructor(roomId = 'room', roomName = roomId) {
    this.core = new SyncRoomCore(roomId, roomName);
  }

  connectPeer(peerId: string, peerName = peerId): MemoryRoomTransport {
    this.core.connectPeer(peerId, peerName);
    const transport = new MemoryRoomTransport(this, peerId, peerName);
    this.transports.set(peerId, transport);
    return transport;
  }

  disconnectPeer(peerId: string): void {
    this.core.disconnectPeer(peerId);
    this.transports.delete(peerId);
  }

  getRoomPeer(): PeerId {
    return this.core.getRoomPeer();
  }

  peersFor(peerId: string): PeerId[] {
    return this.core.peersFor(peerId);
  }

  getOps() {
    return this.core.getOps();
  }

  getOpCount(): number {
    return this.core.getOpCount();
  }

  async receive(fromPeerId: string, message: SyncMessage): Promise<void> {
    const deliveries = await this.core.receive(fromPeerId, message);
    for (const delivery of deliveries) {
      await this.deliver(delivery.peerId, delivery.message);
    }
  }

  private async deliver(peerId: string, message: SyncMessage): Promise<void> {
    const transport = this.transports.get(peerId);
    if (!transport) {
      throw new Error(`Peer not connected to room: ${peerId}`);
    }
    await transport.deliver(message);
  }
}

export class MemoryRoomTransport implements SyncTransport {
  private room: MemorySyncRoom;
  private peerId: string;
  private peerName: string;
  private handlers: SyncMessageHandler[] = [];

  constructor(room: MemorySyncRoom, peerId: string, peerName = peerId) {
    this.room = room;
    this.peerId = peerId;
    this.peerName = peerName;
  }

  async send(peerId: string, message: SyncMessage): Promise<void> {
    if (peerId !== this.room.getRoomPeer().id) {
      throw new Error(`Peer not connected through room: ${peerId}`);
    }
    await this.room.receive(this.peerId, message);
  }

  onMessage(handler: SyncMessageHandler): void {
    this.handlers.push(handler);
  }

  peers(): PeerId[] {
    return this.room.peersFor(this.peerId);
  }

  getPeerId(): string {
    return this.peerId;
  }

  getPeerName(): string {
    return this.peerName;
  }

  async deliver(message: SyncMessage): Promise<void> {
    for (const handler of this.handlers) {
      await handler(message);
    }
  }
}
