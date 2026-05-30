/**
 * Bidirectional Reference Index Tests
 *
 * @see TRL-13
 */

import { describe, it, expect } from 'vitest';
import {
  buildRefIndex,
  updateFileInIndex,
  removeFileFromIndex,
  getOutgoingRefs,
  getBacklinks,
  getReferencedEntities,
  getFilesWithRefs,
  getIndexStats,
} from '../../src/links/ref-index.js';
import type { ResolverContext } from '../../src/links/resolver.js';

// ---------------------------------------------------------------------------
// Mock ResolverContext
// ---------------------------------------------------------------------------

function mockCtx(): ResolverContext {
  return {
    hasTrackedFile: (path) =>
      ['src/engine.ts', 'src/vcs/types.ts', 'README.md'].includes(path),
    getIssueTitle: (id) => {
      const m: Record<string, string> = { 'TRL-5': 'Add Python parser', 'TRL-11': 'Wiki-link parser' };
      return m[id];
    },
    getMilestoneTitle: () => undefined,
    hasSymbol: (fp, sym) =>
      fp === 'src/engine.ts' && sym === 'createIssue',
    hasIdentity: (id) => id === 'trentbrew',
    getKnownAgentIds: () => ['agent:trentbrew'],
    getTrackedFilePaths: () => ['src/engine.ts', 'src/vcs/types.ts', 'README.md'],
    getIssueIds: () => ['TRL-5', 'TRL-11'],
    getMilestoneIds: () => [],
    getSymbolNames: (fp) =>
      fp === 'src/engine.ts' ? ['createIssue', 'TrellisVcsEngine'] : [],
  };
}

// ---------------------------------------------------------------------------
// buildRefIndex
// ---------------------------------------------------------------------------

describe('buildRefIndex', () => {
  it('builds index from multiple files', () => {
    const files = [
      { path: 'docs/design.md', content: 'See [[TRL-5]] and [[src/engine.ts]].' },
      { path: 'docs/notes.md', content: 'Also [[TRL-5]] here and [[TRL-11]].' },
    ];
    const index = buildRefIndex(files, mockCtx());

    // Outgoing: 2 files
    expect(getFilesWithRefs(index)).toHaveLength(2);
    expect(getOutgoingRefs(index, 'docs/design.md')).toHaveLength(2);
    expect(getOutgoingRefs(index, 'docs/notes.md')).toHaveLength(2);

    // Incoming: TRL-5 referenced from both files
    const trl5Backlinks = getBacklinks(index, 'issue:TRL-5');
    expect(trl5Backlinks).toHaveLength(2);
    expect(trl5Backlinks.map((s) => s.filePath).sort()).toEqual([
      'docs/design.md',
      'docs/notes.md',
    ]);

    // file:src/engine.ts referenced from design.md only
    const engineBacklinks = getBacklinks(index, 'file:src/engine.ts');
    expect(engineBacklinks).toHaveLength(1);
    expect(engineBacklinks[0].filePath).toBe('docs/design.md');
  });

  it('returns empty index for no files', () => {
    const index = buildRefIndex([], mockCtx());
    expect(getIndexStats(index)).toEqual({
      totalFiles: 0,
      totalRefs: 0,
      totalEntities: 0,
    });
  });

  it('skips files with no refs', () => {
    const files = [
      { path: 'docs/empty.md', content: 'No wiki links here.' },
      { path: 'docs/has-ref.md', content: 'See [[TRL-5]].' },
    ];
    const index = buildRefIndex(files, mockCtx());
    expect(getFilesWithRefs(index)).toEqual(['docs/has-ref.md']);
  });
});

// ---------------------------------------------------------------------------
// getIndexStats
// ---------------------------------------------------------------------------

describe('getIndexStats', () => {
  it('reports correct counts', () => {
    const files = [
      { path: 'a.md', content: '[[TRL-5]] and [[TRL-11]]' },
      { path: 'b.md', content: '[[TRL-5]]' },
    ];
    const index = buildRefIndex(files, mockCtx());
    const stats = getIndexStats(index);
    expect(stats.totalFiles).toBe(2);
    expect(stats.totalRefs).toBe(3);
    expect(stats.totalEntities).toBe(2); // TRL-5 and TRL-11
  });
});

// ---------------------------------------------------------------------------
// updateFileInIndex
// ---------------------------------------------------------------------------

describe('updateFileInIndex', () => {
  it('adds new file to existing index', () => {
    const index = buildRefIndex(
      [{ path: 'a.md', content: '[[TRL-5]]' }],
      mockCtx(),
    );
    expect(getIndexStats(index).totalFiles).toBe(1);

    updateFileInIndex(index, 'b.md', '[[TRL-11]]', mockCtx());
    expect(getIndexStats(index).totalFiles).toBe(2);
    expect(getOutgoingRefs(index, 'b.md')).toHaveLength(1);
    expect(getBacklinks(index, 'issue:TRL-11')).toHaveLength(1);
  });

  it('replaces refs when a file is modified', () => {
    const index = buildRefIndex(
      [{ path: 'a.md', content: '[[TRL-5]] and [[TRL-11]]' }],
      mockCtx(),
    );
    expect(getOutgoingRefs(index, 'a.md')).toHaveLength(2);
    expect(getBacklinks(index, 'issue:TRL-5')).toHaveLength(1);
    expect(getBacklinks(index, 'issue:TRL-11')).toHaveLength(1);

    // Modify: remove TRL-5, keep TRL-11
    updateFileInIndex(index, 'a.md', 'Only [[TRL-11]] now.', mockCtx());
    expect(getOutgoingRefs(index, 'a.md')).toHaveLength(1);
    expect(getBacklinks(index, 'issue:TRL-5')).toHaveLength(0);
    expect(getBacklinks(index, 'issue:TRL-11')).toHaveLength(1);
  });

  it('does not affect other files when updating one', () => {
    const index = buildRefIndex(
      [
        { path: 'a.md', content: '[[TRL-5]]' },
        { path: 'b.md', content: '[[TRL-5]]' },
      ],
      mockCtx(),
    );
    expect(getBacklinks(index, 'issue:TRL-5')).toHaveLength(2);

    // Update a.md to remove TRL-5
    updateFileInIndex(index, 'a.md', 'No refs.', mockCtx());
    // b.md still has it
    expect(getBacklinks(index, 'issue:TRL-5')).toHaveLength(1);
    expect(getBacklinks(index, 'issue:TRL-5')[0].filePath).toBe('b.md');
  });
});

// ---------------------------------------------------------------------------
// removeFileFromIndex
// ---------------------------------------------------------------------------

describe('removeFileFromIndex', () => {
  it('removes all refs from a deleted file', () => {
    const index = buildRefIndex(
      [
        { path: 'a.md', content: '[[TRL-5]] and [[TRL-11]]' },
        { path: 'b.md', content: '[[TRL-5]]' },
      ],
      mockCtx(),
    );

    removeFileFromIndex(index, 'a.md');

    expect(getFilesWithRefs(index)).toEqual(['b.md']);
    expect(getOutgoingRefs(index, 'a.md')).toHaveLength(0);
    // TRL-5 still has backlink from b.md
    expect(getBacklinks(index, 'issue:TRL-5')).toHaveLength(1);
    // TRL-11 has no more backlinks
    expect(getBacklinks(index, 'issue:TRL-11')).toHaveLength(0);
  });

  it('is a no-op for files not in the index', () => {
    const index = buildRefIndex(
      [{ path: 'a.md', content: '[[TRL-5]]' }],
      mockCtx(),
    );
    removeFileFromIndex(index, 'nonexistent.md');
    expect(getIndexStats(index).totalFiles).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getBacklinks / getOutgoingRefs edge cases
// ---------------------------------------------------------------------------

describe('getBacklinks', () => {
  it('returns empty array for unknown entity', () => {
    const index = buildRefIndex([], mockCtx());
    expect(getBacklinks(index, 'issue:TRL-999')).toHaveLength(0);
  });
});

describe('getOutgoingRefs', () => {
  it('returns empty array for file not in index', () => {
    const index = buildRefIndex([], mockCtx());
    expect(getOutgoingRefs(index, 'nonexistent.md')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getReferencedEntities
// ---------------------------------------------------------------------------

describe('getReferencedEntities', () => {
  it('lists all entities with backlinks', () => {
    const index = buildRefIndex(
      [{ path: 'a.md', content: '[[TRL-5]] and [[src/engine.ts]]' }],
      mockCtx(),
    );
    const entities = getReferencedEntities(index);
    expect(entities).toHaveLength(2);
    expect(entities).toContain('issue:TRL-5');
    expect(entities).toContain('file:src/engine.ts');
  });
});

// ---------------------------------------------------------------------------
// Incremental update simulation
// ---------------------------------------------------------------------------

describe('incremental updates', () => {
  it('handles add → modify → delete cycle', () => {
    const ctx = mockCtx();
    const index = buildRefIndex([], ctx);

    // Add file
    updateFileInIndex(index, 'docs/new.md', '[[TRL-5]]', ctx);
    expect(getIndexStats(index).totalFiles).toBe(1);
    expect(getBacklinks(index, 'issue:TRL-5')).toHaveLength(1);

    // Modify file
    updateFileInIndex(index, 'docs/new.md', '[[TRL-5]] and [[TRL-11]]', ctx);
    expect(getOutgoingRefs(index, 'docs/new.md')).toHaveLength(2);
    expect(getBacklinks(index, 'issue:TRL-5')).toHaveLength(1);
    expect(getBacklinks(index, 'issue:TRL-11')).toHaveLength(1);

    // Delete file
    removeFileFromIndex(index, 'docs/new.md');
    expect(getIndexStats(index).totalFiles).toBe(0);
    expect(getBacklinks(index, 'issue:TRL-5')).toHaveLength(0);
    expect(getBacklinks(index, 'issue:TRL-11')).toHaveLength(0);
  });
});
