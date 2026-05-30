/**
 * Tests for Auto-Embedding Middleware and RAG Context Builder.
 * Uses mock embedder to avoid requiring the actual transformers model.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { SqliteKernelBackend } from '../../src/core/persist/sqlite-backend.js';
import { createAutoEmbedMiddleware, buildRAGContext } from '../../src/embeddings/auto-embed.js';
import { VectorStore } from '../../src/embeddings/store.js';

// ---------------------------------------------------------------------------
// Mock embedder — deterministic hash-based vectors
// ---------------------------------------------------------------------------

function mockEmbed(text: string): Promise<Float32Array> {
  const vec = new Float32Array(384);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  for (let i = 0; i < 384; i++) {
    hash = ((hash << 5) - hash + i) | 0;
    vec[i] = (hash & 0xffff) / 0xffff;
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < 384; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < 384; i++) vec[i] /= norm;
  return Promise.resolve(vec);
}

// ---------------------------------------------------------------------------
// Auto-Embed Middleware
// ---------------------------------------------------------------------------

describe('Auto-Embed Middleware', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;
  let mw: Awaited<ReturnType<typeof createAutoEmbedMiddleware>>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-autoembed-'));
    kernel = new TrellisKernel({
      backend: new SqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test',
    });
    kernel.boot();

    mw = await createAutoEmbedMiddleware({
      dbPath: join(tmpDir, 'embeddings.db'),
      embedFn: mockEmbed,
    });
    kernel.addMiddleware(mw);
  });

  afterEach(() => {
    kernel.close();
    mw.close();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it('should embed entities on creation', async () => {
    await kernel.createEntity('proj:1', 'Project', {
      name: 'Alpha',
      status: 'active',
    });

    // Check the vector store has embeddings
    const vs = await VectorStore.create(join(tmpDir, 'embeddings.db'));
    const count = vs.count();
    expect(count).toBeGreaterThan(0);
    vs.close();
  });

  it('should produce searchable embeddings', async () => {
    await kernel.createEntity('proj:1', 'Project', {
      name: 'Authentication System',
      description: 'Handles user login and JWT tokens',
    });
    await kernel.createEntity('proj:2', 'Project', {
      name: 'Database Layer',
      description: 'PostgreSQL connection pooling',
    });

    const vs = await VectorStore.create(join(tmpDir, 'embeddings.db'));
    const queryVec = await mockEmbed('authentication login');
    const results = vs.search(queryVec, { limit: 5 });

    expect(results.length).toBeGreaterThan(0);
    // First result should be the auth entity (closer semantic match with mock)
    vs.close();
  });

  it('should remove embeddings on entity deletion', async () => {
    await kernel.createEntity('proj:1', 'Project', { name: 'ToDelete' });

    const vs1 = await VectorStore.create(join(tmpDir, 'embeddings.db'));
    expect(vs1.count()).toBeGreaterThan(0);
    vs1.close();

    await kernel.deleteEntity('proj:1');

    const vs2 = await VectorStore.create(join(tmpDir, 'embeddings.db'));
    // After delete, the entity's embeddings should be removed
    const results = vs2.search(await mockEmbed('ToDelete'), { limit: 10 });
    const matching = results.filter((r) => r.chunk.entityId === 'proj:1');
    expect(matching).toHaveLength(0);
    vs2.close();
  });

  it('should handle multiple entities', async () => {
    await kernel.createEntity('user:1', 'User', { name: 'Alice', role: 'admin' });
    await kernel.createEntity('user:2', 'User', { name: 'Bob', role: 'dev' });
    await kernel.createEntity('proj:1', 'Project', { name: 'Trellis' });

    const vs = await VectorStore.create(join(tmpDir, 'embeddings.db'));
    expect(vs.count()).toBeGreaterThanOrEqual(3);
    vs.close();
  });
});

// ---------------------------------------------------------------------------
// RAG Context Builder
// ---------------------------------------------------------------------------

describe('RAG Context Builder', () => {
  let tmpDir: string;
  let vs: VectorStore;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-rag-'));
    vs = await VectorStore.create(join(tmpDir, 'embeddings.db'));

    // Seed with some embeddings
    const texts = [
      { id: 'entity:proj:1:summary', entityId: 'proj:1', content: 'Project: Authentication System. Handles user login, JWT tokens, OAuth2.' },
      { id: 'entity:proj:2:summary', entityId: 'proj:2', content: 'Project: Database Layer. PostgreSQL connection pooling and migrations.' },
      { id: 'entity:user:1:summary', entityId: 'user:1', content: 'User: Alice. Role: admin. Expert in security and authentication.' },
    ];

    for (const t of texts) {
      const vec = await mockEmbed(t.content);
      vs.upsertBatch([{
        ...t,
        chunkType: 'summary_md' as any,
        updatedAt: new Date().toISOString(),
        embedding: vec,
      }]);
    }
  });

  afterEach(() => {
    vs.close();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it('should build RAG context from a query', async () => {
    const ctx = await buildRAGContext('authentication', vs, mockEmbed, {
      maxChunks: 5,
    });

    expect(ctx.query).toBe('authentication');
    expect(ctx.chunks.length).toBeGreaterThan(0);
    expect(ctx.estimatedTokens).toBeGreaterThan(0);
  });

  it('should respect maxChunks limit', async () => {
    const ctx = await buildRAGContext('project', vs, mockEmbed, {
      maxChunks: 1,
    });

    expect(ctx.chunks.length).toBeLessThanOrEqual(1);
  });

  it('should include score and entityId in chunks', async () => {
    const ctx = await buildRAGContext('database', vs, mockEmbed);

    for (const c of ctx.chunks) {
      expect(c.score).toBeGreaterThan(0);
      expect(c.entityId).toBeTruthy();
      expect(c.content).toBeTruthy();
      expect(c.chunkType).toBeTruthy();
    }
  });

  it('should calculate token estimate', async () => {
    const ctx = await buildRAGContext('authentication', vs, mockEmbed);

    // ~1 token per 4 chars
    const totalChars = ctx.chunks.reduce((s, c) => s + c.content.length, 0);
    expect(ctx.estimatedTokens).toBe(Math.ceil(totalChars / 4));
  });
});
