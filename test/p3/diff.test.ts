import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  diffFileStates,
  diffOpRange,
  buildFileStateAtOp,
  generateUnifiedDiff,
  myersDiff,
  type FileState,
} from '../../src/vcs/diff.js';
import { BlobStore } from '../../src/vcs/blob-store.js';
import { TrellisVcsEngine } from '../../src/engine.js';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Myers diff algorithm
// ---------------------------------------------------------------------------

describe('myersDiff', () => {
  test('identical lines produce all equal', () => {
    const edits = myersDiff(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(edits.every((e) => e.kind === 'equal')).toBe(true);
    expect(edits.length).toBe(3);
  });

  test('empty old produces all inserts', () => {
    const edits = myersDiff([], ['a', 'b']);
    expect(edits.every((e) => e.kind === 'insert')).toBe(true);
    expect(edits.length).toBe(2);
  });

  test('empty new produces all deletes', () => {
    const edits = myersDiff(['a', 'b'], []);
    expect(edits.every((e) => e.kind === 'delete')).toBe(true);
    expect(edits.length).toBe(2);
  });

  test('both empty produces no edits', () => {
    const edits = myersDiff([], []);
    expect(edits.length).toBe(0);
  });

  test('detects insertion', () => {
    const edits = myersDiff(['a', 'c'], ['a', 'b', 'c']);
    const inserts = edits.filter((e) => e.kind === 'insert');
    expect(inserts.length).toBe(1);
    expect(inserts[0].line).toBe('b');
  });

  test('detects deletion', () => {
    const edits = myersDiff(['a', 'b', 'c'], ['a', 'c']);
    const deletes = edits.filter((e) => e.kind === 'delete');
    expect(deletes.length).toBe(1);
    expect(deletes[0].line).toBe('b');
  });

  test('detects modification (delete + insert)', () => {
    const edits = myersDiff(['a', 'old', 'c'], ['a', 'new', 'c']);
    const deletes = edits.filter((e) => e.kind === 'delete');
    const inserts = edits.filter((e) => e.kind === 'insert');
    expect(deletes.length).toBe(1);
    expect(deletes[0].line).toBe('old');
    expect(inserts.length).toBe(1);
    expect(inserts[0].line).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// Unified diff generation
// ---------------------------------------------------------------------------

describe('generateUnifiedDiff', () => {
  test('produces valid unified diff format', () => {
    const diff = generateUnifiedDiff(
      'test.ts',
      'line1\nline2\nline3',
      'line1\nmodified\nline3',
    );
    expect(diff).toContain('--- a/test.ts');
    expect(diff).toContain('+++ b/test.ts');
    expect(diff).toContain('@@');
    expect(diff).toContain('-line2');
    expect(diff).toContain('+modified');
  });

  test('returns empty string for identical content', () => {
    const diff = generateUnifiedDiff('test.ts', 'same\ncontent', 'same\ncontent');
    expect(diff).toBe('');
  });

  test('handles addition at end', () => {
    const diff = generateUnifiedDiff('test.ts', 'a\nb', 'a\nb\nc');
    expect(diff).toContain('+c');
  });

  test('handles deletion at beginning', () => {
    const diff = generateUnifiedDiff('test.ts', 'a\nb\nc', 'b\nc');
    expect(diff).toContain('-a');
  });
});

// ---------------------------------------------------------------------------
// File state building
// ---------------------------------------------------------------------------

describe('buildFileStateAtOp', () => {
  test('builds state from fileAdd ops', () => {
    const ops = [
      { kind: 'vcs:fileAdd', hash: 'h1', vcs: { filePath: 'a.ts', contentHash: 'aaa' } },
      { kind: 'vcs:fileAdd', hash: 'h2', vcs: { filePath: 'b.ts', contentHash: 'bbb' } },
    ] as any;

    const state = buildFileStateAtOp(ops);
    expect(state.size).toBe(2);
    expect(state.get('a.ts')?.contentHash).toBe('aaa');
    expect(state.get('b.ts')?.contentHash).toBe('bbb');
  });

  test('stops at specified op hash', () => {
    const ops = [
      { kind: 'vcs:fileAdd', hash: 'h1', vcs: { filePath: 'a.ts', contentHash: 'aaa' } },
      { kind: 'vcs:fileAdd', hash: 'h2', vcs: { filePath: 'b.ts', contentHash: 'bbb' } },
      { kind: 'vcs:fileAdd', hash: 'h3', vcs: { filePath: 'c.ts', contentHash: 'ccc' } },
    ] as any;

    const state = buildFileStateAtOp(ops, 'h2');
    expect(state.size).toBe(2);
    expect(state.has('c.ts')).toBe(false);
  });

  test('handles fileDelete', () => {
    const ops = [
      { kind: 'vcs:fileAdd', hash: 'h1', vcs: { filePath: 'a.ts', contentHash: 'aaa' } },
      { kind: 'vcs:fileDelete', hash: 'h2', vcs: { filePath: 'a.ts' } },
    ] as any;

    const state = buildFileStateAtOp(ops);
    expect(state.get('a.ts')?.deleted).toBe(true);
  });

  test('handles fileModify', () => {
    const ops = [
      { kind: 'vcs:fileAdd', hash: 'h1', vcs: { filePath: 'a.ts', contentHash: 'v1' } },
      { kind: 'vcs:fileModify', hash: 'h2', vcs: { filePath: 'a.ts', contentHash: 'v2' } },
    ] as any;

    const state = buildFileStateAtOp(ops);
    expect(state.get('a.ts')?.contentHash).toBe('v2');
  });

  test('handles fileRename', () => {
    const ops = [
      { kind: 'vcs:fileAdd', hash: 'h1', vcs: { filePath: 'old.ts', contentHash: 'v1' } },
      { kind: 'vcs:fileRename', hash: 'h2', vcs: { filePath: 'new.ts', oldFilePath: 'old.ts', contentHash: 'v1' } },
    ] as any;

    const state = buildFileStateAtOp(ops);
    expect(state.get('old.ts')?.deleted).toBe(true);
    expect(state.get('new.ts')?.contentHash).toBe('v1');
  });
});

// ---------------------------------------------------------------------------
// diffFileStates
// ---------------------------------------------------------------------------

describe('diffFileStates', () => {
  test('detects additions', () => {
    const stateA = new Map<string, FileState>();
    const stateB = new Map<string, FileState>([['a.ts', { contentHash: 'aaa' }]]);
    const result = diffFileStates(stateA, stateB);
    expect(result.stats.added).toBe(1);
    expect(result.diffs[0].kind).toBe('fileAdded');
  });

  test('detects deletions', () => {
    const stateA = new Map<string, FileState>([['a.ts', { contentHash: 'aaa' }]]);
    const stateB = new Map<string, FileState>();
    const result = diffFileStates(stateA, stateB);
    expect(result.stats.removed).toBe(1);
    expect(result.diffs[0].kind).toBe('fileDeleted');
  });

  test('detects modifications', () => {
    const stateA = new Map<string, FileState>([['a.ts', { contentHash: 'v1' }]]);
    const stateB = new Map<string, FileState>([['a.ts', { contentHash: 'v2' }]]);
    const result = diffFileStates(stateA, stateB);
    expect(result.stats.modified).toBe(1);
    expect(result.diffs[0].kind).toBe('fileModified');
  });

  test('no diff for identical states', () => {
    const stateA = new Map<string, FileState>([['a.ts', { contentHash: 'same' }]]);
    const stateB = new Map<string, FileState>([['a.ts', { contentHash: 'same' }]]);
    const result = diffFileStates(stateA, stateB);
    expect(result.diffs.length).toBe(0);
  });

  test('ignores deleted files in state B', () => {
    const stateA = new Map<string, FileState>([['a.ts', { contentHash: 'v1' }]]);
    const stateB = new Map<string, FileState>([['a.ts', { deleted: true }]]);
    const result = diffFileStates(stateA, stateB);
    expect(result.stats.removed).toBe(1);
  });

  test('produces unified diff with blob store', () => {
    const testDir = '/tmp/trellis-diff-blob-test';
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.trellis'), { recursive: true });
    const bs = new BlobStore(join(testDir, '.trellis'));

    const oldContent = Buffer.from('line1\nline2\nline3');
    const newContent = Buffer.from('line1\nchanged\nline3');
    const oldHash = bs.putSync(oldContent);
    const newHash = bs.putSync(newContent);

    const stateA = new Map<string, FileState>([['a.ts', { contentHash: oldHash }]]);
    const stateB = new Map<string, FileState>([['a.ts', { contentHash: newHash }]]);
    const result = diffFileStates(stateA, stateB, bs);

    expect(result.diffs[0].unifiedDiff).toBeDefined();
    expect(result.diffs[0].unifiedDiff).toContain('-line2');
    expect(result.diffs[0].unifiedDiff).toContain('+changed');

    rmSync(testDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// diffOpRange
// ---------------------------------------------------------------------------

describe('diffOpRange', () => {
  test('diffs between two op hashes', () => {
    const ops = [
      { kind: 'vcs:fileAdd', hash: 'h1', vcs: { filePath: 'a.ts', contentHash: 'v1' } },
      { kind: 'vcs:fileAdd', hash: 'h2', vcs: { filePath: 'b.ts', contentHash: 'v2' } },
      { kind: 'vcs:fileModify', hash: 'h3', vcs: { filePath: 'a.ts', contentHash: 'v3' } },
    ] as any;

    const result = diffOpRange(ops, 'h1', 'h3');
    // State at h1: a.ts=v1
    // State at h3: a.ts=v3, b.ts=v2
    expect(result.stats.added).toBe(1); // b.ts
    expect(result.stats.modified).toBe(1); // a.ts changed v1→v3
  });
});

// ---------------------------------------------------------------------------
// Engine integration
// ---------------------------------------------------------------------------

describe('Engine diff integration', () => {
  const REPO_ROOT = '/tmp/trellis-p3-diff-engine-test';

  afterEach(() => {
    rmSync(REPO_ROOT, { recursive: true, force: true });
  });

  test('diffOps works on a real repo', async () => {
    rmSync(REPO_ROOT, { recursive: true, force: true });
    mkdirSync(REPO_ROOT, { recursive: true });
    writeFileSync(join(REPO_ROOT, 'a.ts'), 'const x = 1;');
    writeFileSync(join(REPO_ROOT, 'b.ts'), 'const y = 2;');

    const engine = new TrellisVcsEngine({ rootPath: REPO_ROOT });
    await engine.initRepo();

    const ops = engine.getOps();
    const firstFileOp = ops.find((o) => o.kind === 'vcs:fileAdd');
    const lastOp = ops[ops.length - 1];

    if (firstFileOp && lastOp && firstFileOp.hash !== lastOp.hash) {
      const result = engine.diffOps(firstFileOp.hash, lastOp.hash);
      expect(result).toBeDefined();
      expect(result.stats).toBeDefined();
    }
  });

  test('diffFromOp shows changes since a point', async () => {
    rmSync(REPO_ROOT, { recursive: true, force: true });
    mkdirSync(REPO_ROOT, { recursive: true });
    writeFileSync(join(REPO_ROOT, 'a.ts'), 'v1');

    const engine = new TrellisVcsEngine({ rootPath: REPO_ROOT });
    await engine.initRepo();

    const ops = engine.getOps();
    // Diff from the branch op (first op) to HEAD should show the added file
    const branchOp = ops.find((o) => o.kind === 'vcs:branchCreate');
    if (branchOp) {
      const result = engine.diffFromOp(branchOp.hash);
      expect(result.stats.added).toBeGreaterThanOrEqual(1);
    }
  });
});
