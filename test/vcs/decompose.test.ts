import { describe, test, expect } from 'vitest';
import { decompose } from '../../src/vcs/decompose.js';
import type { VcsOp } from '../../src/vcs/types.js';

function makeOp(kind: string, vcs: Record<string, any>): VcsOp {
  return {
    hash: 'trellis:op:test',
    kind,
    timestamp: '2026-03-29T00:00:00.000Z',
    agentId: 'agent:test',
    vcs,
  };
}

describe('decompose', () => {
  test('vcs:fileAdd creates file entity facts and directory link', () => {
    const op = makeOp('vcs:fileAdd', {
      filePath: 'src/utils/math.ts',
      contentHash: 'sha256:abc',
      size: 1024,
      language: 'typescript',
    });

    const result = decompose(op);

    // Should create file entity facts
    expect(result.addFacts).toContainEqual({ e: 'file:src/utils/math.ts', a: 'type', v: 'FileNode' });
    expect(result.addFacts).toContainEqual({ e: 'file:src/utils/math.ts', a: 'path', v: 'src/utils/math.ts' });
    expect(result.addFacts).toContainEqual({ e: 'file:src/utils/math.ts', a: 'contentHash', v: 'sha256:abc' });
    expect(result.addFacts).toContainEqual({ e: 'file:src/utils/math.ts', a: 'size', v: 1024 });
    expect(result.addFacts).toContainEqual({ e: 'file:src/utils/math.ts', a: 'language', v: 'typescript' });

    // Should create directory entity
    expect(result.addFacts).toContainEqual({ e: 'dir:src/utils', a: 'type', v: 'DirectoryNode' });

    // Should link directory → file
    expect(result.addLinks).toContainEqual({
      e1: 'dir:src/utils',
      a: 'contains',
      e2: 'file:src/utils/math.ts',
    });

    // No deletions
    expect(result.deleteFacts).toHaveLength(0);
    expect(result.deleteLinks).toHaveLength(0);
  });

  test('vcs:fileModify updates contentHash', () => {
    const op = makeOp('vcs:fileModify', {
      filePath: 'src/index.ts',
      contentHash: 'sha256:new',
      oldContentHash: 'sha256:old',
      size: 2048,
    });

    const result = decompose(op);

    // Should delete old hash
    expect(result.deleteFacts).toContainEqual({
      e: 'file:src/index.ts',
      a: 'contentHash',
      v: 'sha256:old',
    });

    // Should add new hash
    expect(result.addFacts).toContainEqual({
      e: 'file:src/index.ts',
      a: 'contentHash',
      v: 'sha256:new',
    });
  });

  test('vcs:fileDelete removes file entity', () => {
    const op = makeOp('vcs:fileDelete', {
      filePath: 'src/old.ts',
      contentHash: 'sha256:abc',
    });

    const result = decompose(op);

    expect(result.deleteFacts).toContainEqual({ e: 'file:src/old.ts', a: 'type', v: 'FileNode' });
    expect(result.deleteFacts).toContainEqual({ e: 'file:src/old.ts', a: 'path', v: 'src/old.ts' });
    expect(result.deleteLinks).toContainEqual({
      e1: 'dir:src',
      a: 'contains',
      e2: 'file:src/old.ts',
    });
  });

  test('vcs:fileRename preserves entity identity', () => {
    const op = makeOp('vcs:fileRename', {
      filePath: 'src/new.ts',
      oldFilePath: 'src/old.ts',
    });

    const result = decompose(op);

    // Entity ID stays the same (based on old path)
    expect(result.deleteFacts).toContainEqual({
      e: 'file:src/old.ts',
      a: 'path',
      v: 'src/old.ts',
    });
    expect(result.addFacts).toContainEqual({
      e: 'file:src/old.ts',
      a: 'path',
      v: 'src/new.ts',
    });

    // Old directory link removed, new one added
    expect(result.deleteLinks).toContainEqual({
      e1: 'dir:src',
      a: 'contains',
      e2: 'file:src/old.ts',
    });
    expect(result.addLinks).toContainEqual({
      e1: 'dir:src',
      a: 'contains',
      e2: 'file:src/old.ts', // same entity ID
    });
  });

  test('vcs:branchCreate creates branch entity', () => {
    const op = makeOp('vcs:branchCreate', {
      branchName: 'feature-x',
      baseBranch: 'main',
    });

    const result = decompose(op);

    expect(result.addFacts).toContainEqual({ e: 'branch:feature-x', a: 'type', v: 'Branch' });
    expect(result.addFacts).toContainEqual({ e: 'branch:feature-x', a: 'name', v: 'feature-x' });
    expect(result.addLinks).toContainEqual({
      e1: 'branch:feature-x',
      a: 'forkedFrom',
      e2: 'branch:main',
    });
  });

  test('vcs:milestoneCreate creates milestone entity', () => {
    const op = makeOp('vcs:milestoneCreate', {
      milestoneId: 'milestone:abc',
      message: 'fix: null auth tokens',
      fromOpHash: 'trellis:op:start',
      toOpHash: 'trellis:op:end',
    });

    const result = decompose(op);

    expect(result.addFacts).toContainEqual({ e: 'milestone:abc', a: 'type', v: 'Milestone' });
    expect(result.addFacts).toContainEqual({ e: 'milestone:abc', a: 'message', v: 'fix: null auth tokens' });
    expect(result.addFacts).toContainEqual({ e: 'milestone:abc', a: 'fromOpHash', v: 'trellis:op:start' });
    expect(result.addFacts).toContainEqual({ e: 'milestone:abc', a: 'toOpHash', v: 'trellis:op:end' });
  });

  test('returns empty result for op without vcs payload', () => {
    const op: VcsOp = {
      hash: 'trellis:op:test',
      kind: 'addFacts',
      timestamp: '2026-03-29T00:00:00.000Z',
      agentId: 'agent:test',
    };

    const result = decompose(op);
    expect(result.addFacts).toHaveLength(0);
    expect(result.addLinks).toHaveLength(0);
    expect(result.deleteFacts).toHaveLength(0);
    expect(result.deleteLinks).toHaveLength(0);
  });

  test('vcs:storeAssert passes through EAV facts', () => {
    const op = makeOp('vcs:storeAssert', {
      facts: [
        { e: 'person:sam-altman', a: 'type', v: 'person' },
        { e: 'person:sam-altman', a: 'name', v: 'Sam Altman' },
      ],
    });

    const result = decompose(op);

    expect(result.addFacts).toContainEqual({ e: 'person:sam-altman', a: 'type', v: 'person' });
    expect(result.addFacts).toContainEqual({ e: 'person:sam-altman', a: 'name', v: 'Sam Altman' });
    expect(result.deleteFacts).toHaveLength(0);
  });

  test('vcs:storeRetract and vcs:storeLink pass through EAV mutations', () => {
    const retract = decompose(
      makeOp('vcs:storeRetract', {
        facts: [{ e: 'person:sam-altman', a: 'bio', v: 'old bio' }],
      }),
    );
    expect(retract.deleteFacts).toContainEqual({
      e: 'person:sam-altman',
      a: 'bio',
      v: 'old bio',
    });

    const link = decompose(
      makeOp('vcs:storeLink', {
        links: [{ e1: 'person:sam-altman', a: 'leads', e2: 'organization:openai' }],
      }),
    );
    expect(link.addLinks).toContainEqual({
      e1: 'person:sam-altman',
      a: 'leads',
      e2: 'organization:openai',
    });
  });
});
