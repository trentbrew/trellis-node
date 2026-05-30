/**
 * Vector Store Tests
 *
 * Tests SQLite-backed vector storage: insert, query, delete, search.
 *
 * @see TRL-18
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { VectorStore, cosineSimilarity } from '../../src/embeddings/store.js';
import type { EmbeddingRecord } from '../../src/embeddings/types.js';

let store: VectorStore;
let dbPath: string;
let tempDir: string;

function makeVector(seed: number, dim = 384): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    v[i] = Math.sin(seed * (i + 1) * 0.1);
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

function makeRecord(
  id: string,
  entityId: string,
  content: string,
  chunkType: string,
  seed: number,
  filePath?: string,
): EmbeddingRecord {
  return {
    id,
    entityId,
    content,
    chunkType: chunkType as any,
    filePath,
    updatedAt: new Date().toISOString(),
    embedding: makeVector(seed),
  };
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'trellis-vec-'));
  dbPath = join(tempDir, 'embeddings.db');
  store = await VectorStore.create(dbPath);
});

afterEach(() => {
  store.close();
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

// ---------------------------------------------------------------------------
// Basic CRUD
// ---------------------------------------------------------------------------

describe('VectorStore CRUD', () => {
  it('inserts and retrieves a chunk', () => {
    const rec = makeRecord('issue:TRL-1:title', 'issue:TRL-1', 'Add parser', 'issue_title', 1);
    store.upsert(rec);

    const chunk = store.getChunk('issue:TRL-1:title');
    expect(chunk).not.toBeNull();
    expect(chunk!.id).toBe('issue:TRL-1:title');
    expect(chunk!.entityId).toBe('issue:TRL-1');
    expect(chunk!.content).toBe('Add parser');
    expect(chunk!.chunkType).toBe('issue_title');
  });

  it('upserts (replaces) existing record', () => {
    const rec1 = makeRecord('issue:TRL-1:title', 'issue:TRL-1', 'Add parser', 'issue_title', 1);
    store.upsert(rec1);

    const rec2 = makeRecord('issue:TRL-1:title', 'issue:TRL-1', 'Add Python parser', 'issue_title', 2);
    store.upsert(rec2);

    const chunk = store.getChunk('issue:TRL-1:title');
    expect(chunk!.content).toBe('Add Python parser');
    expect(store.count()).toBe(1);
  });

  it('deletes a chunk by ID', () => {
    store.upsert(makeRecord('a', 'e1', 'text', 'issue_title', 1));
    store.upsert(makeRecord('b', 'e2', 'text2', 'issue_title', 2));

    store.delete('a');
    expect(store.getChunk('a')).toBeNull();
    expect(store.getChunk('b')).not.toBeNull();
    expect(store.count()).toBe(1);
  });

  it('deletes all chunks for an entity', () => {
    store.upsert(makeRecord('issue:TRL-1:title', 'issue:TRL-1', 'Title', 'issue_title', 1));
    store.upsert(makeRecord('issue:TRL-1:desc', 'issue:TRL-1', 'Desc', 'issue_desc', 2));
    store.upsert(makeRecord('issue:TRL-2:title', 'issue:TRL-2', 'Other', 'issue_title', 3));

    store.deleteByEntity('issue:TRL-1');
    expect(store.count()).toBe(1);
    expect(store.getChunk('issue:TRL-2:title')).not.toBeNull();
  });

  it('deletes all chunks for a file path', () => {
    store.upsert(makeRecord('f1:s0', 'file:a.md', 'Section 1', 'markdown', 1, 'a.md'));
    store.upsert(makeRecord('f1:s1', 'file:a.md', 'Section 2', 'markdown', 2, 'a.md'));
    store.upsert(makeRecord('f2:s0', 'file:b.md', 'Other', 'markdown', 3, 'b.md'));

    store.deleteByFile('a.md');
    expect(store.count()).toBe(1);
    expect(store.getChunk('f2:s0')).not.toBeNull();
  });

  it('batch upserts multiple records', () => {
    const records = [
      makeRecord('a', 'e1', 'text1', 'issue_title', 1),
      makeRecord('b', 'e2', 'text2', 'issue_desc', 2),
      makeRecord('c', 'e3', 'text3', 'milestone_msg', 3),
    ];
    store.upsertBatch(records);
    expect(store.count()).toBe(3);
  });

  it('clears all data', () => {
    store.upsertBatch([
      makeRecord('a', 'e1', 'text1', 'issue_title', 1),
      makeRecord('b', 'e2', 'text2', 'issue_desc', 2),
    ]);
    store.clear();
    expect(store.count()).toBe(0);
  });

  it('counts by type', () => {
    store.upsertBatch([
      makeRecord('a', 'e1', 'text1', 'issue_title', 1),
      makeRecord('b', 'e2', 'text2', 'issue_title', 2),
      makeRecord('c', 'e3', 'text3', 'markdown', 3),
    ]);
    const counts = store.countByType();
    expect(counts['issue_title']).toBe(2);
    expect(counts['markdown']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Vector Search
// ---------------------------------------------------------------------------

describe('VectorStore search', () => {
  it('returns results sorted by similarity', () => {
    // Insert 3 records with different vectors
    store.upsert(makeRecord('a', 'e1', 'alpha', 'issue_title', 1));
    store.upsert(makeRecord('b', 'e2', 'beta', 'issue_title', 2));
    store.upsert(makeRecord('c', 'e3', 'gamma', 'issue_title', 3));

    // Search with vector similar to seed=1
    const queryVec = makeVector(1);
    const results = store.search(queryVec);

    expect(results.length).toBe(3);
    // First result should be the most similar (same seed)
    expect(results[0].chunk.id).toBe('a');
    expect(results[0].score).toBeGreaterThan(0.99);
    // All results should be sorted descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it('respects limit option', () => {
    for (let i = 0; i < 10; i++) {
      store.upsert(makeRecord(`r${i}`, `e${i}`, `text ${i}`, 'issue_title', i));
    }

    const results = store.search(makeVector(5), { limit: 3 });
    expect(results.length).toBe(3);
  });

  it('filters by chunk type', () => {
    store.upsert(makeRecord('a', 'e1', 'alpha', 'issue_title', 1));
    store.upsert(makeRecord('b', 'e2', 'beta', 'markdown', 1.1));
    store.upsert(makeRecord('c', 'e3', 'gamma', 'code_entity', 1.2));

    const results = store.search(makeVector(1), { types: ['issue_title'] });
    expect(results.length).toBe(1);
    expect(results[0].chunk.chunkType).toBe('issue_title');
  });

  it('filters by file prefix', () => {
    store.upsert(makeRecord('a', 'e1', 'alpha', 'markdown', 1, 'src/engine.ts'));
    store.upsert(makeRecord('b', 'e2', 'beta', 'markdown', 2, 'src/vcs/types.ts'));
    store.upsert(makeRecord('c', 'e3', 'gamma', 'markdown', 3, 'docs/readme.md'));

    const results = store.search(makeVector(1), { filePrefix: 'src/' });
    expect(results.length).toBe(2);
    expect(results.every((r) => r.chunk.filePath?.startsWith('src/'))).toBe(true);
  });

  it('respects minScore threshold', () => {
    store.upsert(makeRecord('a', 'e1', 'match', 'issue_title', 1));
    store.upsert(makeRecord('b', 'e2', 'distant', 'issue_title', 100));

    const results = store.search(makeVector(1), { minScore: 0.5 });
    // The exact match should pass, the distant one may not
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].chunk.id).toBe('a');
    expect(results.every((r) => r.score >= 0.5)).toBe(true);
  });

  it('returns empty for empty store', () => {
    const results = store.search(makeVector(1));
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cosine Similarity
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = makeVector(42);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns ~0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it('returns 0 for zero-length vectors', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});
