import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  IdeaGarden,
  buildMilestonedOpHashes,
  type GardenContext,
} from '../../src/garden/garden.js';
import type { VcsOp } from '../../src/vcs/types.js';
import { TrellisVcsEngine } from '../../src/engine.js';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// buildMilestonedOpHashes
// ---------------------------------------------------------------------------

describe('buildMilestonedOpHashes', () => {
  test('marks ops within milestone ranges', () => {
    const ops: VcsOp[] = [
      {
        hash: 'h1',
        kind: 'vcs:fileAdd',
        timestamp: '',
        agentId: 'a',
        vcs: { filePath: 'a.ts' },
      },
      {
        hash: 'h2',
        kind: 'vcs:fileAdd',
        timestamp: '',
        agentId: 'a',
        vcs: { filePath: 'b.ts' },
      },
      {
        hash: 'h3',
        kind: 'vcs:milestoneCreate',
        timestamp: '',
        agentId: 'a',
        vcs: { fromOpHash: 'h1', toOpHash: 'h2' },
      },
      {
        hash: 'h4',
        kind: 'vcs:fileAdd',
        timestamp: '',
        agentId: 'a',
        vcs: { filePath: 'c.ts' },
      },
    ];

    const milestoned = buildMilestonedOpHashes(ops);
    expect(milestoned.has('h1')).toBe(true);
    expect(milestoned.has('h2')).toBe(true);
    expect(milestoned.has('h3')).toBe(true); // milestone op itself
    expect(milestoned.has('h4')).toBe(false); // after milestone
  });

  test('returns empty set when no milestones', () => {
    const ops: VcsOp[] = [
      {
        hash: 'h1',
        kind: 'vcs:fileAdd',
        timestamp: '',
        agentId: 'a',
        vcs: { filePath: 'a.ts' },
      },
    ];
    const milestoned = buildMilestonedOpHashes(ops);
    expect(milestoned.size).toBe(0);
  });

  test('handles milestones without fromOpHash/toOpHash', () => {
    const ops: VcsOp[] = [
      {
        hash: 'h1',
        kind: 'vcs:fileAdd',
        timestamp: '',
        agentId: 'a',
        vcs: { filePath: 'a.ts' },
      },
      {
        hash: 'h2',
        kind: 'vcs:milestoneCreate',
        timestamp: '',
        agentId: 'a',
        vcs: { message: 'test' },
      },
    ];
    const milestoned = buildMilestonedOpHashes(ops);
    // Without fromOpHash/toOpHash, no ops are marked as milestoned
    expect(milestoned.size).toBe(0);
    expect(milestoned.has('h1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// IdeaGarden
// ---------------------------------------------------------------------------

describe('IdeaGarden', () => {
  function makeContext(
    ops: VcsOp[],
    milestonedHashes: Set<string> = new Set(),
  ): GardenContext {
    return {
      readAllOps: () => ops,
      getMilestonedOpHashes: () => milestonedHashes,
    };
  }

  function makeFileOps(): VcsOp[] {
    const now = Date.now();
    return [
      {
        hash: 'a1',
        kind: 'vcs:fileModify',
        timestamp: new Date(now - 50000).toISOString(),
        agentId: 'a',
        vcs: { filePath: 'src/auth/login.ts', contentHash: 'x1' },
      },
      {
        hash: 'a2',
        kind: 'vcs:fileModify',
        timestamp: new Date(now - 40000).toISOString(),
        agentId: 'a',
        vcs: { filePath: 'src/auth/session.ts', contentHash: 'x2' },
      },
      // Context switch
      {
        hash: 'b1',
        kind: 'vcs:fileModify',
        timestamp: new Date(now - 30000).toISOString(),
        agentId: 'a',
        vcs: { filePath: 'src/dashboard/chart.ts', contentHash: 'y1' },
      },
      {
        hash: 'b2',
        kind: 'vcs:fileModify',
        timestamp: new Date(now - 20000).toISOString(),
        agentId: 'a',
        vcs: { filePath: 'src/dashboard/stats.ts', contentHash: 'y2' },
      },
    ];
  }

  test('listClusters returns detected clusters', () => {
    const ops = makeFileOps();
    const garden = new IdeaGarden(makeContext(ops));
    const clusters = garden.listClusters();
    expect(clusters.length).toBeGreaterThanOrEqual(1);
  });

  test('getCluster returns specific cluster by ID', () => {
    const ops = makeFileOps();
    const garden = new IdeaGarden(makeContext(ops));
    const clusters = garden.listClusters();
    if (clusters.length > 0) {
      const found = garden.getCluster(clusters[0].id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(clusters[0].id);
    }
  });

  test('getCluster returns null for unknown ID', () => {
    const ops = makeFileOps();
    const garden = new IdeaGarden(makeContext(ops));
    expect(garden.getCluster('nonexistent')).toBeNull();
  });

  test('search by file filters correctly', () => {
    const ops = makeFileOps();
    const garden = new IdeaGarden(makeContext(ops));
    const results = garden.search({ file: 'auth' });
    for (const c of results) {
      expect(c.affectedFiles.some((f) => f.includes('auth'))).toBe(true);
    }
  });

  test('search by keyword', () => {
    const ops = makeFileOps();
    const garden = new IdeaGarden(makeContext(ops));
    const results = garden.search({ keyword: 'login' });
    for (const c of results) {
      const hasMatch =
        c.affectedFiles.some((f) => f.includes('login')) ||
        c.estimatedIntent.includes('login');
      expect(hasMatch).toBe(true);
    }
  });

  test('search with limit', () => {
    const ops = makeFileOps();
    const garden = new IdeaGarden(makeContext(ops));
    const results = garden.search({ limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  test('revive marks cluster as revived and returns ops', () => {
    const ops = makeFileOps();
    const garden = new IdeaGarden(makeContext(ops));
    const clusters = garden.listClusters();
    if (clusters.length > 0) {
      const revivedOps = garden.revive(clusters[0].id);
      expect(revivedOps).not.toBeNull();
      expect(revivedOps!.length).toBeGreaterThan(0);

      // Cluster should now be revived
      const updated = garden.getCluster(clusters[0].id);
      expect(updated?.status).toBe('revived');
    }
  });

  test('revive returns null for unknown cluster', () => {
    const ops = makeFileOps();
    const garden = new IdeaGarden(makeContext(ops));
    expect(garden.revive('nonexistent')).toBeNull();
  });

  test('stats returns correct counts', () => {
    const ops = makeFileOps();
    const garden = new IdeaGarden(makeContext(ops));
    const s = garden.stats();
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(s.abandoned + s.draft + s.revived).toBe(s.total);
    expect(s.totalOps).toBeGreaterThanOrEqual(0);
  });

  test('invalidate clears the cache', () => {
    const ops = makeFileOps();
    const garden = new IdeaGarden(makeContext(ops));
    garden.listClusters(); // populate cache
    garden.invalidate();
    // Should re-detect on next call
    const clusters = garden.listClusters();
    expect(clusters).toBeDefined();
  });

  test('empty op stream returns no clusters', () => {
    const garden = new IdeaGarden(makeContext([]));
    expect(garden.listClusters().length).toBe(0);
    expect(garden.stats().total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Engine integration
// ---------------------------------------------------------------------------

describe('Engine garden integration', () => {
  const REPO_ROOT = '/tmp/trellis-p5-garden-test';

  afterEach(() => {
    rmSync(REPO_ROOT, { recursive: true, force: true });
  });

  test('engine.garden() returns an IdeaGarden instance', async () => {
    rmSync(REPO_ROOT, { recursive: true, force: true });
    mkdirSync(REPO_ROOT, { recursive: true });
    writeFileSync(join(REPO_ROOT, 'a.ts'), 'const x = 1;');

    const engine = new TrellisVcsEngine({ rootPath: REPO_ROOT });
    await engine.initRepo();

    const garden = engine.garden();
    expect(garden).toBeDefined();
    expect(typeof garden.listClusters).toBe('function');
    expect(typeof garden.search).toBe('function');
    expect(typeof garden.stats).toBe('function');
  });

  test('garden returns same instance on repeated calls', async () => {
    rmSync(REPO_ROOT, { recursive: true, force: true });
    mkdirSync(REPO_ROOT, { recursive: true });
    writeFileSync(join(REPO_ROOT, 'a.ts'), 'test');

    const engine = new TrellisVcsEngine({ rootPath: REPO_ROOT });
    await engine.initRepo();

    const g1 = engine.garden();
    const g2 = engine.garden();
    expect(g1).toBe(g2);
  });
});
