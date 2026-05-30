import { describe, test, expect } from 'vitest';
import {
  reconcile,
  findForkPoint,
} from '../../src/sync/reconciler.js';
import type { VcsOp } from '../../src/vcs/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOp(hash: string, kind: string, opts?: Partial<VcsOp>): VcsOp {
  return {
    hash,
    kind,
    timestamp: opts?.timestamp ?? new Date().toISOString(),
    agentId: opts?.agentId ?? 'test',
    vcs: opts?.vcs,
    previousHash: opts?.previousHash,
  } as VcsOp;
}

// ---------------------------------------------------------------------------
// findForkPoint
// ---------------------------------------------------------------------------

describe('findForkPoint', () => {
  test('finds last common op', () => {
    const shared = [makeOp('h1', 'vcs:fileAdd'), makeOp('h2', 'vcs:fileAdd')];
    const opsA = [...shared, makeOp('a1', 'vcs:fileModify')];
    const opsB = [...shared, makeOp('b1', 'vcs:fileModify')];

    expect(findForkPoint(opsA, opsB)).toBe('h2');
  });

  test('returns null for completely disjoint streams', () => {
    const opsA = [makeOp('a1', 'vcs:fileAdd')];
    const opsB = [makeOp('b1', 'vcs:fileAdd')];
    expect(findForkPoint(opsA, opsB)).toBeNull();
  });

  test('returns last hash for identical streams', () => {
    const ops = [makeOp('h1', 'vcs:fileAdd'), makeOp('h2', 'vcs:fileAdd')];
    expect(findForkPoint(ops, ops)).toBe('h2');
  });

  test('handles empty streams', () => {
    expect(findForkPoint([], [])).toBeNull();
    expect(findForkPoint([makeOp('h1', 'vcs:fileAdd')], [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------

describe('reconcile', () => {
  test('fast-forward when only A has new ops', () => {
    const shared = [makeOp('h1', 'vcs:fileAdd')];
    const opsA = [...shared, makeOp('a1', 'vcs:fileModify')];
    const opsB = [...shared];

    const result = reconcile(opsA, opsB);
    expect(result.clean).toBe(true);
    expect(result.uniqueToA.length).toBe(1);
    expect(result.uniqueToB.length).toBe(0);
    expect(result.merged.length).toBe(2);
  });

  test('fast-forward when only B has new ops', () => {
    const shared = [makeOp('h1', 'vcs:fileAdd')];
    const opsA = [...shared];
    const opsB = [...shared, makeOp('b1', 'vcs:fileModify')];

    const result = reconcile(opsA, opsB);
    expect(result.clean).toBe(true);
    expect(result.uniqueToB.length).toBe(1);
    expect(result.merged.length).toBe(2);
  });

  test('identical streams produce clean merge with no unique ops', () => {
    const ops = [makeOp('h1', 'vcs:fileAdd'), makeOp('h2', 'vcs:fileModify')];
    const result = reconcile(ops, [...ops]);
    expect(result.clean).toBe(true);
    expect(result.uniqueToA.length).toBe(0);
    expect(result.uniqueToB.length).toBe(0);
    expect(result.merged.length).toBe(2);
  });

  test('divergent streams with no file overlap merge cleanly', () => {
    const shared = [makeOp('h1', 'vcs:branchCreate')];
    const t = Date.now();
    const opsA = [
      ...shared,
      makeOp('a1', 'vcs:fileAdd', {
        timestamp: new Date(t + 1).toISOString(),
        vcs: { filePath: 'a.ts', contentHash: 'ha' },
      }),
    ];
    const opsB = [
      ...shared,
      makeOp('b1', 'vcs:fileAdd', {
        timestamp: new Date(t + 2).toISOString(),
        vcs: { filePath: 'b.ts', contentHash: 'hb' },
      }),
    ];

    const result = reconcile(opsA, opsB);
    expect(result.clean).toBe(true);
    expect(result.merged.length).toBe(3); // shared + a1 + b1
  });

  test('divergent streams with same file modify conflict', () => {
    const shared = [makeOp('h1', 'vcs:fileAdd', { vcs: { filePath: 'x.ts', contentHash: 'v0' } })];
    const t = Date.now();
    const opsA = [
      ...shared,
      makeOp('a1', 'vcs:fileModify', {
        timestamp: new Date(t + 1).toISOString(),
        vcs: { filePath: 'x.ts', contentHash: 'va' },
      }),
    ];
    const opsB = [
      ...shared,
      makeOp('b1', 'vcs:fileModify', {
        timestamp: new Date(t + 2).toISOString(),
        vcs: { filePath: 'x.ts', contentHash: 'vb' },
      }),
    ];

    const result = reconcile(opsA, opsB);
    expect(result.clean).toBe(false);
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].filePath).toBe('x.ts');
  });

  test('delete/modify conflict detected', () => {
    const shared = [makeOp('h1', 'vcs:fileAdd', { vcs: { filePath: 'x.ts', contentHash: 'v0' } })];
    const t = Date.now();
    const opsA = [
      ...shared,
      makeOp('a1', 'vcs:fileDelete', {
        timestamp: new Date(t + 1).toISOString(),
        vcs: { filePath: 'x.ts' },
      }),
    ];
    const opsB = [
      ...shared,
      makeOp('b1', 'vcs:fileModify', {
        timestamp: new Date(t + 2).toISOString(),
        vcs: { filePath: 'x.ts', contentHash: 'vb' },
      }),
    ];

    const result = reconcile(opsA, opsB);
    expect(result.clean).toBe(false);
    expect(result.conflicts[0].reason).toContain('Delete/modify');
  });

  test('both add same file with same content — no conflict', () => {
    const shared = [makeOp('h1', 'vcs:branchCreate')];
    const t = Date.now();
    const opsA = [
      ...shared,
      makeOp('a1', 'vcs:fileAdd', {
        timestamp: new Date(t + 1).toISOString(),
        vcs: { filePath: 'new.ts', contentHash: 'same' },
      }),
    ];
    const opsB = [
      ...shared,
      makeOp('b1', 'vcs:fileAdd', {
        timestamp: new Date(t + 2).toISOString(),
        vcs: { filePath: 'new.ts', contentHash: 'same' },
      }),
    ];

    const result = reconcile(opsA, opsB);
    expect(result.clean).toBe(true);
  });

  test('both add same file with different content — conflict', () => {
    const shared = [makeOp('h1', 'vcs:branchCreate')];
    const t = Date.now();
    const opsA = [
      ...shared,
      makeOp('a1', 'vcs:fileAdd', {
        timestamp: new Date(t + 1).toISOString(),
        vcs: { filePath: 'new.ts', contentHash: 'ha' },
      }),
    ];
    const opsB = [
      ...shared,
      makeOp('b1', 'vcs:fileAdd', {
        timestamp: new Date(t + 2).toISOString(),
        vcs: { filePath: 'new.ts', contentHash: 'hb' },
      }),
    ];

    const result = reconcile(opsA, opsB);
    expect(result.clean).toBe(false);
  });

  test('empty streams produce empty result', () => {
    const result = reconcile([], []);
    expect(result.clean).toBe(true);
    expect(result.merged.length).toBe(0);
  });

  test('merged ops preserve timestamp ordering', () => {
    const shared = [makeOp('h1', 'vcs:branchCreate')];
    const opsA = [
      ...shared,
      makeOp('a1', 'vcs:fileAdd', {
        timestamp: '2024-01-01T00:00:01Z',
        vcs: { filePath: 'a.ts', contentHash: 'ha' },
      }),
      makeOp('a2', 'vcs:fileAdd', {
        timestamp: '2024-01-01T00:00:03Z',
        vcs: { filePath: 'c.ts', contentHash: 'hc' },
      }),
    ];
    const opsB = [
      ...shared,
      makeOp('b1', 'vcs:fileAdd', {
        timestamp: '2024-01-01T00:00:02Z',
        vcs: { filePath: 'b.ts', contentHash: 'hb' },
      }),
    ];

    const result = reconcile(opsA, opsB);
    const uniqueOps = result.merged.slice(1); // skip shared
    // Should be interleaved by timestamp: a1, b1, a2
    expect(uniqueOps[0].hash).toBe('a1');
    expect(uniqueOps[1].hash).toBe('b1');
    expect(uniqueOps[2].hash).toBe('a2');
  });
});
