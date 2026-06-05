/**
 * Sync Engine
 *
 * DESIGN.md §10.5 — Peer sync protocol.
 * Coordinates push/pull of ops between peers using a transport layer.
 * Supports both linear (fast-forward only) and CRDT (concurrent append)
 * branch modes.
 */

import type { VcsOp } from '../vcs/types.js';
import type {
  SyncTransport,
  SyncMessage,
  SyncNackMessage,
  SyncState,
  PeerId,
  BranchPolicy,
  NackReason,
} from './types.js';
import {
  PROTOCOL_VERSION,
  MIN_SUPPORTED_VERSION,
  MAX_SUPPORTED_VERSION,
} from './types.js';
import { DEFAULT_SNAPSHOT_MAX_OPS } from './room-core.js';
import { reconcile, findForkPoint, type ReconcileResult } from './reconciler.js';

// ---------------------------------------------------------------------------
// Op-received result
// ---------------------------------------------------------------------------

/**
 * Per-op rejection returned by `onOpsReceived`. Translated into one or more
 * `nack` messages on the wire, grouped by `reason`.
 */
export interface OpsReceivedRejection {
  hash: string;
  reason: NackReason;
  details?: string;
}

/**
 * Optional return value of `onOpsReceived`. When present, the engine uses it
 * to send precise `nack` messages and to compute the `ack` set (incoming
 * hashes minus rejected). When absent, all incoming ops are ack'd and no
 * nack is sent — preserving the original SyncEngine semantics.
 */
export interface OpsReceivedResult {
  rejections: OpsReceivedRejection[];
}

// ---------------------------------------------------------------------------
// Sync Engine
// ---------------------------------------------------------------------------

export class SyncEngine {
  private localPeerId: string;
  private state: SyncState;
  private transport: SyncTransport;
  private getLocalOps: () => VcsOp[];
  private onOpsReceived: (
    ops: VcsOp[],
  ) => void | OpsReceivedResult | Promise<void | OpsReceivedResult>;
  private onNackReceived?: (nack: SyncNackMessage) => void | Promise<void>;
  private branchPolicy: BranchPolicy;

  constructor(opts: {
    localPeerId: string;
    transport: SyncTransport;
    getLocalOps: () => VcsOp[];
    onOpsReceived: (
      ops: VcsOp[],
    ) => void | OpsReceivedResult | Promise<void | OpsReceivedResult>;
    onNackReceived?: (nack: SyncNackMessage) => void | Promise<void>;
    branchPolicy?: BranchPolicy;
  }) {
    this.localPeerId = opts.localPeerId;
    this.transport = opts.transport;
    this.getLocalOps = opts.getLocalOps;
    this.onOpsReceived = opts.onOpsReceived;
    this.onNackReceived = opts.onNackReceived;
    this.branchPolicy = opts.branchPolicy ?? { linear: true };

    this.state = {
      localPeerId: opts.localPeerId,
      peerHeads: new Map(),
      pendingAcks: new Set(),
      lastSync: new Map(),
    };

    // Register message handler
    this.transport.onMessage((msg) => this.handleMessage(msg));
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Initiate a sync with a specific peer.
   * Sends a 'have' message advertising our heads.
   */
  async pushTo(peerId: string): Promise<void> {
    const ops = this.getLocalOps();
    const heads: Record<string, string> = {};
    if (ops.length > 0) {
      heads['main'] = ops[ops.length - 1].hash;
    }

    await this.transport.send(peerId, {
      version: PROTOCOL_VERSION,
      type: 'have',
      peerId: this.localPeerId,
      heads,
      opCount: ops.length,
    });
  }

  /**
   * Request ops from a peer.
   */
  async pullFrom(peerId: string): Promise<void> {
    const ops = this.getLocalOps();
    const lastHash = ops.length > 0 ? ops[ops.length - 1].hash : undefined;

    await this.transport.send(peerId, {
      version: PROTOCOL_VERSION,
      type: 'want',
      peerId: this.localPeerId,
      wantHashes: [],
      afterHash: lastHash,
    });
  }

  /**
   * Request the peer's complete op set and rely on hash dedupe during ingest.
   */
  async pullAllFrom(peerId: string): Promise<void> {
    await this.transport.send(peerId, {
      version: PROTOCOL_VERSION,
      type: 'want',
      peerId: this.localPeerId,
      wantHashes: [],
    });
  }

  /**
   * Request a truncated tail snapshot from a room peer (late-joiner catch-up).
   * The room replies with a `snapshot` message handled like `ops`.
   */
  async requestSnapshot(
    peerId: string,
    maxOps = DEFAULT_SNAPSHOT_MAX_OPS,
  ): Promise<void> {
    await this.transport.send(peerId, {
      version: PROTOCOL_VERSION,
      type: 'sync-snapshot',
      peerId: this.localPeerId,
      maxOps,
    });
  }

  /**
   * Send all our ops to a peer (full push).
   */
  async sendOps(peerId: string, ops?: VcsOp[]): Promise<void> {
    const opsToSend = ops ?? this.getLocalOps();
    await this.sendOpsMessage(peerId, opsToSend);
  }

  /**
   * Internal: send an `ops` message and track outbound hashes in
   * `pendingAcks` until the receiver acks or nacks them. All three sites
   * that emit `ops` (sendOps, handleHave, handleWant) route through here so
   * pendingAcks reflects every outbound op uniformly.
   */
  private async sendOpsMessage(peerId: string, ops: VcsOp[]): Promise<void> {
    if (ops.length === 0) return;
    for (const op of ops) {
      this.state.pendingAcks.add(op.hash);
    }
    await this.transport.send(peerId, {
      version: PROTOCOL_VERSION,
      type: 'ops',
      peerId: this.localPeerId,
      ops,
    });
  }

  /**
   * Reconcile our ops with a remote peer's ops.
   */
  reconcileWith(remoteOps: VcsOp[]): ReconcileResult {
    const localOps = this.getLocalOps();
    return reconcile(localOps, remoteOps);
  }

  /**
   * Get current sync state.
   */
  getState(): SyncState {
    return this.state;
  }

  /**
   * Get branch policy.
   */
  getBranchPolicy(): BranchPolicy {
    return this.branchPolicy;
  }

  /**
   * Set branch policy.
   */
  setBranchPolicy(policy: BranchPolicy): void {
    this.branchPolicy = policy;
  }

  /**
   * List known peers.
   */
  listPeers(): PeerId[] {
    return this.transport.peers();
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  private async handleMessage(msg: SyncMessage): Promise<void> {
    // Protocol version gate. A message with an unsupported version is
    // rejected with a `protocol-version` nack and not dispatched. The nack
    // itself uses PROTOCOL_VERSION so a v2 sender can interpret our reply.
    if (
      typeof msg.version !== 'number' ||
      msg.version < MIN_SUPPORTED_VERSION ||
      msg.version > MAX_SUPPORTED_VERSION
    ) {
      await this.transport.send(msg.peerId, {
        version: PROTOCOL_VERSION,
        type: 'nack',
        peerId: this.localPeerId,
        refs: [],
        reason: 'protocol-version',
        details:
          `Unsupported protocol version ${msg.version}; ` +
          `supported range is ${MIN_SUPPORTED_VERSION}-${MAX_SUPPORTED_VERSION}.`,
      });
      return;
    }

    switch (msg.type) {
      case 'have':
        await this.handleHave(msg);
        break;
      case 'want':
        await this.handleWant(msg);
        break;
      case 'ops':
        await this.handleOps(msg);
        break;
      case 'ack':
        this.handleAck(msg);
        break;
      case 'nack':
        await this.handleNack(msg);
        break;
      case 'snapshot':
        await this.handleSnapshot(msg);
        break;
      case 'sync-snapshot':
        break;
    }
  }

  private async handleSnapshot(
    msg: Extract<SyncMessage, { type: 'snapshot' }>,
  ): Promise<void> {
    if (msg.ops.length === 0) return;
    await this.handleOps({
      version: msg.version,
      type: 'ops',
      peerId: msg.peerId,
      ops: msg.ops,
    });
  }

  private async handleHave(
    msg: Extract<SyncMessage, { type: 'have' }>,
  ): Promise<void> {
    // Store peer heads
    this.state.peerHeads.set(msg.peerId, msg.heads);

    // Compare with our state — determine what we need
    const localOps = this.getLocalOps();
    const localHashes = new Set(localOps.map((o) => o.hash));

    // Check if peer has ops we don't
    for (const [, hash] of Object.entries(msg.heads)) {
      if (!localHashes.has(hash)) {
        // Peer is ahead — request their ops
        const afterHash =
          msg.opCount > localOps.length
            ? undefined
            : localOps.length > 0
              ? localOps[localOps.length - 1].hash
              : undefined;
        await this.transport.send(msg.peerId, {
          version: PROTOCOL_VERSION,
          type: 'want',
          peerId: this.localPeerId,
          wantHashes: [],
          afterHash,
        });
        return;
      }
    }

    if (msg.opCount > localOps.length) {
      await this.transport.send(msg.peerId, {
        version: PROTOCOL_VERSION,
        type: 'want',
        peerId: this.localPeerId,
        wantHashes: [],
      });
      return;
    }

    // Check if we have ops they don't — push them
    const peerOpCount = msg.opCount;
    if (localOps.length > peerOpCount) {
      // Send ops they might be missing
      await this.sendOpsMessage(msg.peerId, localOps.slice(peerOpCount));
    }
  }

  private async handleWant(
    msg: Extract<SyncMessage, { type: 'want' }>,
  ): Promise<void> {
    const localOps = this.getLocalOps();

    let opsToSend: VcsOp[];
    if (msg.afterHash) {
      const idx = localOps.findIndex((o) => o.hash === msg.afterHash);
      opsToSend = idx >= 0 ? localOps.slice(idx + 1) : localOps;
    } else if (msg.wantHashes.length > 0) {
      const wanted = new Set(msg.wantHashes);
      opsToSend = localOps.filter((o) => wanted.has(o.hash));
    } else {
      opsToSend = localOps;
    }

    await this.sendOpsMessage(msg.peerId, opsToSend);
  }

  private async handleOps(
    msg: Extract<SyncMessage, { type: 'ops' }>,
  ): Promise<void> {
    if (msg.ops.length === 0) return;

    let result: OpsReceivedResult | undefined;
    if (this.branchPolicy.linear) {
      // Linear mode: pre-filter dupes, hand new ops to the integrator.
      const localOps = this.getLocalOps();
      const localHashes = new Set(localOps.map((o) => o.hash));
      const newOps = msg.ops.filter((o) => !localHashes.has(o.hash));
      if (newOps.length > 0) {
        result = (await this.onOpsReceived(newOps)) ?? undefined;
      }
    } else {
      // CRDT mode: reconcile divergent streams, hand uniqueToB to integrator.
      const reconciled = this.reconcileWith(msg.ops);
      if (reconciled.uniqueToB.length > 0) {
        result = (await this.onOpsReceived(reconciled.uniqueToB)) ?? undefined;
      }
    }

    const rejections: OpsReceivedRejection[] = result?.rejections ?? [];

    // Group rejections by reason → emit one nack per reason.
    if (rejections.length > 0) {
      const byReason = new Map<
        NackReason,
        { refs: string[]; details?: string }
      >();
      for (const r of rejections) {
        const entry = byReason.get(r.reason) ?? {
          refs: [],
          details: r.details,
        };
        entry.refs.push(r.hash);
        byReason.set(r.reason, entry);
      }
      for (const [reason, entry] of byReason) {
        await this.transport.send(msg.peerId, {
          version: PROTOCOL_VERSION,
          type: 'nack',
          peerId: this.localPeerId,
          refs: entry.refs,
          reason,
          details: entry.details,
        });
      }
    }

    // Ack = incoming hashes minus rejected. Dupes count as ack'd; sender
    // learns the receiver already has them.
    const rejectedSet = new Set(rejections.map((r) => r.hash));
    const ackHashes = msg.ops
      .map((o) => o.hash)
      .filter((h) => !rejectedSet.has(h));
    if (ackHashes.length > 0) {
      await this.transport.send(msg.peerId, {
        version: PROTOCOL_VERSION,
        type: 'ack',
        peerId: this.localPeerId,
        integrated: ackHashes,
      });
    }

    this.state.lastSync.set(msg.peerId, new Date().toISOString());
  }

  private handleAck(msg: Extract<SyncMessage, { type: 'ack' }>): void {
    for (const hash of msg.integrated) {
      this.state.pendingAcks.delete(hash);
    }
    this.state.lastSync.set(msg.peerId, new Date().toISOString());
  }

  private async handleNack(msg: SyncNackMessage): Promise<void> {
    // Refs in a nack were rejected by the peer — drop from pendingAcks so we
    // do not wait on them. The consumer-level handler decides recovery.
    for (const ref of msg.refs) {
      this.state.pendingAcks.delete(ref);
    }
    this.state.lastSync.set(msg.peerId, new Date().toISOString());
    if (this.onNackReceived) {
      await this.onNackReceived(msg);
    }
  }
}
