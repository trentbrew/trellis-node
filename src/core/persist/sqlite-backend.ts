/**
 * SQLite-backed Kernel Backend
 *
 * Replaces the P0 JsonOpLog with a proper WAL-mode SQLite database.
 * Stores ops, snapshots, and blobs in a single database file.
 *
 * @module trellis/core
 */

// `bun:sqlite` is loaded lazily via createRequire so this module is safe to
// statically import in Node/WebContainer environments — the import only
// throws if a Bun-runtime caller actually instantiates the class.
// We deliberately avoid even `import type { Database } from 'bun:sqlite'`
// here, because Bun's bundler currently preserves type-only imports as
// runtime imports, which would re-introduce the unresolvable static
// `bun:sqlite` import in the dist.
import type { KernelOp, KernelBackend } from './backend.js';

// Minimal structural type for the parts of bun:sqlite's Database we use.
type Database = any;
type DatabaseCtor = new (path: string) => Database;

let _DatabaseCtor: DatabaseCtor | null = null;
function loadDatabaseCtor(): DatabaseCtor {
  if (_DatabaseCtor) return _DatabaseCtor;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createRequire } = require('module');
    const requireCJS = createRequire(import.meta.url);
    _DatabaseCtor = requireCJS('bun:sqlite').Database as DatabaseCtor;
    return _DatabaseCtor!;
  } catch {
    throw new Error(
      'SqliteKernelBackend requires the Bun runtime (built-in `bun:sqlite`). ' +
        'In Node / WebContainer use `createKernelBackend()` from ' +
        '`trellis/core` — it auto-selects better-sqlite3 or sql.js.',
    );
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ops (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  previous_hash TEXT,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  last_op_hash TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  content BLOB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_kind ON ops(kind);
CREATE INDEX IF NOT EXISTS idx_ops_timestamp ON ops(timestamp);
CREATE INDEX IF NOT EXISTS idx_ops_agent ON ops(agent_id);
CREATE INDEX IF NOT EXISTS idx_ops_previous ON ops(previous_hash);
CREATE INDEX IF NOT EXISTS idx_snapshots_op ON snapshots(last_op_hash);
`;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SqliteKernelBackend implements KernelBackend {
  private db: Database;
  private _stmts: {
    insert: ReturnType<Database['prepare']>;
    readAll: ReturnType<Database['prepare']>;
    readUntil: ReturnType<Database['prepare']>;
    readAfter: ReturnType<Database['prepare']>;
    getByHash: ReturnType<Database['prepare']>;
    getLast: ReturnType<Database['prepare']>;
    count: ReturnType<Database['prepare']>;
    saveSnapshot: ReturnType<Database['prepare']>;
    loadSnapshot: ReturnType<Database['prepare']>;
    putBlob: ReturnType<Database['prepare']>;
    getBlob: ReturnType<Database['prepare']>;
    hasBlob: ReturnType<Database['prepare']>;
  } | null = null;

  constructor(private dbPath: string) {
    const DatabaseCtor = loadDatabaseCtor();
    this.db = new DatabaseCtor(dbPath);
  }

  init(): void {
    this.db.exec('PRAGMA journal_mode=WAL;');
    this.db.exec('PRAGMA foreign_keys=ON;');
    this.db.exec('PRAGMA synchronous=NORMAL;');
    this.db.exec(SCHEMA_SQL);
    this._prepareStatements();
  }

  private _prepareStatements(): void {
    this._stmts = {
      insert: this.db.prepare(`
        INSERT OR IGNORE INTO ops (hash, kind, timestamp, agent_id, previous_hash, payload)
        VALUES ($hash, $kind, $timestamp, $agentId, $previousHash, $payload)
      `),
      readAll: this.db.prepare(`
        SELECT hash, kind, timestamp, agent_id, previous_hash, payload
        FROM ops ORDER BY rowid ASC
      `),
      readUntil: this.db.prepare(`
        SELECT hash, kind, timestamp, agent_id, previous_hash, payload
        FROM ops WHERE rowid <= (SELECT rowid FROM ops WHERE hash = $hash)
        ORDER BY rowid ASC
      `),
      readAfter: this.db.prepare(`
        SELECT hash, kind, timestamp, agent_id, previous_hash, payload
        FROM ops WHERE rowid > (SELECT rowid FROM ops WHERE hash = $hash)
        ORDER BY rowid ASC
      `),
      getByHash: this.db.prepare(`
        SELECT hash, kind, timestamp, agent_id, previous_hash, payload
        FROM ops WHERE hash = $hash
      `),
      getLast: this.db.prepare(`
        SELECT hash, kind, timestamp, agent_id, previous_hash, payload
        FROM ops ORDER BY rowid DESC LIMIT 1
      `),
      count: this.db.prepare('SELECT COUNT(*) as cnt FROM ops'),
      saveSnapshot: this.db.prepare(`
        INSERT INTO snapshots (last_op_hash, data)
        VALUES ($lastOpHash, $data)
      `),
      loadSnapshot: this.db.prepare(`
        SELECT last_op_hash, data FROM snapshots
        ORDER BY id DESC LIMIT 1
      `),
      putBlob: this.db.prepare(`
        INSERT OR IGNORE INTO blobs (hash, content) VALUES ($hash, $content)
      `),
      getBlob: this.db.prepare(`
        SELECT content FROM blobs WHERE hash = $hash
      `),
      hasBlob: this.db.prepare(`
        SELECT 1 FROM blobs WHERE hash = $hash
      `),
    };
  }

  // -------------------------------------------------------------------------
  // Op operations
  // -------------------------------------------------------------------------

  append(op: KernelOp): void {
    const payload = JSON.stringify({
      facts: op.facts,
      links: op.links,
      ...(op.deleteFacts?.length ? { deleteFacts: op.deleteFacts } : {}),
      ...(op.deleteLinks?.length ? { deleteLinks: op.deleteLinks } : {}),
      ...((op as any).vcs ? { vcs: (op as any).vcs } : {}),
      ...((op as any).signature ? { signature: (op as any).signature } : {}),
    });

    this._stmts!.insert.run({
      $hash: op.hash,
      $kind: op.kind,
      $timestamp: op.timestamp,
      $agentId: op.agentId,
      $previousHash: op.previousHash ?? null,
      $payload: payload,
    });
  }

  appendBatch(ops: KernelOp[]): void {
    if (ops.length === 0) return;
    this.db.transaction(() => {
      for (const op of ops) {
        this.append(op);
      }
    })();
  }

  readAll(): KernelOp[] {
    const rows = this._stmts!.readAll.all() as any[];
    return rows.map(rowToOp);
  }

  readUntil(hash: string): KernelOp[] {
    const rows = this._stmts!.readUntil.all({ $hash: hash }) as any[];
    return rows.map(rowToOp);
  }

  readAfter(hash: string): KernelOp[] {
    const rows = this._stmts!.readAfter.all({ $hash: hash }) as any[];
    return rows.map(rowToOp);
  }

  readUntilTimestamp(isoTimestamp: string): KernelOp[] {
    const rows = this.db
      .prepare(
        `SELECT hash, kind, timestamp, agent_id, previous_hash, payload
         FROM ops WHERE timestamp <= $ts ORDER BY rowid ASC`,
      )
      .all({ $ts: isoTimestamp }) as any[];
    return rows.map(rowToOp);
  }

  getLastOp(): KernelOp | undefined {
    const row = this._stmts!.getLast.get() as any;
    return row ? rowToOp(row) : undefined;
  }

  getByHash(hash: string): KernelOp | undefined {
    return this.getOpByHash(hash);
  }

  getOpCount(): number {
    return this.count();
  }

  getOpByHash(hash: string): KernelOp | undefined {
    const row = this._stmts!.getByHash.get({ $hash: hash }) as any;
    return row ? rowToOp(row) : undefined;
  }

  count(): number {
    const row = this._stmts!.count.get() as any;
    return row?.cnt ?? 0;
  }

  /**
   * Find the common ancestor op of two op hashes by walking
   * previousHash chains until they converge.
   */
  findCommonAncestor(hashA: string, hashB: string): KernelOp | undefined {
    // Collect ancestors of A
    const ancestorsA = new Set<string>();
    let cursor: string | undefined = hashA;
    while (cursor) {
      ancestorsA.add(cursor);
      const op = this.getOpByHash(cursor);
      cursor = op?.previousHash;
    }

    // Walk B's chain until we find a common ancestor
    cursor = hashB;
    while (cursor) {
      if (ancestorsA.has(cursor)) {
        return this.getOpByHash(cursor);
      }
      const op = this.getOpByHash(cursor);
      cursor = op?.previousHash;
    }

    return undefined;
  }

  // -------------------------------------------------------------------------
  // Snapshot operations
  // -------------------------------------------------------------------------

  saveSnapshot(lastOpHash: string, data: any): void {
    this._stmts!.saveSnapshot.run({
      $lastOpHash: lastOpHash,
      $data: JSON.stringify(data),
    });
  }

  loadLatestSnapshot(): { lastOpHash: string; data: any } | undefined {
    const row = this._stmts!.loadSnapshot.get() as any;
    if (!row) return undefined;
    return {
      lastOpHash: row.last_op_hash,
      data: JSON.parse(row.data),
    };
  }

  // -------------------------------------------------------------------------
  // Blob operations
  // -------------------------------------------------------------------------

  putBlob(hash: string, content: Uint8Array): void {
    this._stmts!.putBlob.run({
      $hash: hash,
      $content: Buffer.from(content),
    });
  }

  getBlob(hash: string): Uint8Array | undefined {
    const row = this._stmts!.getBlob.get({ $hash: hash }) as any;
    if (!row) return undefined;
    return new Uint8Array(row.content);
  }

  hasBlob(hash: string): boolean {
    return !!this._stmts!.hasBlob.get({ $hash: hash });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToOp(row: any): KernelOp {
  const payload = JSON.parse(row.payload);
  const op: any = {
    hash: row.hash,
    kind: row.kind,
    timestamp: row.timestamp,
    agentId: row.agent_id,
  };
  if (row.previous_hash) op.previousHash = row.previous_hash;
  if (payload.facts) op.facts = payload.facts;
  if (payload.links) op.links = payload.links;
  if (payload.deleteFacts) op.deleteFacts = payload.deleteFacts;
  if (payload.deleteLinks) op.deleteLinks = payload.deleteLinks;
  if (payload.vcs) op.vcs = payload.vcs;
  if (payload.signature) op.signature = payload.signature;
  return op;
}
