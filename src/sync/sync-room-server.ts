import type { SyncMessage } from './types.js';
import {
  SyncRoomCore,
  DEFAULT_SNAPSHOT_MAX_OPS,
  type SyncRoomSnapshot,
} from './room-core.js';

export interface SyncRoomServerConnection {
  peerId: string;
  send(message: SyncMessage): void | Promise<void>;
}

export interface SyncRoomServerOptions {
  roomId?: string;
  roomName?: string;
  /** Send a welcome snapshot when a peer connects. Default: true. */
  welcomeSnapshot?: boolean;
  welcomeSnapshotMaxOps?: number;
}

/**
 * Framework-agnostic room server wrapping {@link SyncRoomCore}.
 *
 * Use from PartyKit, Node WebSocket servers, or tests. Routes inbound sync
 * messages through the canonical room log and delivers responses to peers.
 */
export class SyncRoomServer {
  private core: SyncRoomCore;
  private connections = new Map<string, SyncRoomServerConnection>();
  private welcomeSnapshot: boolean;
  private welcomeSnapshotMaxOps: number;

  constructor(opts: SyncRoomServerOptions = {}) {
    this.core = new SyncRoomCore(opts.roomId, opts.roomName);
    this.welcomeSnapshot = opts.welcomeSnapshot !== false;
    this.welcomeSnapshotMaxOps =
      opts.welcomeSnapshotMaxOps ?? DEFAULT_SNAPSHOT_MAX_OPS;
  }

  getRoomId(): string {
    return this.core.getRoomPeer().id;
  }

  getOpCount(): number {
    return this.core.getOpCount();
  }

  getOps() {
    return this.core.getOps();
  }

  buildSnapshot(maxOps?: number): SyncRoomSnapshot {
    return this.core.buildSnapshot(maxOps);
  }

  /** Register a connected peer and optionally send a welcome snapshot. */
  async connect(conn: SyncRoomServerConnection): Promise<void> {
    this.core.connectPeer(conn.peerId);
    this.connections.set(conn.peerId, conn);

    if (this.welcomeSnapshot) {
      await this.sendSnapshot(conn.peerId, this.welcomeSnapshotMaxOps);
    }
  }

  disconnect(peerId: string): void {
    this.core.disconnectPeer(peerId);
    this.connections.delete(peerId);
  }

  /** Route an inbound sync message from a peer. */
  async handleMessage(fromPeerId: string, message: SyncMessage): Promise<void> {
    const deliveries = await this.core.receive(fromPeerId, message);
    await this.deliverAll(deliveries);
  }

  /** Push a tail snapshot to a peer without an inbound message. */
  async sendSnapshot(
    peerId: string,
    maxOps = DEFAULT_SNAPSHOT_MAX_OPS,
  ): Promise<void> {
    const deliveries = this.core.snapshotDeliveries(peerId, maxOps);
    await this.deliverAll(deliveries);
  }

  private async deliverAll(
    deliveries: Array<{ peerId: string; message: SyncMessage }>,
  ): Promise<void> {
    for (const delivery of deliveries) {
      const conn = this.connections.get(delivery.peerId);
      if (!conn) continue;
      await conn.send(delivery.message);
    }
  }
}
