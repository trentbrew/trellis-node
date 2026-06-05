import type {
  IntegrateOpsResult,
  TrellisVcsEngine,
} from '../engine.js';
import { SyncEngine, type OpsReceivedRejection } from './sync-engine.js';
import type {
  BranchPolicy,
  NackReason,
  PeerId,
  SyncNackMessage,
  SyncTransport,
} from './types.js';

export interface TrellisVcsSyncPeerOptions {
  peerId: string;
  engine: TrellisVcsEngine;
  transport: SyncTransport;
  branchPolicy?: BranchPolicy;
  onIntegrate?: (result: IntegrateOpsResult) => void | Promise<void>;
  onRemoteNack?: (nack: SyncNackMessage) => void | Promise<void>;
}

/**
 * A nack received from a remote peer in response to ops we pushed.
 * Mirrors `SyncNackMessage` minus the wire `type` field.
 */
export interface RemoteNackInfo {
  peerId: string;
  reason: NackReason;
  refs: string[];
  details?: string;
}

export interface TrellisVcsSyncResult {
  peerId: string;
  beforeOpCount: number;
  afterOpCount: number;
  batches: IntegrateOpsResult[];
  applied: number;
  skipped: number;
  rejected: number;
  /** Nacks the remote sent back while this sync session was running. */
  remoteRejected: RemoteNackInfo[];
}

/**
 * Thin VCS sync facade that connects a TrellisVcsEngine to a SyncTransport.
 */
export class TrellisVcsSyncPeer {
  private engine: TrellisVcsEngine;
  private syncEngine: SyncEngine;
  private transport: SyncTransport;
  private integrationResults: IntegrateOpsResult[] = [];
  private remoteNacks: RemoteNackInfo[] = [];

  constructor(opts: TrellisVcsSyncPeerOptions) {
    this.engine = opts.engine;
    this.transport = opts.transport;
    this.syncEngine = new SyncEngine({
      localPeerId: opts.peerId,
      transport: opts.transport,
      getLocalOps: () => this.engine.getOps(),
      onOpsReceived: async (ops) => {
        const result = await this.engine.integrateOps(ops);
        this.integrationResults.push(result);
        await opts.onIntegrate?.(result);

        // Translate engine rejections into the wire nack shape.
        const rejections: OpsReceivedRejection[] = result.rejected.map(
          (r) => ({
            hash: r.op.hash,
            reason: r.reason as NackReason,
            details: r.message,
          }),
        );
        return { rejections };
      },
      onNackReceived: async (nack) => {
        const info: RemoteNackInfo = {
          peerId: nack.peerId,
          reason: nack.reason,
          refs: nack.refs,
          details: nack.details,
        };
        this.remoteNacks.push(info);
        await opts.onRemoteNack?.(nack);
      },
      branchPolicy: opts.branchPolicy,
    });
  }

  async pushTo(peerId: string): Promise<TrellisVcsSyncResult> {
    return this.captureSync(peerId, () => this.syncEngine.pushTo(peerId));
  }

  async pullFrom(peerId: string): Promise<TrellisVcsSyncResult> {
    return this.captureSync(peerId, () => this.syncEngine.pullAllFrom(peerId));
  }

  async syncWith(peerId: string): Promise<TrellisVcsSyncResult> {
    return this.captureSync(peerId, async () => {
      await this.syncEngine.pushTo(peerId);
      await this.syncEngine.pullAllFrom(peerId);
    });
  }

  /** Request a tail snapshot before a full sync (room peers only). */
  async requestSnapshot(
    peerId: string,
    maxOps?: number,
  ): Promise<void> {
    await this.syncEngine.requestSnapshot(peerId, maxOps);
  }

  listPeers(): PeerId[] {
    return this.syncEngine.listPeers();
  }

  getSyncEngine(): SyncEngine {
    return this.syncEngine;
  }

  /**
   * Cumulative nacks received from remote peers since construction.
   * Useful for tests and for consumers that want to inspect the full history.
   * Sync results returned by `pushTo`/`pullFrom`/`syncWith` already include
   * the per-session slice in `remoteRejected`.
   */
  getRemoteNacks(): readonly RemoteNackInfo[] {
    return this.remoteNacks;
  }

  /** Underlying transport (for connect/close in client wrappers). */
  getTransport(): SyncTransport {
    return this.transport;
  }

  /** Tear down the transport connection if supported. */
  close(): void {
    if ('close' in this.transport && typeof this.transport.close === 'function') {
      this.transport.close();
    }
  }

  private async captureSync(
    peerId: string,
    run: () => Promise<void>,
  ): Promise<TrellisVcsSyncResult> {
    const beforeOpCount = this.engine.getOpCount();
    const start = this.integrationResults.length;
    const nackStart = this.remoteNacks.length;
    await run();
    const batches = this.integrationResults.slice(start);
    const remoteRejected = this.remoteNacks.slice(nackStart);
    const afterOpCount = this.engine.getOpCount();

    return {
      peerId,
      beforeOpCount,
      afterOpCount,
      batches,
      applied: batches.reduce((sum, batch) => sum + batch.applied, 0),
      skipped: batches.reduce((sum, batch) => sum + batch.skipped, 0),
      rejected: batches.reduce(
        (sum, batch) => sum + batch.rejected.length,
        0,
      ),
      remoteRejected,
    };
  }
}
