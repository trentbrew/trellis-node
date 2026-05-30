import { describe, test, expect } from 'vitest';
import {
  threeWayMerge,
  threeWayTextMerge,
  type MergeResult,
} from '../../src/vcs/merge.js';
import { BlobStore } from '../../src/vcs/blob-store.js';
import type { FileState } from '../../src/vcs/diff.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Three-way text merge
// ---------------------------------------------------------------------------

describe('threeWayTextMerge', () => {
  test('identical changes on both sides merge cleanly', () => {
    const result = threeWayTextMerge(
      'a\nb\nc',
      'a\nX\nc',
      'a\nX\nc',
    );
    expect(result.clean).toBe(true);
    expect(result.merged).toBe('a\nX\nc');
  });

  test('non-overlapping changes merge cleanly', () => {
    const result = threeWayTextMerge(
      'a\nb\nc\nd',
      'A\nb\nc\nd', // changed first line
      'a\nb\nc\nD', // changed last line
    );
    expect(result.clean).toBe(true);
    expect(result.merged).toContain('A');
    expect(result.merged).toContain('D');
  });

  test('overlapping changes produce conflict', () => {
    const result = threeWayTextMerge(
      'a\nb\nc',
      'a\nOURS\nc',
      'a\nTHEIRS\nc',
    );
    expect(result.clean).toBe(false);
    expect(result.merged).toContain('<<<<<<< ours');
    expect(result.merged).toContain('OURS');
    expect(result.merged).toContain('=======');
    expect(result.merged).toContain('THEIRS');
    expect(result.merged).toContain('>>>>>>> theirs');
  });

  test('only ours changed', () => {
    const result = threeWayTextMerge(
      'a\nb\nc',
      'a\nX\nc',
      'a\nb\nc',
    );
    expect(result.clean).toBe(true);
    expect(result.merged).toBe('a\nX\nc');
  });

  test('only theirs changed', () => {
    const result = threeWayTextMerge(
      'a\nb\nc',
      'a\nb\nc',
      'a\nY\nc',
    );
    expect(result.clean).toBe(true);
    expect(result.merged).toBe('a\nY\nc');
  });

  test('empty base with both adding different content conflicts', () => {
    const result = threeWayTextMerge(
      '',
      'ours content',
      'theirs content',
    );
    expect(result.clean).toBe(false);
    expect(result.merged).toContain('<<<<<<< ours');
  });

  test('both sides unchanged returns base', () => {
    const result = threeWayTextMerge('same\ntext', 'same\ntext', 'same\ntext');
    expect(result.clean).toBe(true);
    expect(result.merged).toBe('same\ntext');
  });
});

// ---------------------------------------------------------------------------
// Three-way file merge
// ---------------------------------------------------------------------------

describe('threeWayMerge', () => {
  test('no changes on either side produces clean merge', () => {
    const base = new Map<string, FileState>([['a.ts', { contentHash: 'h1' }]]);
    const ours = new Map<string, FileState>([['a.ts', { contentHash: 'h1' }]]);
    const theirs = new Map<string, FileState>([['a.ts', { contentHash: 'h1' }]]);

    const result = threeWayMerge(base, ours, theirs);
    expect(result.clean).toBe(true);
    expect(result.conflicts.length).toBe(0);
  });

  test('only theirs added a file — auto-merged', () => {
    const testDir = '/tmp/trellis-merge-test-add';
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.trellis'), { recursive: true });
    const bs = new BlobStore(join(testDir, '.trellis'));
    const hash = bs.putSync(Buffer.from('new file'));

    const base = new Map<string, FileState>();
    const ours = new Map<string, FileState>();
    const theirs = new Map<string, FileState>([['new.ts', { contentHash: hash }]]);

    const result = threeWayMerge(base, ours, theirs, bs);
    expect(result.clean).toBe(true);
    expect(result.mergedFiles.get('new.ts')).toBe('new file');

    rmSync(testDir, { recursive: true, force: true });
  });

  test('only theirs deleted a file — auto-merged as deletion', () => {
    const base = new Map<string, FileState>([['a.ts', { contentHash: 'h1' }]]);
    const ours = new Map<string, FileState>([['a.ts', { contentHash: 'h1' }]]);
    const theirs = new Map<string, FileState>([['a.ts', { deleted: true }]]);

    const result = threeWayMerge(base, ours, theirs);
    expect(result.clean).toBe(true);
    expect(result.mergedFiles.get('a.ts')).toBeNull();
  });

  test('only ours modified — no merge needed', () => {
    const base = new Map<string, FileState>([['a.ts', { contentHash: 'h1' }]]);
    const ours = new Map<string, FileState>([['a.ts', { contentHash: 'h2' }]]);
    const theirs = new Map<string, FileState>([['a.ts', { contentHash: 'h1' }]]);

    const result = threeWayMerge(base, ours, theirs);
    expect(result.clean).toBe(true);
    expect(result.conflicts.length).toBe(0);
    // Ours is already ahead — nothing to merge
  });

  test('modify-delete conflict', () => {
    const testDir = '/tmp/trellis-merge-test-md';
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.trellis'), { recursive: true });
    const bs = new BlobStore(join(testDir, '.trellis'));
    const h2 = bs.putSync(Buffer.from('modified'));

    const base = new Map<string, FileState>([['a.ts', { contentHash: 'h1' }]]);
    const ours = new Map<string, FileState>([['a.ts', { contentHash: h2 }]]);
    const theirs = new Map<string, FileState>([['a.ts', { deleted: true }]]);

    const result = threeWayMerge(base, ours, theirs, bs);
    expect(result.clean).toBe(false);
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].kind).toBe('modify-delete');

    rmSync(testDir, { recursive: true, force: true });
  });

  test('modify-modify conflict with text merge', () => {
    const testDir = '/tmp/trellis-merge-test-mm';
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.trellis'), { recursive: true });
    const bs = new BlobStore(join(testDir, '.trellis'));

    const baseHash = bs.putSync(Buffer.from('a\nb\nc'));
    const oursHash = bs.putSync(Buffer.from('a\nOURS\nc'));
    const theirsHash = bs.putSync(Buffer.from('a\nTHEIRS\nc'));

    const base = new Map<string, FileState>([['a.ts', { contentHash: baseHash }]]);
    const ours = new Map<string, FileState>([['a.ts', { contentHash: oursHash }]]);
    const theirs = new Map<string, FileState>([['a.ts', { contentHash: theirsHash }]]);

    const result = threeWayMerge(base, ours, theirs, bs);
    expect(result.clean).toBe(false);
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].kind).toBe('modify-modify');
    expect(result.conflicts[0].mergedWithMarkers).toContain('<<<<<<< ours');

    rmSync(testDir, { recursive: true, force: true });
  });

  test('modify-modify with non-overlapping changes merges cleanly', () => {
    const testDir = '/tmp/trellis-merge-test-mm-clean';
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.trellis'), { recursive: true });
    const bs = new BlobStore(join(testDir, '.trellis'));

    const baseHash = bs.putSync(Buffer.from('a\nb\nc\nd'));
    const oursHash = bs.putSync(Buffer.from('A\nb\nc\nd'));     // changed line 1
    const theirsHash = bs.putSync(Buffer.from('a\nb\nc\nD'));   // changed line 4

    const base = new Map<string, FileState>([['a.ts', { contentHash: baseHash }]]);
    const ours = new Map<string, FileState>([['a.ts', { contentHash: oursHash }]]);
    const theirs = new Map<string, FileState>([['a.ts', { contentHash: theirsHash }]]);

    const result = threeWayMerge(base, ours, theirs, bs);
    expect(result.clean).toBe(true);
    expect(result.mergedFiles.get('a.ts')).toContain('A');
    expect(result.mergedFiles.get('a.ts')).toContain('D');

    rmSync(testDir, { recursive: true, force: true });
  });

  test('add-add conflict', () => {
    const testDir = '/tmp/trellis-merge-test-aa';
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.trellis'), { recursive: true });
    const bs = new BlobStore(join(testDir, '.trellis'));

    const oursHash = bs.putSync(Buffer.from('ours version'));
    const theirsHash = bs.putSync(Buffer.from('theirs version'));

    const base = new Map<string, FileState>();
    const ours = new Map<string, FileState>([['new.ts', { contentHash: oursHash }]]);
    const theirs = new Map<string, FileState>([['new.ts', { contentHash: theirsHash }]]);

    const result = threeWayMerge(base, ours, theirs, bs);
    expect(result.clean).toBe(false);
    expect(result.conflicts[0].kind).toBe('add-add');

    rmSync(testDir, { recursive: true, force: true });
  });

  test('both sides add identical file — no conflict', () => {
    const testDir = '/tmp/trellis-merge-test-aa-same';
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.trellis'), { recursive: true });
    const bs = new BlobStore(join(testDir, '.trellis'));

    const hash = bs.putSync(Buffer.from('same content'));

    const base = new Map<string, FileState>();
    const ours = new Map<string, FileState>([['new.ts', { contentHash: hash }]]);
    const theirs = new Map<string, FileState>([['new.ts', { contentHash: hash }]]);

    const result = threeWayMerge(base, ours, theirs, bs);
    expect(result.clean).toBe(true);

    rmSync(testDir, { recursive: true, force: true });
  });
});
