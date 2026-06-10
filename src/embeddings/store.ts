/**
 * Embedding Vector Store
 *
 * Persistent storage for embedding vectors using sql.js (pure WASM SQLite).
 * Works in Bun, Node, and WebContainer — no native addons required.
 * Vectors are stored as Float32Array blobs; cosine similarity is computed
 * in JavaScript for cross-platform portability.
 *
 * @see TRL-18
 * @see TRL-2 (migrated from bun:sqlite to sql.js)
 */

import type {
  ChunkMeta,
  ChunkType,
  EmbeddingRecord,
  SearchOptions,
  SearchResult,
} from './types.js';

type SqlJsDatabase = any;
type SqlJsStatement = any;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  content TEXT NOT NULL,
  chunk_type TEXT NOT NULL,
  file_path TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vectors (
  id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  FOREIGN KEY (id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_entity ON chunks(entity_id);
CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(chunk_type);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
`;

// ---------------------------------------------------------------------------
// Vector Store
// ---------------------------------------------------------------------------

export class VectorStore {
  private db!: SqlJsDatabase;
  private stmts!: Record<string, SqlJsStatement>;
  private writes = 0;

  private constructor(private dbPath: string) {}

  /**
   * Async factory — sql.js WASM init is async, but after bootstrap the store
   * exposes a synchronous-style public API.
   */
  static async create(dbPath: string): Promise<VectorStore> {
    const store = new VectorStore(dbPath);
    await store.bootstrap();
    return store;
  }

  private async bootstrap(): Promise<void> {
    let initSqlJs: (cfg?: any) => Promise<any>;
    try {
      const mod: any = await import('sql.js');
      initSqlJs = mod.default ?? mod;
    } catch {
      throw new Error(
        'VectorStore requires the optional dependency "sql.js". ' +
          'Install it: npm install sql.js',
      );
    }

    let sqljsDistDir: string | null = null;
    if (typeof window === 'undefined') {
      try {
        const moduleMod: any = await import('module');
        const pathMod: any = await import('path');
        const req = (moduleMod as any).createRequire(import.meta.url);
        const sqlJsEntry: string = req.resolve('sql.js');
        sqljsDistDir = (pathMod as any).dirname(sqlJsEntry);
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

    this.db.run('PRAGMA foreign_keys = ON;');
    this.db.run(SCHEMA_SQL);
    this.prepareStatements();
  }

  private loadFromDisk(): Uint8Array | null {
    if (this.dbPath === ':memory:') return null;
    try {
      const fs = require('fs');
      if (!fs.existsSync(this.dbPath)) return null;
      return new Uint8Array(fs.readFileSync(this.dbPath));
    } catch {
      return null;
    }
  }

  private flushToDisk(): void {
    if (this.dbPath === ':memory:') return;
    try {
      const fs = require('fs');
      const path = require('path');
      // sql.js `export()` frees all prepared statements and closes/reopens the
      // underlying database, which invalidates the handles cached in
      // `this.stmts`. Re-prepare them afterwards so subsequent writes/reads on
      // this store instance keep working.
      const data = this.db.export();
      this.prepareStatements();
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      const tmp = `${this.dbPath}.tmp`;
      fs.writeFileSync(tmp, Buffer.from(data));
      fs.renameSync(tmp, this.dbPath);
    } catch {
      // No-op in browser-without-fs environments.
    }
  }

  private prepareStatements(): void {
    this.stmts = {
      upsertChunk: this.db.prepare(`
        INSERT OR REPLACE INTO chunks (id, entity_id, content, chunk_type, file_path, updated_at)
        VALUES ($id, $entityId, $content, $chunkType, $filePath, $updatedAt)
      `),
      upsertVector: this.db.prepare(`
        INSERT OR REPLACE INTO vectors (id, embedding)
        VALUES ($id, $embedding)
      `),
      deleteVector: this.db.prepare('DELETE FROM vectors WHERE id = $id'),
      deleteChunk: this.db.prepare('DELETE FROM chunks WHERE id = $id'),
      getChunkById: this.db.prepare('SELECT * FROM chunks WHERE id = $id'),
      getChunkIdsByEntity: this.db.prepare(
        'SELECT id FROM chunks WHERE entity_id = $entityId',
      ),
      getChunkIdsByFile: this.db.prepare(
        'SELECT id FROM chunks WHERE file_path = $filePath',
      ),
      count: this.db.prepare('SELECT COUNT(*) AS cnt FROM chunks'),
      countByType: this.db.prepare(
        'SELECT chunk_type, COUNT(*) AS cnt FROM chunks GROUP BY chunk_type',
      ),
    };
  }

  /**
   * Insert or update a chunk with its embedding vector.
   */
  upsert(record: EmbeddingRecord): void {
    const embeddingBlob = new Uint8Array(record.embedding.buffer);
    this.db.run('BEGIN');
    try {
      this.stmts.upsertChunk.run({
        $id: record.id,
        $entityId: record.entityId,
        $content: record.content,
        $chunkType: record.chunkType,
        $filePath: record.filePath ?? null,
        $updatedAt: record.updatedAt,
      });
      this.stmts.upsertChunk.reset();
      this.stmts.upsertVector.run({
        $id: record.id,
        $embedding: embeddingBlob,
      });
      this.stmts.upsertVector.reset();
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
    this.tickFlush();
  }

  /**
   * Batch upsert multiple records.
   */
  upsertBatch(records: EmbeddingRecord[]): void {
    if (records.length === 0) return;
    this.db.run('BEGIN');
    try {
      for (const record of records) {
        const embeddingBlob = new Uint8Array(record.embedding.buffer);
        this.stmts.upsertChunk.run({
          $id: record.id,
          $entityId: record.entityId,
          $content: record.content,
          $chunkType: record.chunkType,
          $filePath: record.filePath ?? null,
          $updatedAt: record.updatedAt,
        });
        this.stmts.upsertChunk.reset();
        this.stmts.upsertVector.run({
          $id: record.id,
          $embedding: embeddingBlob,
        });
        this.stmts.upsertVector.reset();
      }
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
    this.tickFlush();
  }

  /**
   * Delete a chunk and its vector by ID.
   */
  delete(id: string): void {
    this.stmts.deleteVector.run({ $id: id });
    this.stmts.deleteVector.reset();
    this.stmts.deleteChunk.run({ $id: id });
    this.stmts.deleteChunk.reset();
    this.tickFlush();
  }

  /**
   * Delete all chunks for an entity.
   */
  deleteByEntity(entityId: string): void {
    const ids = this.runAll(this.stmts.getChunkIdsByEntity, {
      $entityId: entityId,
    }).map((r: any) => r.id as string);
    if (ids.length === 0) return;
    this.db.run('BEGIN');
    try {
      for (const id of ids) {
        this.stmts.deleteVector.run({ $id: id });
        this.stmts.deleteVector.reset();
        this.stmts.deleteChunk.run({ $id: id });
        this.stmts.deleteChunk.reset();
      }
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
    this.tickFlush();
  }

  /**
   * Delete all chunks associated with a file path.
   */
  deleteByFile(filePath: string): void {
    const ids = this.runAll(this.stmts.getChunkIdsByFile, {
      $filePath: filePath,
    }).map((r: any) => r.id as string);
    if (ids.length === 0) return;
    this.db.run('BEGIN');
    try {
      for (const id of ids) {
        this.stmts.deleteVector.run({ $id: id });
        this.stmts.deleteVector.reset();
        this.stmts.deleteChunk.run({ $id: id });
        this.stmts.deleteChunk.reset();
      }
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
    this.tickFlush();
  }

  /**
   * Get a chunk by ID (without vector).
   */
  getChunk(id: string): ChunkMeta | null {
    const row = this.runOne(this.stmts.getChunkById, { $id: id });
    return row ? rowToChunkMeta(row) : null;
  }

  /**
   * Search for chunks similar to the query vector.
   * Uses brute-force cosine similarity scan.
   */
  search(queryVector: Float32Array, opts: SearchOptions = {}): SearchResult[] {
    const limit = opts.limit ?? 10;
    const minScore = opts.minScore ?? 0.0;

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (opts.types && opts.types.length > 0) {
      const placeholders = opts.types.map((_, i) => `$type${i}`).join(', ');
      conditions.push(`c.chunk_type IN (${placeholders})`);
      opts.types.forEach((t, i) => {
        params[`$type${i}`] = t;
      });
    }

    if (opts.filePrefix) {
      conditions.push('c.file_path LIKE $filePrefix');
      params.$filePrefix = `${opts.filePrefix}%`;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT c.id, c.entity_id, c.content, c.chunk_type, c.file_path, c.updated_at,
             v.embedding
      FROM chunks c
      JOIN vectors v ON c.id = v.id
      ${where}
    `;

    const stmt = this.db.prepare(sql);
    const rows = this.runAll(stmt, params);
    stmt.free();

    const scored: SearchResult[] = [];
    for (const row of rows) {
      const embeddingBytes = row.embedding as Uint8Array;
      // sql.js returns a view into its WASM heap — slice to get an owned copy
      const ownedBuf = embeddingBytes.buffer.slice(
        embeddingBytes.byteOffset,
        embeddingBytes.byteOffset + embeddingBytes.byteLength,
      );
      const storedVec = new Float32Array(ownedBuf);
      const score = cosineSimilarity(queryVector, storedVec);
      if (score >= minScore) {
        scored.push({ chunk: rowToChunkMeta(row), score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Get total count of chunks in the store.
   */
  count(): number {
    const row = this.runOne(this.stmts.count);
    return Number((row as any)?.cnt ?? 0);
  }

  /**
   * Get count by chunk type.
   */
  countByType(): Record<string, number> {
    const rows = this.runAll(this.stmts.countByType);
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[(row as any).chunk_type] = (row as any).cnt;
    }
    return result;
  }

  /**
   * Clear all data from the store.
   */
  clear(): void {
    this.db.run('DELETE FROM vectors');
    this.db.run('DELETE FROM chunks');
    this.tickFlush();
  }

  /**
   * Force a write of the in-memory DB image to disk.
   */
  flush(): void {
    this.flushToDisk();
  }

  /**
   * Close the database connection.
   */
  close(): void {
    try {
      this.flushToDisk();
    } finally {
      for (const s of Object.values(this.stmts ?? {})) (s as any)?.free?.();
      this.db?.close?.();
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private runAll(
    stmt: SqlJsStatement,
    params: Record<string, any> = {},
  ): any[] {
    stmt.bind(params);
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.reset();
    return rows;
  }

  private runOne(
    stmt: SqlJsStatement,
    params: Record<string, any> = {},
  ): any | undefined {
    stmt.bind(params);
    const has = stmt.step();
    const row = has ? stmt.getAsObject() : undefined;
    stmt.reset();
    return row;
  }

  private tickFlush(): void {
    if (++this.writes % 50 === 0) this.flushToDisk();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToChunkMeta(row: any): ChunkMeta {
  return {
    id: row.id,
    entityId: row.entity_id,
    content: row.content,
    chunkType: row.chunk_type as ChunkType,
    filePath: row.file_path ?? undefined,
    updatedAt: row.updated_at,
  };
}

/**
 * Compute cosine similarity between two vectors.
 * Both vectors should already be normalized (output of mean pooling + normalize).
 * For normalized vectors, cosine similarity = dot product.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
