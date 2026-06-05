/**
 * Trellis VCS Client — Reactive SDK
 *
 * High-level client that wraps TrellisVcsEngine with reactive signals
 * and optional PartyKit sync. Works in browsers (IndexedDB) and Node.
 *
 *   const client = await TrellisClient.open({
 *     repo: 'my-project',
 *     sync: { url: 'wss://party.trellis.dev/room/123' },
 *     persist: 'indexeddb',
 *   });
 *
 *   client.subscribe('issues', (issues) => render(issues));
 *   await client.sync();
 */

import { TrellisVcsEngine } from '../engine.js';
import { TrellisVcsSyncPeer } from '../sync/vcs-sync-peer.js';
import { PartyKitRoomTransport } from '../sync/partykit-transport.js';
import type { SyncTransport } from '../sync/types.js';
import type { VcsOp } from '../vcs/types.js';
import { IdbOpLog } from '../vcs/idb-op-log.js';
import { JsonOpLog } from '../vcs/op-log.js';
import type { OpLog } from '../vcs/op-log.js';
import type { IssueCreateOptions, IssueInfo } from '../vcs/issue.js';
import { Signal } from './reactive.js';

export type TrellisClientTopic =
  | 'ops'
  | 'issues'
  | 'milestones'
  | 'branches'
  | 'syncStatus';

export interface TrellisClientSyncOptions {
  /** PartyKit room WebSocket URL. */
  url?: string;
  /** Optional auth token (JWT, passkey) — appended as `?token=` on the WS URL. */
  auth?: string;
  /** Inject a transport for tests or custom relays. Mutually exclusive with `url`. */
  transport?: SyncTransport;
  /** Logical room peer ID for sync calls. Default: `room`. */
  roomId?: string;
  /** Debounced auto-push after local writes (ms). Default: 200. Set 0 to disable. */
  pushDebounceMs?: number;
  /** Connect and catch up on open. Default: true when sync is configured. */
  connectOnOpen?: boolean;
  /**
   * Request a tail snapshot before full sync on connect/reconnect.
   * Default: 500. Set 0 to skip snapshot and use full op replay only.
   */
  snapshotMaxOps?: number;
  /** Reconnect with backoff when using `url` (PartyKit transport). Default: true. */
  reconnect?: boolean;
}

export interface TrellisClientOptions {
  /** Repository root path or logical name (for IDB). */
  repo: string;
  /** Peer/agent identity. Generated if omitted. */
  agentId?: string;
  /** Sync configuration. Omit for offline-only. */
  sync?: TrellisClientSyncOptions;
  /** Persistence backend. Default: filesystem (Node) or IndexedDB (browser). */
  persist?: 'indexeddb' | 'opfs' | 'memory';
}

export interface SyncStatus {
  /** Whether the transport connection is open (WebSocket rooms). */
  connected: boolean;
  /** Number of in-flight sync operations. */
  pending: number;
  /** Whether the client believes it is in sync with the room. */
  synced: boolean;
  /** ISO timestamp of the last successful push/pull, or null. */
  lastSyncAt: string | null;
  /** Last sync or connection error message, or null. */
  lastError: string | null;
}

const DEFAULT_SYNC_STATUS: SyncStatus = {
  connected: false,
  pending: 0,
  synced: false,
  lastSyncAt: null,
  lastError: null,
};

/** In-memory op log for ephemeral sessions. */
class MemoryOpLog implements OpLog {
  private ops: VcsOp[] = [];
  private hashes = new Set<string>();

  load(): void {
    /* no-op */
  }
  append(op: VcsOp): void {
    if (this.hashes.has(op.hash)) return;
    this.ops.push(op);
    this.hashes.add(op.hash);
  }
  readAll(): VcsOp[] {
    return [...this.ops];
  }
  getLastOp(): VcsOp | undefined {
    return this.ops[this.ops.length - 1];
  }
  count(): number {
    return this.ops.length;
  }
}

/**
 * Reactive Trellis client with VCS operations and optional multiplayer sync.
 */
export class TrellisClient {
  private _engine!: TrellisVcsEngine;
  private _syncPeer?: TrellisVcsSyncPeer;
  private _peerId: string = '';
  private _opLog!: OpLog;
  private _roomId: string = 'room';
  private _pushDebounceMs: number = 200;
  private _snapshotMaxOps: number = 500;
  private _pushTimer?: ReturnType<typeof setTimeout>;
  private _closed = false;

  /** Raw causal log. Updated on every local or remote op. */
  private _ops = new Signal<VcsOp[]>([]);
  /** Sync connection state. */
  private _syncStatus = new Signal<SyncStatus>({ ...DEFAULT_SYNC_STATUS });

  private _opHandlers: Array<(op: VcsOp) => void> = [];
  private _topicSubs = new Map<string, Set<(data: unknown) => void>>();

  private constructor() {
    /* Use TrellisClient.open() factory. */
  }

  /** Factory — opens the repo, loads ops, and optionally connects to sync. */
  static async open(opts: TrellisClientOptions): Promise<TrellisClient> {
    const client = new TrellisClient();
    client._peerId = opts.agentId ?? `client:${crypto.randomUUID()}`;
    client._opLog = client._createOpLog(opts);

    // Pre-load async backends (IndexedDB) before the engine touches them.
    // The engine's open() assumes synchronous load(); IDB breaks that
    // contract, so we prime the cache here.
    if ('load' in client._opLog && typeof client._opLog.load === 'function') {
      const maybePromise = client._opLog.load();
      if (maybePromise instanceof Promise) await maybePromise;
    }

    client._engine = new TrellisVcsEngine({
      rootPath: opts.repo,
      agentId: client._peerId,
      opLog: client._opLog,
    });

    client._engine.open();
    client._refreshState();

    if (opts.sync) {
      client._roomId = opts.sync.roomId ?? 'room';
      client._pushDebounceMs = opts.sync.pushDebounceMs ?? 200;
      client._snapshotMaxOps = opts.sync.snapshotMaxOps ?? 500;

      const transport = client._createTransport(opts.sync, client);
      client._syncPeer = new TrellisVcsSyncPeer({
        peerId: client._peerId,
        engine: client._engine,
        transport,
        onIntegrate: () => {
          client._refreshState();
          client._setSyncStatus({ synced: true, lastError: null });
        },
      });

      if (opts.sync.connectOnOpen !== false) {
        try {
          await client._connectAndCatchUp();
        } catch {
          // Offline-first: local writes still work when the room is unreachable.
        }
      }
    }

    return client;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Subscribe to reactive topics. Callback receives current value immediately. */
  subscribe(
    topic: TrellisClientTopic | string,
    callback: (data: unknown) => void,
  ): () => void {
    if (!this._topicSubs.has(topic)) {
      this._topicSubs.set(topic, new Set());
    }
    const subs = this._topicSubs.get(topic)!;
    subs.add(callback);

    const current = this._getTopicValue(topic);
    if (current !== undefined) {
      try {
        callback(current);
      } catch {
        /* ignore */
      }
    }

    return () => {
      subs.delete(callback);
    };
  }

  /** Listen for raw op events (local or remote). */
  on(event: 'op', handler: (op: VcsOp) => void): () => void {
    this._opHandlers.push(handler);
    return () => {
      const idx = this._opHandlers.indexOf(handler);
      if (idx >= 0) this._opHandlers.splice(idx, 1);
    };
  }

  /** Create an issue and emit reactive updates. */
  async createIssue(
    title: string,
    opts?: IssueCreateOptions & { lane?: string },
  ): Promise<VcsOp> {
    const createOpts: IssueCreateOptions = { ...opts };
    if (opts?.lane) {
      createOpts.laneId = opts.lane;
    }
    const op = await this._engine.createIssue(title, createOpts);
    this._refreshState();
    this._schedulePush();
    return op;
  }

  /** Force a push/pull sync with the room. */
  async sync(): Promise<void> {
    if (!this._syncPeer) {
      throw new Error(
        'No sync configured. Pass sync.url to TrellisClient.open() to enable multiplayer sync.',
      );
    }
    await this._connectAndCatchUp();
  }

  /** Close (complete) an issue. */
  async closeIssue(
    id: string,
    opts?: { confirm?: boolean },
  ): Promise<VcsOp | null> {
    const result = await this._engine.closeIssue(id, opts);
    if (result.op) {
      this._refreshState();
      this._schedulePush();
    }
    return result.op ?? null;
  }

  /** Reopen a closed issue. */
  async reopenIssue(id: string): Promise<VcsOp> {
    const op = await this._engine.reopenIssue(id);
    this._refreshState();
    this._schedulePush();
    return op;
  }

  /** Read current ops without subscribing. */
  getOps(): VcsOp[] {
    return this._engine.getOps();
  }

  /** Read current issues without subscribing. */
  listIssues(): IssueInfo[] {
    return this._engine.listIssues();
  }

  /** Clean up resources. */
  close(): void {
    if (this._closed) return;
    this._closed = true;

    if (this._pushTimer !== undefined) {
      clearTimeout(this._pushTimer);
      this._pushTimer = undefined;
    }

    this._syncPeer?.close();

    if (
      'close' in this._opLog &&
      typeof this._opLog.close === 'function'
    ) {
      void (this._opLog.close() as void | Promise<void>);
    }

    this._engine.stop();
    this._setSyncStatus({ connected: false });
  }

  // -------------------------------------------------------------------------
  // Reactive accessors (for framework adapters)
  // -------------------------------------------------------------------------

  /** Signal exposing the full causal op log. */
  get opsSignal(): Signal<VcsOp[]> {
    return this._ops;
  }

  /** Signal exposing sync connection status. */
  get syncStatusSignal(): Signal<SyncStatus> {
    return this._syncStatus;
  }

  /** Underlying VCS engine (for advanced sync wiring and queries). */
  get engine(): TrellisVcsEngine {
    return this._engine;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _createTransport(
    sync: TrellisClientSyncOptions,
    client: TrellisClient,
  ): SyncTransport {
    if (sync.transport) return sync.transport;
    if (!sync.url) {
      throw new Error(
        'sync.transport or sync.url is required when sync is configured.',
      );
    }
    return new PartyKitRoomTransport({
      peerId: this._peerId,
      roomUrl: sync.url,
      auth: sync.auth,
      roomId: sync.roomId,
      reconnect: sync.reconnect !== false,
      onReconnect: () => client._onTransportReconnect(),
      onDisconnect: () => client._setSyncStatus({ connected: false }),
    });
  }

  private _createOpLog(opts: TrellisClientOptions): OpLog {
    switch (opts.persist) {
      case 'indexeddb':
        return new IdbOpLog({ dbName: opts.repo });
      case 'memory':
        return new MemoryOpLog();
      case 'opfs':
        throw new Error(
          'OPFS persistence not yet implemented. Use "indexeddb" or "memory".',
        );
      default:
        // Auto-detect: IndexedDB in browser, JsonOpLog in Node
        if (typeof globalThis !== 'undefined' && 'indexedDB' in globalThis) {
          return new IdbOpLog({ dbName: opts.repo });
        }
        return new JsonOpLog(`${opts.repo}/.trellis/ops.json`);
    }
  }

  private async _connectTransport(): Promise<void> {
    const transport = this._syncPeer?.getTransport();
    if (
      transport &&
      'connect' in transport &&
      typeof transport.connect === 'function'
    ) {
      await transport.connect();
      this._setSyncStatus({ connected: true, lastError: null });
    } else if (transport) {
      this._setSyncStatus({ connected: true, lastError: null });
    }
  }

  private async _connectAndCatchUp(): Promise<void> {
    if (!this._syncPeer) return;

    this._setSyncStatus({
      pending: this._syncStatus.value.pending + 1,
      synced: false,
    });

    try {
      await this._connectTransport();
      await this._requestSnapshot();
      const result = await this._syncPeer.syncWith(this._roomId);
      this._setSyncStatus({
        connected: true,
        synced: result.rejected === 0,
        lastSyncAt: new Date().toISOString(),
        lastError:
          result.rejected > 0
            ? `${result.rejected} op(s) rejected during sync`
            : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._setSyncStatus({
        connected: false,
        synced: false,
        lastError: message,
      });
      throw err;
    } finally {
      this._setSyncStatus({
        pending: Math.max(0, this._syncStatus.value.pending - 1),
      });
    }
  }

  private async _onTransportReconnect(): Promise<void> {
    if (this._closed || !this._syncPeer) return;
    try {
      await this._connectAndCatchUp();
    } catch {
      /* offline-first */
    }
  }

  private async _requestSnapshot(): Promise<void> {
    if (!this._syncPeer || this._snapshotMaxOps <= 0) return;
    await this._syncPeer.requestSnapshot(this._roomId, this._snapshotMaxOps);
    // Memory-room delivers synchronously; allow microtasks for WS transports.
    await new Promise<void>((resolve) => {
      queueMicrotask(() => resolve());
    });
  }

  private _schedulePush(): void {
    if (!this._syncPeer || this._pushDebounceMs <= 0 || this._closed) return;

    if (this._pushTimer !== undefined) {
      clearTimeout(this._pushTimer);
    }

    this._pushTimer = setTimeout(() => {
      this._pushTimer = undefined;
      void this._pushToRoom();
    }, this._pushDebounceMs);
  }

  private async _pushToRoom(): Promise<void> {
    if (!this._syncPeer || this._closed) return;

    this._setSyncStatus({
      pending: this._syncStatus.value.pending + 1,
      synced: false,
    });

    try {
      await this._connectTransport();
      const result = await this._syncPeer.pushTo(this._roomId);
      this._setSyncStatus({
        connected: true,
        synced: result.remoteRejected.length === 0,
        lastSyncAt: new Date().toISOString(),
        lastError:
          result.remoteRejected.length > 0
            ? `${result.remoteRejected.length} op(s) rejected by room`
            : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._setSyncStatus({
        connected: false,
        synced: false,
        lastError: message,
      });
    } finally {
      this._setSyncStatus({
        pending: Math.max(0, this._syncStatus.value.pending - 1),
      });
    }
  }

  private _refreshState(): void {
    const ops = this._engine.getOps();
    const previousHashes = new Set(this._ops.value.map((o) => o.hash));

    this._ops.value = ops;

    // Emit events for newly arrived ops
    for (const op of ops) {
      if (!previousHashes.has(op.hash)) {
        this._emitOp(op);
      }
    }

    this._broadcastTopic('ops', ops);
    this._broadcastTopic('issues', this._engine.listIssues());
    this._broadcastTopic('milestones', this._engine.listMilestones());
    this._broadcastTopic('branches', this._engine.listBranches());
  }

  private _emitOp(op: VcsOp): void {
    for (const h of this._opHandlers) {
      try {
        h(op);
      } catch {
        /* ignore */
      }
    }
  }

  private _broadcastTopic(topic: string, data: unknown): void {
    const subs = this._topicSubs.get(topic);
    if (!subs) return;
    for (const fn of subs) {
      try {
        fn(data);
      } catch {
        /* ignore */
      }
    }
  }

  private _getTopicValue(topic: string): unknown {
    switch (topic) {
      case 'ops':
        return this._ops.value;
      case 'syncStatus':
        return this._syncStatus.value;
      case 'issues':
        return this._engine.listIssues();
      case 'milestones':
        return this._engine.listMilestones();
      case 'branches':
        return this._engine.listBranches();
      default:
        return undefined;
    }
  }

  private _setSyncStatus(partial: Partial<SyncStatus>): void {
    this._syncStatus.value = { ...this._syncStatus.value, ...partial };
    this._broadcastTopic('syncStatus', this._syncStatus.value);
  }
}
