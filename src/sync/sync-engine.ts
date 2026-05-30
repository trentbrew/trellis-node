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
  SyncState,
  PeerId,
  BranchPolicy,
} from './types.js';
import { reconcile, findForkPoint, type ReconcileResult } from './reconciler.js';

// ---------------------------------------------------------------------------
// Sync Engine
// ---------------------------------------------------------------------------

export class SyncEngine {
  private localPeerId: string;
  private state: SyncState;
  private transport: SyncTransport;
  private getLocalOps: () => VcsOp[];
  private onOpsReceived: (ops: VcsOp[]) => void;
  private branchPolicy: BranchPolicy;

  constructor(opts: {
    localPeerId: string;
    transport: SyncTransport;
    getLocalOps: () => VcsOp[];
    onOpsReceived: (ops: VcsOp[]) => void;
    branchPolicy?: BranchPolicy;
  }) {
    this.localPeerId = opts.localPeerId;
    this.transport = opts.transport;
    this.getLocalOps = opts.getLocalOps;
    this.onOpsReceived = opts.onOpsReceived;
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
      type: 'want',
      peerId: this.localPeerId,
      wantHashes: [],
      afterHash: lastHash,
    });
  }

  /**
   * Send all our ops to a peer (full push).
   */
  async sendOps(peerId: string, ops?: VcsOp[]): Promise<void> {
    const opsToSend = ops ?? this.getLocalOps();
    await this.transport.send(peerId, {
      type: 'ops',
      peerId: this.localPeerId,
      ops: opsToSend,
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

  private handleMessage(msg: SyncMessage): void {
    switch (msg.type) {
      case 'have':
        this.handleHave(msg);
        break;
      case 'want':
        this.handleWant(msg);
        break;
      case 'ops':
        this.handleOps(msg);
        break;
      case 'ack':
        this.handleAck(msg);
        break;
    }
  }

  private handleHave(msg: Extract<SyncMessage, { type: 'have' }>): void {
    // Store peer heads
    this.state.peerHeads.set(msg.peerId, msg.heads);

    // Compare with our state — determine what we need
    const localOps = this.getLocalOps();
    const localHashes = new Set(localOps.map((o) => o.hash));

    // Check if peer has ops we don't
    for (const [, hash] of Object.entries(msg.heads)) {
      if (!localHashes.has(hash)) {
        // Peer is ahead — request their ops
        this.transport.send(msg.peerId, {
          type: 'want',
          peerId: this.localPeerId,
          wantHashes: [],
          afterHash: localOps.length > 0 ? localOps[localOps.length - 1].hash : undefined,
        });
        return;
      }
    }

    // Check if we have ops they don't — push them
    const peerOpCount = msg.opCount;
    if (localOps.length > peerOpCount) {
      // Send ops they might be missing
      const opsToSend = localOps.slice(peerOpCount);
      this.transport.send(msg.peerId, {
        type: 'ops',
        peerId: this.localPeerId,
        ops: opsToSend,
      });
    }
  }

  private handleWant(msg: Extract<SyncMessage, { type: 'want' }>): void {
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

    if (opsToSend.length > 0) {
      this.transport.send(msg.peerId, {
        type: 'ops',
        peerId: this.localPeerId,
        ops: opsToSend,
      });
    }
  }

  private handleOps(msg: Extract<SyncMessage, { type: 'ops' }>): void {
    if (msg.ops.length === 0) return;

    if (this.branchPolicy.linear) {
      // Linear mode: only accept fast-forward appends
      const localOps = this.getLocalOps();
      const localHashes = new Set(localOps.map((o) => o.hash));

      // Filter to only new ops
      const newOps = msg.ops.filter((o) => !localHashes.has(o.hash));
      if (newOps.length > 0) {
        this.onOpsReceived(newOps);
      }
    } else {
      // CRDT mode: reconcile divergent streams
      const result = this.reconcileWith(msg.ops);
      if (result.uniqueToB.length > 0) {
        this.onOpsReceived(result.uniqueToB);
      }
    }

    // Acknowledge
    this.transport.send(msg.peerId, {
      type: 'ack',
      peerId: this.localPeerId,
      integrated: msg.ops.map((o) => o.hash),
    });

    this.state.lastSync.set(msg.peerId, new Date().toISOString());
  }

  private handleAck(msg: Extract<SyncMessage, { type: 'ack' }>): void {
    for (const hash of msg.integrated) {
      this.state.pendingAcks.delete(hash);
    }
    this.state.lastSync.set(msg.peerId, new Date().toISOString());
  }
}
