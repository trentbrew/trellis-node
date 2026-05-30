/**
 * Better-SQLite3-backed Kernel Backend
 *
 * Node.js compatible SQLite backend using better-sqlite3.
 * Use this backend when running in Node.js environments.
 *
 * @module trellis/core/persist
 */

import type { KernelOp, KernelBackend } from './backend.js';

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

export class BetterSqliteKernelBackend implements KernelBackend {
  private db: any;
  private _stmts: {
    insert: any;
    readAll: any;
    readUntil: any;
    readAfter: any;
    getByHash: any;
    getLast: any;
    count: any;
    saveSnapshot: any;
    loadLatestSnapshot: any;
  };
  private _initialized = false;

  constructor(dbPath: string) {
    // Use better-sqlite3 for Node.js compatibility
    // The package.json has better-sqlite3 as a peer dependency
    try {
      // Dynamic require to avoid bundling issues - this file is used in Node.js environments
      const createRequire = require('module').createRequire;
      const req = createRequire(__filename);
      const Database = req('better-sqlite3');
      this.db = new Database(dbPath);
    } catch (e) {
      throw new Error(
        `Failed to initialize SQLite backend: ${e instanceof Error ? e.message : 'Unknown error'}. ` +
          'Ensure better-sqlite3 is installed: npm install better-sqlite3',
      );
    }

    this._stmts = this._prepareStatements();
  }

  private _prepareStatements() {
    const db = this.db;

    return {
      insert: db.prepare(
        'INSERT OR REPLACE INTO ops (hash, kind, timestamp, agent_id, previous_hash, payload) VALUES (?, ?, ?, ?, ?, ?)',
      ),
      readAll: db.prepare('SELECT * FROM ops ORDER BY timestamp ASC'),
      readUntil: db.prepare(
        'SELECT * FROM ops WHERE timestamp <= (SELECT timestamp FROM ops WHERE hash = ?) ORDER BY timestamp ASC',
      ),
      readAfter: db.prepare(
        'SELECT * FROM ops WHERE timestamp > (SELECT timestamp FROM ops WHERE hash = ?) ORDER BY timestamp ASC',
      ),
      getByHash: db.prepare('SELECT * FROM ops WHERE hash = ?'),
      getLast: db.prepare('SELECT * FROM ops ORDER BY timestamp DESC LIMIT 1'),
      count: db.prepare('SELECT COUNT(*) as count FROM ops'),
      saveSnapshot: db.prepare(
        'INSERT INTO snapshots (last_op_hash, data, created_at) VALUES (?, ?, ?)',
      ),
      loadLatestSnapshot: db.prepare(
        'SELECT * FROM snapshots ORDER BY id DESC LIMIT 1',
      ),
    };
  }

  init(): void {
    if (this._initialized) return;

    // Create tables
    this.db.exec(SCHEMA_SQL);
    this._initialized = true;
  }

  append(op: KernelOp): void {
    const payload = JSON.stringify({
      facts: op.facts,
      links: op.links,
      deleteFacts: op.deleteFacts,
      deleteLinks: op.deleteLinks,
    });

    this._stmts.insert.run(
      op.hash,
      op.kind,
      op.timestamp,
      op.agentId,
      op.previousHash ?? null,
      payload,
    );
  }

  readAll(): KernelOp[] {
    const rows = this._stmts.readAll.all() as any[];
    return rows.map(this._rowToOp);
  }

  readUntil(opHash: string): KernelOp[] {
    const row = this._stmts.getByHash.get(opHash) as any;
    if (!row) return [];

    const rows = this._stmts.readUntil.all(opHash) as any[];
    return rows.map(this._rowToOp);
  }

  readUntilTimestamp(isoTimestamp: string): KernelOp[] {
    const rows = this.db
      .prepare('SELECT * FROM ops WHERE timestamp <= ? ORDER BY timestamp ASC')
      .all(isoTimestamp) as any[];
    return rows.map(this._rowToOp);
  }

  readAfter(opHash: string): KernelOp[] {
    const row = this._stmts.getByHash.get(opHash) as any;
    if (!row) return this.readAll();

    const rows = this._stmts.readAfter.all(opHash) as any[];
    return rows.map(this._rowToOp);
  }

  getByHash(hash: string): KernelOp | undefined {
    const row = this._stmts.getByHash.get(hash) as any;
    return row ? this._rowToOp(row) : undefined;
  }

  getLastOp(): KernelOp | undefined {
    const row = this._stmts.getLast.get() as any;
    return row ? this._rowToOp(row) : undefined;
  }

  getOpCount(): number {
    const row = this._stmts.count.get() as any;
    return row?.count ?? 0;
  }

  saveSnapshot(hash: string, data: string): void {
    this._stmts.saveSnapshot.run(hash, data, new Date().toISOString());
  }

  loadLatestSnapshot(): { lastOpHash: string; data: string } | undefined {
    const row = this._stmts.loadLatestSnapshot.get() as any;
    if (!row) return undefined;
    return {
      lastOpHash: row.last_op_hash,
      data: row.data,
    };
  }

  close(): void {
    this.db?.close();
  }

  private _rowToOp(row: any): KernelOp {
    const payload = JSON.parse(row.payload);
    return {
      hash: row.hash,
      kind: row.kind,
      timestamp: row.timestamp,
      agentId: row.agent_id,
      previousHash: row.previous_hash ?? undefined,
      facts: payload.facts,
      links: payload.links,
      deleteFacts: payload.deleteFacts,
      deleteLinks: payload.deleteLinks,
    };
  }
}
