/**
 * sql.js-backed Kernel Backend
 *
 * Pure-WASM SQLite. Use this backend in environments that cannot load
 * native binaries or `bun:sqlite` — Node-without-Bun, WebContainer, browser.
 *
 * sql.js holds the database image in memory. Persistence is implemented by
 * snapshotting the full image to disk on close and at a configurable write
 * interval. Appropriate for kernel op-log sized datasets; not appropriate
 * for very large stores where incremental flushes matter.
 *
 * @module trellis/core/persist
 */

import type { KernelOp, KernelBackend } from './backend.js';

type SqlJsStatic = any;
type SqlJsDatabase = any;
type SqlJsStatement = any;

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

export interface SqlJsKernelBackendOptions {
  /** Filesystem path to load/persist DB image. Pass `:memory:` to disable disk I/O. */
  dbPath: string;
  /** Auto-flush every N writes. Default 50. Set 0 to disable auto-flush. */
  autoFlushEvery?: number;
}

export class SqlJsKernelBackend implements KernelBackend {
  private db!: SqlJsDatabase;
  private stmts!: Record<string, SqlJsStatement>;
  private writes = 0;
  private flushEvery: number;
  private initialized = false;

  private constructor(private opts: SqlJsKernelBackendOptions) {
    this.flushEvery = opts.autoFlushEvery ?? 50;
  }

  /**
   * Async factory — sql.js WASM init is async, but the resulting backend
   * exposes the synchronous KernelBackend surface, so it slots into the
   * existing kernel without interface changes.
   */
  static async create(
    opts: SqlJsKernelBackendOptions,
  ): Promise<SqlJsKernelBackend> {
    const backend = new SqlJsKernelBackend(opts);
    await backend.bootstrap();
    return backend;
  }

  private async bootstrap(): Promise<void> {
    let initSqlJs: (cfg?: any) => Promise<SqlJsStatic>;
    try {
      const mod: any = await import('sql.js');
      initSqlJs = mod.default ?? mod;
    } catch (e) {
      throw new Error(
        'SqlJsKernelBackend requires the optional dependency "sql.js". ' +
          'Install it: npm install sql.js',
      );
    }

    // Pre-resolve the wasm directory under Node/WebContainer so that the
    // synchronous `locateFile` callback can return absolute paths without
    // doing dynamic imports of its own.
    let sqljsDistDir: string | null = null;
    if (typeof window === 'undefined') {
      try {
        const moduleMod: any = await import('module');
        const pathMod: any = await import('path');
        const req = moduleMod.createRequire(import.meta.url);
        const sqlJsEntry: string = req.resolve('sql.js');
        sqljsDistDir = pathMod.dirname(sqlJsEntry);
      } catch {
        sqljsDistDir = null;
      }
    }

    const SQL = await initSqlJs({
      locateFile: (file: string) => {
        if (typeof window !== 'undefined') return `/sql-wasm/${file}`;
        if (sqljsDistDir) return `${sqljsDistDir}/${file}`;
        return file;
      },
    });

    const existing = this.loadFromDisk();
    this.db = existing ? new SQL.Database(existing) : new SQL.Database();
  }

  private loadFromDisk(): Uint8Array | null {
    if (this.opts.dbPath === ':memory:') return null;
    try {
      const fs = require('fs');
      if (!fs.existsSync(this.opts.dbPath)) return null;
      return new Uint8Array(fs.readFileSync(this.opts.dbPath));
    } catch {
      return null;
    }
  }

  private flushToDisk(): void {
    if (this.opts.dbPath === ':memory:') return;
    try {
      const fs = require('fs');
      const path = require('path');
      const data = this.db.export();
      fs.mkdirSync(path.dirname(this.opts.dbPath), { recursive: true });
      const tmp = `${this.opts.dbPath}.tmp`;
      fs.writeFileSync(tmp, Buffer.from(data));
      fs.renameSync(tmp, this.opts.dbPath);
    } catch {
      // No-op in browser-without-fs environments. Callers wanting browser
      // persistence should subclass and override flushToDisk to use OPFS.
    }
  }

  init(): void {
    if (this.initialized) return;
    this.db.exec(SCHEMA_SQL);
    this.prepareStatements();
    this.initialized = true;
  }

  private prepareStatements(): void {
    this.stmts = {
      insert: this.db.prepare(
        `INSERT OR IGNORE INTO ops (hash, kind, timestamp, agent_id, previous_hash, payload)
         VALUES ($hash, $kind, $timestamp, $agentId, $previousHash, $payload)`,
      ),
      readAll: this.db.prepare(
        `SELECT hash, kind, timestamp, agent_id, previous_hash, payload
         FROM ops ORDER BY rowid ASC`,
      ),
      readUntil: this.db.prepare(
        `SELECT hash, kind, timestamp, agent_id, previous_hash, payload
         FROM ops WHERE rowid <= (SELECT rowid FROM ops WHERE hash = $hash)
         ORDER BY rowid ASC`,
      ),
      readAfter: this.db.prepare(
        `SELECT hash, kind, timestamp, agent_id, previous_hash, payload
         FROM ops WHERE rowid > (SELECT rowid FROM ops WHERE hash = $hash)
         ORDER BY rowid ASC`,
      ),
      getByHash: this.db.prepare(
        `SELECT hash, kind, timestamp, agent_id, previous_hash, payload
         FROM ops WHERE hash = $hash`,
      ),
      getLast: this.db.prepare(
        `SELECT hash, kind, timestamp, agent_id, previous_hash, payload
         FROM ops ORDER BY rowid DESC LIMIT 1`,
      ),
      count: this.db.prepare(`SELECT COUNT(*) AS cnt FROM ops`),
      saveSnapshot: this.db.prepare(
        `INSERT INTO snapshots (last_op_hash, data) VALUES ($lastOpHash, $data)`,
      ),
      loadSnapshot: this.db.prepare(
        `SELECT last_op_hash, data FROM snapshots ORDER BY id DESC LIMIT 1`,
      ),
    };
  }

  append(op: KernelOp): void {
    const payload = JSON.stringify({
      facts: op.facts,
      links: op.links,
      ...(op.deleteFacts?.length ? { deleteFacts: op.deleteFacts } : {}),
      ...(op.deleteLinks?.length ? { deleteLinks: op.deleteLinks } : {}),
      ...((op as any).vcs ? { vcs: (op as any).vcs } : {}),
      ...((op as any).signature ? { signature: (op as any).signature } : {}),
    });
    this.stmts.insert.run({
      $hash: op.hash,
      $kind: op.kind,
      $timestamp: op.timestamp,
      $agentId: op.agentId,
      $previousHash: op.previousHash ?? null,
      $payload: payload,
    });
    this.stmts.insert.reset();
    this.tickFlush();
  }

  readAll(): KernelOp[] {
    return this.runAll(this.stmts.readAll);
  }
  readUntil(hash: string): KernelOp[] {
    return this.runAll(this.stmts.readUntil, { $hash: hash });
  }
  readAfter(hash: string): KernelOp[] {
    return this.runAll(this.stmts.readAfter, { $hash: hash });
  }
  readUntilTimestamp(iso: string): KernelOp[] {
    const stmt = this.db.prepare(
      `SELECT hash, kind, timestamp, agent_id, previous_hash, payload
       FROM ops WHERE timestamp <= $ts ORDER BY rowid ASC`,
    );
    const rows = this.runAll(stmt, { $ts: iso });
    stmt.free();
    return rows;
  }
  getByHash(hash: string): KernelOp | undefined {
    return this.runOne(this.stmts.getByHash, { $hash: hash });
  }
  getLastOp(): KernelOp | undefined {
    return this.runOne(this.stmts.getLast);
  }
  getOpCount(): number {
    this.stmts.count.bind({});
    const has = this.stmts.count.step();
    const row = has ? this.stmts.count.getAsObject() : { cnt: 0 };
    this.stmts.count.reset();
    return Number((row as any).cnt ?? 0);
  }

  saveSnapshot(lastOpHash: string, data: any): void {
    this.stmts.saveSnapshot.run({
      $lastOpHash: lastOpHash,
      $data: typeof data === 'string' ? data : JSON.stringify(data),
    });
    this.stmts.saveSnapshot.reset();
    this.tickFlush();
  }

  loadLatestSnapshot(): { lastOpHash: string; data: any } | undefined {
    this.stmts.loadSnapshot.bind({});
    const has = this.stmts.loadSnapshot.step();
    if (!has) {
      this.stmts.loadSnapshot.reset();
      return undefined;
    }
    const row = this.stmts.loadSnapshot.getAsObject() as any;
    this.stmts.loadSnapshot.reset();
    return { lastOpHash: row.last_op_hash, data: row.data };
  }

  close(): void {
    try {
      this.flushToDisk();
    } finally {
      for (const s of Object.values(this.stmts ?? {})) (s as any)?.free?.();
      this.db?.close?.();
    }
  }

  /** Force a write of the in-memory DB image to disk. */
  flush(): void {
    this.flushToDisk();
  }

  private runAll(
    stmt: SqlJsStatement,
    params: Record<string, any> = {},
  ): KernelOp[] {
    stmt.bind(params);
    const rows: KernelOp[] = [];
    while (stmt.step()) rows.push(rowToOp(stmt.getAsObject() as any));
    stmt.reset();
    return rows;
  }

  private runOne(
    stmt: SqlJsStatement,
    params: Record<string, any> = {},
  ): KernelOp | undefined {
    stmt.bind(params);
    const has = stmt.step();
    const row = has ? (stmt.getAsObject() as any) : undefined;
    stmt.reset();
    return row ? rowToOp(row) : undefined;
  }

  private tickFlush(): void {
    if (this.flushEvery === 0) return;
    if (++this.writes % this.flushEvery === 0) this.flushToDisk();
  }
}

function rowToOp(row: any): KernelOp {
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
