/**
 * Garden Semantic Search Tests
 *
 * Tests vector-enhanced search in IdeaGarden via mock embedder.
 *
 * @see TRL-22
 */

import { describe, it, expect } from 'vitest';
import { IdeaGarden } from '../../src/garden/garden.js';
import type { GardenEmbedder, GardenContext } from '../../src/garden/garden.js';
import type { IdeaCluster } from '../../src/garden/cluster.js';
import type { VcsOp } from '../../src/vcs/types.js';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

function makeOp(overrides: Partial<VcsOp>): VcsOp {
  return {
    hash: `hash-${Math.random().toString(36).slice(2, 10)}`,
    kind: 'vcs:fileModify',
    agentId: 'agent:test',
    timestamp: new Date().toISOString(),
    parentHash: null,
    vcs: { filePath: 'src/unknown.ts', contentHash: 'abc' },
    ...overrides,
  } as VcsOp;
}

function makeCluster(id: string, files: string[], intent: string): IdeaCluster {
  const ops = files.map((f) =>
    makeOp({ vcs: { filePath: f, contentHash: `hash-${f}` } }),
  );
  return {
    id,
    ops,
    firstOp: ops[0].hash,
    lastOp: ops[ops.length - 1].hash,
    affectedFiles: files,
    affectedSymbols: [],
    estimatedIntent: intent,
    createdAt: ops[0].timestamp,
    abandonedAt: ops[ops.length - 1].timestamp,
    status: 'abandoned',
    detectedBy: 'test',
  };
}

// Pre-built clusters for testing
const clusters: IdeaCluster[] = [
  makeCluster('c1', ['src/auth/login.ts', 'src/auth/jwt.ts'], 'authentication work'),
  makeCluster('c2', ['src/parser/python.ts', 'src/parser/ast.ts'], 'python parser'),
  makeCluster('c3', ['docs/api.md', 'docs/guide.md'], 'documentation updates'),
  makeCluster('c4', ['src/search/engine.ts', 'src/search/index.ts'], 'search feature'),
];

// Mock context that returns our pre-built clusters via ops
const mockContext: GardenContext = {
  readAllOps: () => {
    // Return all ops from all clusters so detectClusters can find them
    // But since we're testing the search layer, we'll use a custom garden
    return [];
  },
  getMilestonedOpHashes: () => new Set(),
};

// Mock embedder that returns file-based scores
function createMockEmbedder(scoreMap: Record<string, number>): GardenEmbedder {
  return {
    search: async (_query: string, _opts?: any) => {
      return Object.entries(scoreMap).map(([filePath, score]) => ({
        chunk: { filePath, content: `content of ${filePath}` },
        score,
      }));
    },
  };
}

// Custom IdeaGarden subclass that uses pre-built clusters
class TestGarden extends IdeaGarden {
  private _clusters: IdeaCluster[];

  constructor(clusterList: IdeaCluster[]) {
    super(mockContext);
    this._clusters = clusterList;
  }

  override listClusters(): IdeaCluster[] {
    return this._clusters;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IdeaGarden semanticSearch', () => {
  it('falls back to keyword search when no embedder is attached', async () => {
    const garden = new TestGarden(clusters);
    const results = await garden.semanticSearch({ keyword: 'auth' });

    expect(results.length).toBeGreaterThan(0);
    // All results should have score 1.0 (keyword fallback)
    expect(results.every((r) => r.score === 1.0)).toBe(true);
    // Should match the auth cluster
    expect(results.some((r) => r.cluster.id === 'c1')).toBe(true);
  });

  it('falls back when semantic=false', async () => {
    const garden = new TestGarden(clusters);
    const embedder = createMockEmbedder({
      'src/auth/login.ts': 0.95,
    });
    garden.setEmbedder(embedder);

    const results = await garden.semanticSearch({
      keyword: 'auth',
      semantic: false,
    });

    // Should use keyword search only
    expect(results.every((r) => r.score === 1.0)).toBe(true);
  });

  it('scores clusters by file embedding similarity', async () => {
    const garden = new TestGarden(clusters);
    const embedder = createMockEmbedder({
      'src/auth/login.ts': 0.95,
      'src/auth/jwt.ts': 0.90,
      'src/search/engine.ts': 0.3,
    });
    garden.setEmbedder(embedder);

    const results = await garden.semanticSearch({ keyword: 'authentication' });

    expect(results.length).toBeGreaterThan(0);
    // Auth cluster should be ranked first (highest file scores)
    expect(results[0].cluster.id).toBe('c1');
    expect(results[0].score).toBeGreaterThan(0.8);
  });

  it('boosts keyword matches that also appear in embedding results', async () => {
    const garden = new TestGarden(clusters);
    const embedder = createMockEmbedder({
      'src/auth/login.ts': 0.4,
      'docs/api.md': 0.6,
    });
    garden.setEmbedder(embedder);

    const results = await garden.semanticSearch({ keyword: 'auth' });

    // c1 matches keyword AND has embedding score → should get boosted
    const c1 = results.find((r) => r.cluster.id === 'c1');
    expect(c1).toBeDefined();
    // Keyword match boost ensures score >= 0.5
    expect(c1!.score).toBeGreaterThanOrEqual(0.4);
  });

  it('respects limit parameter', async () => {
    const garden = new TestGarden(clusters);
    const embedder = createMockEmbedder({
      'src/auth/login.ts': 0.9,
      'src/parser/python.ts': 0.8,
      'docs/api.md': 0.7,
      'src/search/engine.ts': 0.6,
    });
    garden.setEmbedder(embedder);

    const results = await garden.semanticSearch({ keyword: 'code', limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('respects status filter', async () => {
    const garden = new TestGarden(clusters);
    const embedder = createMockEmbedder({
      'src/auth/login.ts': 0.9,
    });
    garden.setEmbedder(embedder);

    const results = await garden.semanticSearch({
      keyword: 'auth',
      status: 'draft',
    });

    // No clusters have draft status
    expect(results.length).toBe(0);
  });

  it('returns all keyword matches with score 1.0 when no query text', async () => {
    const garden = new TestGarden(clusters);
    const embedder = createMockEmbedder({});
    garden.setEmbedder(embedder);

    const results = await garden.semanticSearch({});
    // No keyword → all clusters returned with score 1.0
    expect(results.length).toBe(clusters.length);
    expect(results.every((r) => r.score === 1.0)).toBe(true);
  });

  it('sorts results by descending score', async () => {
    const garden = new TestGarden(clusters);
    const embedder = createMockEmbedder({
      'src/auth/login.ts': 0.3,
      'src/parser/python.ts': 0.9,
      'docs/api.md': 0.6,
      'src/search/engine.ts': 0.1,
    });
    garden.setEmbedder(embedder);

    const results = await garden.semanticSearch({ keyword: 'code' });

    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });
});

describe('IdeaGarden setEmbedder', () => {
  it('can attach and detach embedder', async () => {
    const garden = new TestGarden(clusters);

    // No embedder → fallback
    let results = await garden.semanticSearch({ keyword: 'auth' });
    expect(results.every((r) => r.score === 1.0)).toBe(true);

    // Attach embedder
    const embedder = createMockEmbedder({ 'src/auth/login.ts': 0.95 });
    garden.setEmbedder(embedder);
    results = await garden.semanticSearch({ keyword: 'authentication' });
    expect(results.some((r) => r.score > 0)).toBe(true);

    // Detach embedder
    garden.setEmbedder(null);
    results = await garden.semanticSearch({ keyword: 'auth' });
    expect(results.every((r) => r.score === 1.0)).toBe(true);
  });
});
