/**
 * Search Integration Tests
 *
 * End-to-end tests for EmbeddingManager: reindex, search, incremental updates.
 * Uses a deterministic mock embedder to avoid model downloads in CI.
 *
 * @see TRL-20
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EmbeddingManager } from '../../src/embeddings/search.js';
import type {
  SearchableEngine,
  Embedder,
} from '../../src/embeddings/search.js';

// ---------------------------------------------------------------------------
// Mock embedder — deterministic hash-based vectors for testing
// ---------------------------------------------------------------------------

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

function mockEmbed(text: string): Promise<Float32Array> {
  const dim = 384;
  const v = new Float32Array(dim);
  const seed = hashCode(text);
  for (let i = 0; i < dim; i++) {
    v[i] = Math.sin(seed * (i + 1) * 0.01);
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) v[i] /= norm;
  return Promise.resolve(v);
}

// ---------------------------------------------------------------------------
// Mock engine
// ---------------------------------------------------------------------------

function createMockEngine(tempDir: string): SearchableEngine {
  const issues = [
    {
      id: 'TRL-1',
      title: 'Add Python parser',
      description: 'Implement AST parsing for Python files',
    },
    {
      id: 'TRL-2',
      title: 'Fix authentication bug',
      description: 'JWT tokens expire too early',
    },
    {
      id: 'TRL-3',
      title: 'Improve search performance',
      description: 'Optimize vector similarity queries',
    },
  ];

  const milestones = [
    { id: 'ms1', message: 'Phase 1: Linked markdown with entity references' },
    { id: 'ms2', message: 'Phase 2: Semantic embeddings and vector search' },
  ];

  // Create directories and files on disk
  mkdirSync(join(tempDir, 'docs'), { recursive: true });
  mkdirSync(join(tempDir, 'src'), { recursive: true });
  writeFileSync(
    join(tempDir, 'docs/design.md'),
    '# Design\nThis doc describes the architecture.\n\n## Authentication\nWe use JWT tokens for auth.\n',
  );
  writeFileSync(
    join(tempDir, 'docs/guide.md'),
    '# User Guide\nHow to use the search feature.\n\n## Semantic Search\nType a natural language query.\n',
  );
  writeFileSync(
    join(tempDir, 'src/engine.ts'),
    'export class Engine { /* code */ }',
  );

  return {
    getRootPath: () => tempDir,
    trackedFiles: () => [
      { path: 'docs/design.md' },
      { path: 'docs/guide.md' },
      { path: 'src/engine.ts' },
    ],
    listIssues: () => issues,
    listMilestones: () => milestones,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let tempDir: string;
let manager: EmbeddingManager;
let engine: SearchableEngine;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'trellis-search-'));
  const dbPath = join(tempDir, 'embeddings.db');
  manager = await EmbeddingManager.create(dbPath, mockEmbed);
  engine = createMockEngine(tempDir);
});

afterEach(() => {
  manager.close();
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

describe('EmbeddingManager reindex', () => {
  it('indexes issues, milestones, and markdown files', async () => {
    const result = await manager.reindex(engine);
    expect(result.chunks).toBeGreaterThan(0);

    const stats = manager.stats();
    expect(stats.total).toBe(result.chunks);
    // Should have issue_title, issue_desc, milestone_msg, and markdown chunks
    expect(stats.byType['issue_title']).toBe(3);
    expect(stats.byType['issue_desc']).toBe(3);
    expect(stats.byType['milestone_msg']).toBe(2);
    expect(stats.byType['markdown']).toBeGreaterThan(0);
  });

  it('clears old data on reindex', async () => {
    await manager.reindex(engine);
    const count1 = manager.stats().total;

    await manager.reindex(engine);
    const count2 = manager.stats().total;

    expect(count2).toBe(count1);
  });
});

describe('EmbeddingManager search', () => {
  it('returns results ranked by similarity', async () => {
    await manager.reindex(engine);
    const results = await manager.search('Python parser');

    expect(results.length).toBeGreaterThan(0);
    // Scores should be sorted descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it('filters by chunk type', async () => {
    await manager.reindex(engine);
    const results = await manager.search('parser', { types: ['issue_title'] });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.chunk.chunkType === 'issue_title')).toBe(
      true,
    );
  });

  it('respects limit', async () => {
    await manager.reindex(engine);
    const results = await manager.search('search', { limit: 2 });

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('filters by file prefix', async () => {
    await manager.reindex(engine);
    const results = await manager.search('architecture', {
      filePrefix: 'docs/',
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.chunk.filePath?.startsWith('docs/'))).toBe(
      true,
    );
  });

  it('returns empty for empty store', async () => {
    const results = await manager.search('anything');
    expect(results).toEqual([]);
  });
});

describe('EmbeddingManager incremental updates', () => {
  it('indexes a single file', async () => {
    const count = await manager.indexFile(
      'docs/new.md',
      '# New Feature\nA new feature description.',
    );
    expect(count).toBeGreaterThan(0);
    expect(manager.stats().total).toBe(count);
  });

  it('replaces file data on re-index', async () => {
    await manager.indexFile('docs/a.md', '# Version 1\nOld content.');
    const stats1 = manager.stats().total;

    await manager.indexFile('docs/a.md', '# Version 2\nNew content.');
    const stats2 = manager.stats().total;

    expect(stats2).toBe(stats1); // Same number of chunks (1 section each)
  });

  it('indexes an issue', async () => {
    const count = await manager.indexIssue({
      id: 'TRL-99',
      title: 'New feature',
      description: 'Something cool',
    });
    expect(count).toBe(2); // title + description
    expect(manager.stats().byType['issue_title']).toBe(1);
    expect(manager.stats().byType['issue_desc']).toBe(1);
  });

  it('indexes a milestone', async () => {
    const count = await manager.indexMilestone({
      id: 'ms99',
      message: 'Big release',
    });
    expect(count).toBe(1);
    expect(manager.stats().byType['milestone_msg']).toBe(1);
  });

  it('removes file data', async () => {
    await manager.indexFile('docs/a.md', '# Content\nSome text.');
    expect(manager.stats().total).toBeGreaterThan(0);

    manager.removeFile('docs/a.md');
    expect(manager.stats().total).toBe(0);
  });
});

describe('EmbeddingManager stats', () => {
  it('reports correct statistics after reindex', async () => {
    await manager.reindex(engine);
    const stats = manager.stats();

    expect(stats.total).toBeGreaterThan(0);
    expect(typeof stats.byType).toBe('object');
    expect(Object.values(stats.byType).reduce((a, b) => a + b, 0)).toBe(
      stats.total,
    );
  });
});
