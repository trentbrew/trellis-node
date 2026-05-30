import { describe, test, expect } from 'vitest';
import { createVcsOp, isVcsOp, isVcsOpKind } from '../../src/vcs/ops.js';
import type { VcsOp } from '../../src/vcs/types.js';

describe('createVcsOp', () => {
  test('creates a content-addressed op with hash', async () => {
    const op = await createVcsOp('vcs:fileAdd', {
      agentId: 'agent:test',
      vcs: { filePath: 'src/index.ts', contentHash: 'abc123' },
    });

    expect(op.hash).toStartWith('trellis:op:');
    expect(op.kind).toBe('vcs:fileAdd');
    expect(op.agentId).toBe('agent:test');
    expect(op.timestamp).toBeTruthy();
    expect(op.vcs?.filePath).toBe('src/index.ts');
    expect(op.vcs?.contentHash).toBe('abc123');
  });

  test('chains ops via previousHash', async () => {
    const op1 = await createVcsOp('vcs:fileAdd', {
      agentId: 'agent:test',
      vcs: { filePath: 'a.ts' },
    });
    const op2 = await createVcsOp('vcs:fileModify', {
      agentId: 'agent:test',
      previousHash: op1.hash,
      vcs: { filePath: 'a.ts', contentHash: 'new-hash' },
    });

    expect(op2.previousHash).toBe(op1.hash);
    expect(op2.hash).not.toBe(op1.hash);
  });

  test('different payloads produce different hashes', async () => {
    const op1 = await createVcsOp('vcs:fileAdd', {
      agentId: 'agent:test',
      vcs: { filePath: 'a.ts' },
    });
    const op2 = await createVcsOp('vcs:fileAdd', {
      agentId: 'agent:test',
      vcs: { filePath: 'b.ts' },
    });

    expect(op1.hash).not.toBe(op2.hash);
  });
});

describe('isVcsOp', () => {
  test('returns true for ops with vcs payload', () => {
    expect(isVcsOp({ kind: 'vcs:fileAdd', vcs: { filePath: 'a.ts' } })).toBe(true);
  });

  test('returns true for ops with vcs: kind prefix', () => {
    expect(isVcsOp({ kind: 'vcs:branchCreate' })).toBe(true);
  });

  test('returns false for plain kernel ops', () => {
    expect(isVcsOp({ kind: 'addFacts' })).toBe(false);
  });
});

describe('isVcsOpKind', () => {
  test('recognizes VCS op kinds', () => {
    expect(isVcsOpKind('vcs:fileAdd')).toBe(true);
    expect(isVcsOpKind('vcs:milestoneCreate')).toBe(true);
  });

  test('rejects kernel op kinds', () => {
    expect(isVcsOpKind('addFacts')).toBe(false);
    expect(isVcsOpKind('deleteFacts')).toBe(false);
  });
});
