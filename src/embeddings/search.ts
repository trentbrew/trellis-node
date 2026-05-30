/**
 * Semantic Search Integration
 *
 * Connects the TrellisVcsEngine to the embedding system.
 * Provides reindex (full rebuild) and search (query → ranked results).
 * The embedder function is pluggable for testing with mock vectors.
 *
 * @see TRL-20
 */

import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { VectorStore } from './store.js';
import { embed } from './model.js';
import {
  chunkIssue,
  chunkMilestone,
  chunkDecision,
  chunkMarkdown,
  chunkCodeEntities,
  chunkFile,
} from './chunker.js';
import type {
  ChunkMeta,
  EmbeddingRecord,
  SearchOptions,
  SearchResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal engine interface — avoids importing the full engine for testability */
export interface SearchableEngine {
  getRootPath(): string;
  trackedFiles(): Array<{ path: string; contentHash?: string }>;
  listIssues(filters?: any): Array<{
    id: string;
    title?: string;
    description?: string;
  }>;
  listMilestones(): Array<{ id: string; message?: string }>;
  queryDecisions?(): Array<{
    id: string;
    toolName: string;
    rationale?: string;
    context?: string;
    outputSummary?: string;
  }>;
  parseFile?(filePath: string): any;
}

/** Embedder function type — maps text → vector. Pluggable for testing. */
export type Embedder = (text: string) => Promise<Float32Array>;

// ---------------------------------------------------------------------------
// EmbeddingManager
// ---------------------------------------------------------------------------

export class EmbeddingManager {
  private store: VectorStore;
  private embedFn: Embedder;

  private constructor(store: VectorStore, embedFn: Embedder) {
    this.store = store;
    this.embedFn = embedFn;
  }

  static async create(dbPath: string, embedFn?: Embedder): Promise<EmbeddingManager> {
    const store = await VectorStore.create(dbPath);
    return new EmbeddingManager(store, embedFn ?? embed);
  }

  /**
   * Full reindex: clear store, re-chunk all entities, embed, and insert.
   */
  async reindex(engine: SearchableEngine): Promise<{ chunks: number }> {
    this.store.clear();

    const allChunks: ChunkMeta[] = [];

    // 1. Issues
    const issues = engine.listIssues();
    for (const issue of issues) {
      allChunks.push(...chunkIssue(issue));
    }

    // 2. Milestones
    const milestones = engine.listMilestones();
    for (const ms of milestones) {
      allChunks.push(...chunkMilestone(ms));
    }

    // 3. Decisions
    if (engine.queryDecisions) {
      const decisions = engine.queryDecisions();
      for (const dec of decisions) {
        allChunks.push(...chunkDecision(dec));
      }
    }

    // 4. Files (markdown, summaries)
    const rootPath = engine.getRootPath();
    const trackedFiles = engine.trackedFiles();
    for (const tf of trackedFiles) {
      try {
        const absPath = join(rootPath, tf.path);
        if (!existsSync(absPath)) continue;
        const content = readFileSync(absPath, 'utf-8');
        allChunks.push(...chunkFile(tf.path, content));
      } catch {}
    }

    // 5. Code entities (from parsed files)
    if (engine.parseFile) {
      for (const tf of trackedFiles) {
        const ext = tf.path.split('.').pop()?.toLowerCase() ?? '';
        if (
          ![
            'ts',
            'js',
            'tsx',
            'jsx',
            'py',
            'go',
            'rs',
            'rb',
            'java',
            'cs',
          ].includes(ext)
        ) {
          continue;
        }
        try {
          const parsed = engine.parseFile(tf.path);
          if (parsed && Array.isArray(parsed.entities)) {
            const declarations = parsed.entities.map((e: any) => ({
              id: e.id ?? e.name,
              name: e.name,
              kind: e.kind,
              signature: e.signature ?? e.rawText?.split('\n')[0] ?? '',
              docComment: e.docComment,
            }));
            allChunks.push(...chunkCodeEntities(tf.path, declarations));
          }
        } catch {}
      }
    }

    // Embed and insert all chunks
    const records: EmbeddingRecord[] = [];
    for (const chunk of allChunks) {
      try {
        const vector = await this.embedFn(chunk.content);
        records.push({ ...chunk, embedding: vector });
      } catch {}
    }

    this.store.upsertBatch(records);

    return { chunks: records.length };
  }

  /**
   * Incrementally index a single file (on file change).
   */
  async indexFile(
    filePath: string,
    content: string,
    engine?: SearchableEngine,
  ): Promise<number> {
    // Remove old chunks for this file
    this.store.deleteByFile(filePath);

    const chunks = chunkFile(filePath, content);

    // Also index code entities if engine is available
    if (engine?.parseFile) {
      const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
      if (
        [
          'ts',
          'js',
          'tsx',
          'jsx',
          'py',
          'go',
          'rs',
          'rb',
          'java',
          'cs',
        ].includes(ext)
      ) {
        try {
          const parsed = engine.parseFile(filePath);
          if (parsed && Array.isArray(parsed.entities)) {
            const declarations = parsed.entities.map((e: any) => ({
              id: e.id ?? e.name,
              name: e.name,
              kind: e.kind,
              signature: e.signature ?? e.rawText?.split('\n')[0] ?? '',
              docComment: e.docComment,
            }));
            chunks.push(...chunkCodeEntities(filePath, declarations));
          }
        } catch {}
      }
    }

    const records: EmbeddingRecord[] = [];
    for (const chunk of chunks) {
      try {
        const vector = await this.embedFn(chunk.content);
        records.push({ ...chunk, embedding: vector });
      } catch {}
    }

    if (records.length > 0) {
      this.store.upsertBatch(records);
    }

    return records.length;
  }

  /**
   * Index an issue (on create/update).
   */
  async indexIssue(issue: {
    id: string;
    title?: string;
    description?: string;
  }): Promise<number> {
    this.store.deleteByEntity(`issue:${issue.id}`);

    const chunks = chunkIssue(issue);
    const records: EmbeddingRecord[] = [];

    for (const chunk of chunks) {
      try {
        const vector = await this.embedFn(chunk.content);
        records.push({ ...chunk, embedding: vector });
      } catch {}
    }

    if (records.length > 0) {
      this.store.upsertBatch(records);
    }

    return records.length;
  }

  /**
   * Index a milestone (on create).
   */
  async indexMilestone(milestone: {
    id: string;
    message?: string;
  }): Promise<number> {
    this.store.deleteByEntity(`milestone:${milestone.id}`);

    const chunks = chunkMilestone(milestone);
    const records: EmbeddingRecord[] = [];

    for (const chunk of chunks) {
      try {
        const vector = await this.embedFn(chunk.content);
        records.push({ ...chunk, embedding: vector });
      } catch {}
    }

    if (records.length > 0) {
      this.store.upsertBatch(records);
    }

    return records.length;
  }

  /**
   * Semantic search: embed query → vector search → ranked results.
   */
  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const queryVector = await this.embedFn(query);
    return this.store.search(queryVector, opts);
  }

  /**
   * Remove all data for a file.
   */
  removeFile(filePath: string): void {
    this.store.deleteByFile(filePath);
  }

  /**
   * Get store statistics.
   */
  stats(): { total: number; byType: Record<string, number> } {
    return {
      total: this.store.count(),
      byType: this.store.countByType(),
    };
  }

  /**
   * Close the store.
   */
  close(): void {
    this.store.close();
  }
}
