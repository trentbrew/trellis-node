import { describe, test, expect } from 'vitest';
import {
  contextSwitchDetector,
  revertDetector,
  staleBranchDetector,
  detectClusters,
  type IdeaCluster,
} from '../../src/garden/cluster.js';
import type { VcsOp } from '../../src/vcs/types.js';

// ---------------------------------------------------------------------------
// Helpers to build test ops
// ---------------------------------------------------------------------------

let opCounter = 0;

function makeOp(
  kind: string,
  filePath?: string,
  contentHash?: string,
  extra?: Partial<VcsOp>,
): VcsOp {
  opCounter++;
  return {
    hash: `h${opCounter}`,
    kind,
    timestamp: new Date(Date.now() - (100 - opCounter) * 60000).toISOString(),
    agentId: 'test-agent',
    vcs: {
      filePath,
      contentHash,
      ...extra?.vcs,
    },
    ...extra,
  } as VcsOp;
}

function resetCounter() {
  opCounter = 0;
}

// ---------------------------------------------------------------------------
// Context-switch detector
// ---------------------------------------------------------------------------

describe('contextSwitchDetector', () => {
  test('detects context switch between different directories', () => {
    resetCounter();
    const ops = [
      makeOp('vcs:fileModify', 'src/auth/login.ts', 'a1'),
      makeOp('vcs:fileModify', 'src/auth/logout.ts', 'a2'),
      makeOp('vcs:fileModify', 'src/auth/session.ts', 'a3'),
      // Context switch
      makeOp('vcs:fileModify', 'src/dashboard/chart.ts', 'b1'),
      makeOp('vcs:fileModify', 'src/dashboard/stats.ts', 'b2'),
    ];

    const clusters = contextSwitchDetector.detect(ops, new Set());
    expect(clusters.length).toBe(1);
    expect(clusters[0].affectedFiles).toContain('src/auth/login.ts');
    expect(clusters[0].detectedBy).toBe('context-switch');
    expect(clusters[0].status).toBe('abandoned');
  });

  test('skips milestoned ops', () => {
    resetCounter();
    const ops = [
      makeOp('vcs:fileModify', 'src/auth/login.ts', 'a1'),
      makeOp('vcs:fileModify', 'src/auth/logout.ts', 'a2'),
      makeOp('vcs:fileModify', 'src/dashboard/chart.ts', 'b1'),
      makeOp('vcs:fileModify', 'src/dashboard/stats.ts', 'b2'),
    ];

    // All auth ops are milestoned
    const milestoned = new Set(['h1', 'h2']);
    const clusters = contextSwitchDetector.detect(ops, milestoned);
    // No context switch since auth ops are excluded
    expect(clusters.length).toBe(0);
  });

  test('no clusters when all ops are in same directory', () => {
    resetCounter();
    const ops = [
      makeOp('vcs:fileModify', 'src/auth/login.ts', 'a1'),
      makeOp('vcs:fileModify', 'src/auth/logout.ts', 'a2'),
      makeOp('vcs:fileModify', 'src/auth/session.ts', 'a3'),
    ];

    const clusters = contextSwitchDetector.detect(ops, new Set());
    expect(clusters.length).toBe(0);
  });

  test('ignores single-op groups', () => {
    resetCounter();
    const ops = [
      makeOp('vcs:fileModify', 'src/auth/login.ts', 'a1'),
      // Single op in different dir — too small to be a cluster
      makeOp('vcs:fileModify', 'src/dashboard/chart.ts', 'b1'),
      makeOp('vcs:fileModify', 'src/dashboard/stats.ts', 'b2'),
    ];

    const clusters = contextSwitchDetector.detect(ops, new Set());
    // The auth group has only 1 op — skipped
    expect(clusters.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Revert detector
// ---------------------------------------------------------------------------

describe('revertDetector', () => {
  test('detects reverted modifications', () => {
    resetCounter();
    const ops = [
      makeOp('vcs:fileModify', 'src/config.ts', 'v1'),
      makeOp('vcs:fileModify', 'src/config.ts', 'v2'),
      makeOp('vcs:fileModify', 'src/config.ts', 'v3'),
      // Reverts back to v1
      makeOp('vcs:fileModify', 'src/config.ts', 'v1'),
    ];

    const clusters = revertDetector.detect(ops, new Set());
    expect(clusters.length).toBe(1);
    expect(clusters[0].detectedBy).toBe('revert');
    expect(clusters[0].affectedFiles).toContain('src/config.ts');
  });

  test('skips milestoned ops in revert detection', () => {
    resetCounter();
    const ops = [
      makeOp('vcs:fileModify', 'src/config.ts', 'v1'),
      makeOp('vcs:fileModify', 'src/config.ts', 'v2'),
      makeOp('vcs:fileModify', 'src/config.ts', 'v3'),
      makeOp('vcs:fileModify', 'src/config.ts', 'v1'),
    ];

    // Mark the reverted ops as milestoned
    const milestoned = new Set(['h2', 'h3']);
    const clusters = revertDetector.detect(ops, milestoned);
    expect(clusters.length).toBe(0);
  });

  test('no clusters without reverts', () => {
    resetCounter();
    const ops = [
      makeOp('vcs:fileModify', 'src/config.ts', 'v1'),
      makeOp('vcs:fileModify', 'src/config.ts', 'v2'),
      makeOp('vcs:fileModify', 'src/config.ts', 'v3'),
    ];

    const clusters = revertDetector.detect(ops, new Set());
    expect(clusters.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stale-branch detector
// ---------------------------------------------------------------------------

describe('staleBranchDetector', () => {
  test('detects stale branch work', () => {
    resetCounter();
    // Ops from 30 days ago on a feature branch
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const ops: VcsOp[] = [
      {
        hash: 'branch-op',
        kind: 'vcs:branchCreate',
        timestamp: old,
        agentId: 'test',
        vcs: { branchName: 'feature-x' },
      },
      {
        hash: 'stale1',
        kind: 'vcs:fileModify',
        timestamp: old,
        agentId: 'test',
        vcs: { filePath: 'src/feature.ts', contentHash: 'f1' },
      },
      {
        hash: 'stale2',
        kind: 'vcs:fileModify',
        timestamp: old,
        agentId: 'test',
        vcs: { filePath: 'src/feature2.ts', contentHash: 'f2' },
      },
    ];

    const clusters = staleBranchDetector.detect(ops, new Set());
    expect(clusters.length).toBe(1);
    expect(clusters[0].detectedBy).toBe('stale-branch');
  });

  test('does not flag main branch', () => {
    resetCounter();
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const ops: VcsOp[] = [
      {
        hash: 'stale1',
        kind: 'vcs:fileModify',
        timestamp: old,
        agentId: 'test',
        vcs: { filePath: 'src/main.ts', contentHash: 'f1' },
      },
      {
        hash: 'stale2',
        kind: 'vcs:fileModify',
        timestamp: old,
        agentId: 'test',
        vcs: { filePath: 'src/main2.ts', contentHash: 'f2' },
      },
    ];

    const clusters = staleBranchDetector.detect(ops, new Set());
    expect(clusters.length).toBe(0);
  });

  test('does not flag recent branches', () => {
    resetCounter();
    const ops: VcsOp[] = [
      {
        hash: 'branch-op',
        kind: 'vcs:branchCreate',
        timestamp: new Date().toISOString(),
        agentId: 'test',
        vcs: { branchName: 'feature-y' },
      },
      {
        hash: 'recent1',
        kind: 'vcs:fileModify',
        timestamp: new Date().toISOString(),
        agentId: 'test',
        vcs: { filePath: 'src/new.ts', contentHash: 'n1' },
      },
      {
        hash: 'recent2',
        kind: 'vcs:fileModify',
        timestamp: new Date().toISOString(),
        agentId: 'test',
        vcs: { filePath: 'src/new2.ts', contentHash: 'n2' },
      },
    ];

    const clusters = staleBranchDetector.detect(ops, new Set());
    expect(clusters.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Composite detector
// ---------------------------------------------------------------------------

describe('detectClusters', () => {
  test('runs all detectors and deduplicates', () => {
    resetCounter();
    const ops = [
      makeOp('vcs:fileModify', 'src/auth/login.ts', 'a1'),
      makeOp('vcs:fileModify', 'src/auth/logout.ts', 'a2'),
      makeOp('vcs:fileModify', 'src/dashboard/chart.ts', 'b1'),
      makeOp('vcs:fileModify', 'src/dashboard/stats.ts', 'b2'),
    ];

    const clusters = detectClusters(ops, new Set());
    // At minimum, context-switch should find one cluster
    expect(clusters.length).toBeGreaterThanOrEqual(1);
  });

  test('returns empty array when no clusters found', () => {
    resetCounter();
    const ops = [
      makeOp('vcs:fileModify', 'src/auth/login.ts', 'a1'),
    ];

    const clusters = detectClusters(ops, new Set());
    expect(clusters.length).toBe(0);
  });

  test('sorts clusters by creation time', () => {
    resetCounter();
    const ops = [
      makeOp('vcs:fileModify', 'src/a/x.ts', 'a1'),
      makeOp('vcs:fileModify', 'src/a/y.ts', 'a2'),
      makeOp('vcs:fileModify', 'src/b/x.ts', 'b1'),
      makeOp('vcs:fileModify', 'src/b/y.ts', 'b2'),
      makeOp('vcs:fileModify', 'src/c/x.ts', 'c1'),
      makeOp('vcs:fileModify', 'src/c/y.ts', 'c2'),
    ];

    const clusters = detectClusters(ops, new Set());
    for (let i = 1; i < clusters.length; i++) {
      const prev = new Date(clusters[i - 1].createdAt).getTime();
      const curr = new Date(clusters[i].createdAt).getTime();
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });
});
