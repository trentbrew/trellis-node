import { isVcsOpKind, verifyVcsOpHash } from '../vcs/ops.js';
import type { VcsOp } from '../vcs/types.js';
import type { PeerId, SyncMessage } from './types.js';
import {
  PROTOCOL_VERSION,
  MIN_SUPPORTED_VERSION,
  MAX_SUPPORTED_VERSION,
} from './types.js';

export interface SyncRoomAppendRejection {
  op: VcsOp;
  reason: 'invalid-kind' | 'hash-mismatch' | 'missing-dependency';
  message: string;
}

export interface SyncRoomAppendResult {
  applied: number;
  skipped: number;
  rejected: SyncRoomAppendRejection[];
  acceptedOps: VcsOp[];
}

export interface SyncRoomDelivery {
  peerId: string;
  message: SyncMessage;
}

/** Default max ops returned for snapshot / tail catch-up. */
export const DEFAULT_SNAPSHOT_MAX_OPS = 500;

export interface SyncRoomSnapshot {
  headHash?: string;
  opCount: number;
  truncated: boolean;
  ops: VcsOp[];
}

/**
 * Canonical room log and catch-up protocol shared by room transports.
 */
export class SyncRoomCore {
  private roomPeer: PeerId;
  private peers = new Map<string, PeerId>();
  private ops: VcsOp[] = [];

  constructor(roomId = 'room', roomName = roomId) {
    this.roomPeer = {
      id: roomId,
      name: roomName,
    };
  }

  connectPeer(peerId: string, peerName = peerId): void {
    this.peers.set(peerId, {
      id: peerId,
      name: peerName,
      lastSeen: new Date().toISOString(),
    });
  }

  disconnectPeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  getRoomPeer(): PeerId {
    return { ...this.roomPeer };
  }

  peersFor(peerId: string): PeerId[] {
    return [
      this.getRoomPeer(),
      ...[...this.peers.values()]
        .filter((peer) => peer.id !== peerId)
        .map((peer) => ({ ...peer })),
    ];
  }

  getOps(): VcsOp[] {
    return [...this.ops];
  }

  getOpCount(): number {
    return this.ops.length;
  }

  /** Build a tail snapshot for late-joiner catch-up. */
  buildSnapshot(maxOps = DEFAULT_SNAPSHOT_MAX_OPS): SyncRoomSnapshot {
    const opCount = this.ops.length;
    const headHash = this.ops.at(-1)?.hash;
    if (opCount <= maxOps) {
      return {
        headHash,
        opCount,
        truncated: false,
        ops: [...this.ops],
      };
    }
    return {
      headHash,
      opCount,
      truncated: true,
      ops: this.ops.slice(-maxOps),
    };
  }

  /** Deliver a snapshot message to a connected peer. */
  snapshotDeliveries(
    peerId: string,
    maxOps = DEFAULT_SNAPSHOT_MAX_OPS,
  ): SyncRoomDelivery[] {
    const snap = this.buildSnapshot(maxOps);
    return [
      {
        peerId,
        message: {
          version: PROTOCOL_VERSION,
          type: 'snapshot',
          peerId: this.roomPeer.id,
          headHash: snap.headHash,
          opCount: snap.opCount,
          truncated: snap.truncated,
          ops: snap.ops,
        },
      },
    ];
  }

  async receive(
    fromPeerId: string,
    message: SyncMessage,
  ): Promise<SyncRoomDelivery[]> {
    const peer = this.peers.get(fromPeerId);
    if (peer) {
      peer.lastSeen = new Date().toISOString();
    }

    // Protocol version gate. Rooms act as sync peers; an unsupported version
    // is rejected with a `protocol-version` nack delivery and the message is
    // not dispatched.
    if (
      typeof message.version !== 'number' ||
      message.version < MIN_SUPPORTED_VERSION ||
      message.version > MAX_SUPPORTED_VERSION
    ) {
      return [
        {
          peerId: fromPeerId,
          message: {
            version: PROTOCOL_VERSION,
            type: 'nack',
            peerId: this.roomPeer.id,
            refs: [],
            reason: 'protocol-version',
            details:
              `Unsupported protocol version ${message.version}; ` +
              `supported range is ${MIN_SUPPORTED_VERSION}-${MAX_SUPPORTED_VERSION}.`,
          },
        },
      ];
    }

    switch (message.type) {
      case 'have':
        return this.handleHave(fromPeerId, message);
      case 'want':
        return this.handleWant(fromPeerId, message);
      case 'sync-snapshot':
        return this.snapshotDeliveries(
          fromPeerId,
          message.maxOps ?? DEFAULT_SNAPSHOT_MAX_OPS,
        );
      case 'ops':
        return this.handleOps(fromPeerId, message.ops);
      case 'ack':
      case 'nack':
      case 'snapshot':
        // Acks/nacks from a peer are bookkeeping; the room itself does not
        // schedule deliveries in response. Consumers can observe nacks via
        // SyncEngine.onNackReceived on the peer-facing side.
        return [];
    }
  }

  private async handleHave(
    peerId: string,
    message: Extract<SyncMessage, { type: 'have' }>,
  ): Promise<SyncRoomDelivery[]> {
    const deliveries = this.roomOpsDeliveries(peerId, message.heads.main);

    const roomHashes = new Set(this.ops.map((op) => op.hash));
    const peerHead = message.heads.main;
    if (
      message.opCount > this.ops.length ||
      (peerHead && !roomHashes.has(peerHead))
    ) {
      deliveries.push({
        peerId,
        message: {
          version: PROTOCOL_VERSION,
          type: 'want',
          peerId: this.roomPeer.id,
          wantHashes: [],
        },
      });
    } else if (
      !deliveries.some(
        (d) => d.message.type === 'want' || d.message.type === 'ops',
      )
    ) {
      // Equal or unknown divergence: respond with want so the peer can
      // complete catch-up (empty wantHashes => full tail in handleWant).
      deliveries.push({
        peerId,
        message: {
          version: PROTOCOL_VERSION,
          type: 'want',
          peerId: this.roomPeer.id,
          wantHashes: [],
        },
      });
    }

    return deliveries;
  }

  private async handleWant(
    peerId: string,
    message: Extract<SyncMessage, { type: 'want' }>,
  ): Promise<SyncRoomDelivery[]> {
    if (message.wantHashes.length > 0) {
      const wanted = new Set(message.wantHashes);
      return this.opsDelivery(
        peerId,
        this.ops.filter((op) => wanted.has(op.hash)),
      );
    }

    if (
      message.maxOps !== undefined &&
      message.maxOps > 0 &&
      !message.afterHash
    ) {
      return this.snapshotDeliveries(peerId, message.maxOps);
    }

    return this.roomOpsDeliveries(peerId, message.afterHash);
  }

  private async handleOps(
    peerId: string,
    ops: VcsOp[],
  ): Promise<SyncRoomDelivery[]> {
    const result = await this.appendOps(ops);
    const accepted = ops.filter((op) =>
      this.ops.some((roomOp) => roomOp.hash === op.hash),
    );
    const deliveries: SyncRoomDelivery[] = [];

    if (accepted.length > 0) {
      deliveries.push({
        peerId,
        message: {
          version: PROTOCOL_VERSION,
          type: 'ack',
          peerId: this.roomPeer.id,
          integrated: accepted.map((op) => op.hash),
        },
      });
    }

    if (result.acceptedOps.length > 0) {
      deliveries.push(...this.broadcastOps(peerId, result.acceptedOps));
    }

    return deliveries;
  }

  async appendOps(incomingOps: VcsOp[]): Promise<SyncRoomAppendResult> {
    const known = new Set(this.ops.map((op) => op.hash));
    const pendingByHash = new Map<string, VcsOp>();
    const rejected: SyncRoomAppendRejection[] = [];
    const acceptedOps: VcsOp[] = [];
    let skipped = 0;
    let applied = 0;

    for (const op of incomingOps) {
      if (known.has(op.hash) || pendingByHash.has(op.hash)) {
        skipped++;
        continue;
      }

      if (!isVcsOpKind(op.kind)) {
        rejected.push({
          op,
          reason: 'invalid-kind',
          message: `Rejected non-VCS op kind '${op.kind}'.`,
        });
        continue;
      }

      if (!(await verifyVcsOpHash(op))) {
        rejected.push({
          op,
          reason: 'hash-mismatch',
          message: `Rejected op with mismatched hash '${op.hash}'.`,
        });
        continue;
      }

      pendingByHash.set(op.hash, op);
    }

    let pending = [...pendingByHash.values()];
    while (pending.length > 0) {
      const nextPending: VcsOp[] = [];
      let progressed = false;

      for (const op of pending) {
        if (op.previousHash && !known.has(op.previousHash)) {
          nextPending.push(op);
          continue;
        }

        this.ops.push(op);
        known.add(op.hash);
        acceptedOps.push(op);
        applied++;
        progressed = true;
      }

      if (!progressed) {
        for (const op of nextPending) {
          rejected.push({
            op,
            reason: 'missing-dependency',
            message: `Missing previousHash '${op.previousHash}' for op '${op.hash}'.`,
          });
        }
        break;
      }

      pending = nextPending;
    }

    return { applied, skipped, rejected, acceptedOps };
  }

  private roomOpsDeliveries(
    peerId: string,
    afterHash?: string,
  ): SyncRoomDelivery[] {
    let ops = this.ops;
    if (afterHash) {
      const index = this.ops.findIndex((op) => op.hash === afterHash);
      ops = index >= 0 ? this.ops.slice(index + 1) : this.ops;
    }
    return this.opsDelivery(peerId, ops);
  }

  private opsDelivery(peerId: string, ops: VcsOp[]): SyncRoomDelivery[] {
    if (ops.length === 0) return [];
    return [
      {
        peerId,
        message: {
          version: PROTOCOL_VERSION,
          type: 'ops',
          peerId: this.roomPeer.id,
          ops,
        },
      },
    ];
  }

  private broadcastOps(
    fromPeerId: string,
    ops: VcsOp[],
  ): SyncRoomDelivery[] {
    const deliveries: SyncRoomDelivery[] = [];
    for (const peerId of this.peers.keys()) {
      if (peerId === fromPeerId) continue;
      deliveries.push(...this.opsDelivery(peerId, ops));
    }
    return deliveries;
  }
}
