/**
 * IndexedDB-backed op log.
 *
 * Browser-side companion to {@link JsonOpLog}. Designed to satisfy the
 * {@link OpLog} contract while accommodating IndexedDB's async nature:
 *
 * - `load()` opens the database and pulls every persisted op into an
 *   in-memory cache. All subsequent reads serve from cache, so the engine
 *   can continue using synchronous `readAll`/`getLastOp`/`count`.
 * - `append()` is synchronous from the caller's perspective: it updates the
 *   in-memory cache immediately and enqueues a durable IDB write. The
 *   returned promise from `flush()` resolves once every queued write has
 *   committed.
 * - Hash dedup happens against the cache before the write is enqueued, so
 *   replayed sync batches never insert the same op twice.
 *
 * Default store layout: one database per repo, one object store keyed by
 * `hash`, with a monotonically-increasing `seq` index so we can replay in
 * append order on load. Callers may override the IDB factory in tests by
 * passing `indexedDB` in the constructor options.
 */

import type { VcsOp } from './types.js';
import type { OpLog } from './op-log.js';

/**
 * Subset of the IndexedDB Factory we use. Matches both `globalThis.indexedDB`
 * and `fake-indexeddb`'s `IDBFactory`. Allows test injection without pulling
 * in the full DOM typings.
 */
export interface IdbFactoryLike {
  open(name: string, version?: number): IDBOpenDBRequest;
}

export interface IdbOpLogOptions {
  /** Database name. One Trellis repo per database. */
  dbName: string;
  /**
   * Object store name. Defaults to `ops`. Override if multiple op logs share
   * a database (e.g. integration journal vs. lane journals).
   */
  storeName?: string;
  /**
   * Injected IndexedDB factory. Defaults to `globalThis.indexedDB`. Tests
   * pass `fake-indexeddb`'s factory directly.
   */
  indexedDB?: IdbFactoryLike;
}

interface PersistedRecord {
  hash: string;
  seq: number;
  op: VcsOp;
}

export class IdbOpLog implements OpLog {
  private ops: VcsOp[] = [];
  private hashes: Set<string> = new Set();
  private db: IDBDatabase | null = null;
  private nextSeq: number = 0;
  private pendingWrites: Promise<void> = Promise.resolve();

  private readonly dbName: string;
  private readonly storeName: string;
  private readonly factory: IdbFactoryLike;

  constructor(opts: IdbOpLogOptions) {
    this.dbName = opts.dbName;
    this.storeName = opts.storeName ?? 'ops';
    const factory =
      opts.indexedDB ??
      (globalThis as { indexedDB?: IdbFactoryLike }).indexedDB;
    if (!factory) {
      throw new Error(
        'IdbOpLog requires IndexedDB. Pass `indexedDB` in options for non-browser hosts.',
      );
    }
    this.factory = factory;
  }

  async load(): Promise<void> {
    this.db = await this.openDb();
    const records = await this.readAllRecords();
    records.sort((a, b) => a.seq - b.seq);
    this.ops = records.map((r) => r.op);
    this.hashes = new Set(this.ops.map((op) => op.hash));
    this.nextSeq = records.length > 0 ? records[records.length - 1].seq + 1 : 0;
  }

  append(op: VcsOp): void {
    if (this.hashes.has(op.hash)) return;
    if (!this.db) {
      throw new Error('IdbOpLog.append() called before load(). Await load() first.');
    }

    this.ops.push(op);
    this.hashes.add(op.hash);
    const seq = this.nextSeq++;
    const record: PersistedRecord = { hash: op.hash, seq, op };

    // Chain writes so flush() awaits every queued append in order.
    this.pendingWrites = this.pendingWrites.then(() => this.putRecord(record));
  }

  readAll(): VcsOp[] {
    return [...this.ops];
  }

  getLastOp(): VcsOp | undefined {
    return this.ops.length > 0 ? this.ops[this.ops.length - 1] : undefined;
  }

  count(): number {
    return this.ops.length;
  }

  async flush(): Promise<void> {
    await this.pendingWrites;
  }

  async close(): Promise<void> {
    await this.flush();
    this.db?.close();
    this.db = null;
  }

  // --- private ---------------------------------------------------------------

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'hash' });
          store.createIndex('seq', 'seq', { unique: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('IndexedDB open failed.'));
      request.onblocked = () =>
        reject(new Error(`IDB open blocked for database '${this.dbName}'.`));
    });
  }

  private readAllRecords(): Promise<PersistedRecord[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IdbOpLog: database not open.'));
        return;
      }
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () =>
        resolve((request.result ?? []) as PersistedRecord[]);
      request.onerror = () =>
        reject(request.error ?? new Error('IdbOpLog.getAll() failed.'));
    });
  }

  private putRecord(record: PersistedRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IdbOpLog: database not open.'));
        return;
      }
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(request.error ?? new Error('IdbOpLog.put() failed.'));
    });
  }
}
