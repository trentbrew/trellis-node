/**
 * Ref Lifecycle Tests — Rename Prompts & Stale Detection
 *
 * @see TRL-14
 */

import { describe, it, expect } from 'vitest';
import {
  StaleRefRegistry,
  buildRenameProposal,
  handleSymbolDeletion,
  handleFileDeletion,
  getDiagnostics,
  processSemanticPatches,
} from '../../src/links/lifecycle.js';
import { buildRefIndex } from '../../src/links/ref-index.js';
import type { ResolverContext } from '../../src/links/resolver.js';
import type { RefIndex } from '../../src/links/types.js';
import type { SemanticPatch } from '../../src/semantic/types.js';

// ---------------------------------------------------------------------------
// Mock ResolverContext
// ---------------------------------------------------------------------------

function mockCtx(): ResolverContext {
  return {
    hasTrackedFile: (path) =>
      ['src/engine.ts', 'src/vcs/types.ts'].includes(path),
    getIssueTitle: (id) => {
      const m: Record<string, string> = { 'TRL-5': 'Parser' };
      return m[id];
    },
    getMilestoneTitle: () => undefined,
    hasSymbol: (fp, sym) =>
      fp === 'src/engine.ts' && ['createIssue', 'TrellisVcsEngine'].includes(sym),
    hasIdentity: () => false,
    getKnownAgentIds: () => [],
    getTrackedFilePaths: () => ['src/engine.ts', 'src/vcs/types.ts'],
    getIssueIds: () => ['TRL-5'],
    getMilestoneIds: () => [],
    getSymbolNames: (fp) =>
      fp === 'src/engine.ts' ? ['createIssue', 'TrellisVcsEngine'] : [],
  };
}

function buildTestIndex(files: Array<{ path: string; content: string }>): RefIndex {
  return buildRefIndex(files, mockCtx());
}

// ---------------------------------------------------------------------------
// StaleRefRegistry
// ---------------------------------------------------------------------------

describe('StaleRefRegistry', () => {
  it('marks and retrieves stale refs', () => {
    const registry = new StaleRefRegistry();
    const sources = [{ filePath: 'docs/design.md', line: 5, col: 0, context: 'markdown' as const }];

    const entry = registry.markStale('symbol:src/engine.ts#createIssue', 'deleted', sources, {
      causeOpHash: 'op:abc123',
    });

    expect(entry.entityId).toBe('symbol:src/engine.ts#createIssue');
    expect(entry.reason).toBe('deleted');
    expect(entry.causeOpHash).toBe('op:abc123');
    expect(entry.sources).toHaveLength(1);
  });

  it('reports isStale correctly', () => {
    const registry = new StaleRefRegistry();
    expect(registry.isStale('symbol:src/engine.ts#foo')).toBe(false);

    registry.markStale('symbol:src/engine.ts#foo', 'deleted', []);
    expect(registry.isStale('symbol:src/engine.ts#foo')).toBe(true);
  });

  it('clears stale status', () => {
    const registry = new StaleRefRegistry();
    registry.markStale('symbol:src/engine.ts#foo', 'renamed', [], { newTarget: 'bar' });
    expect(registry.isStale('symbol:src/engine.ts#foo')).toBe(true);

    registry.clearStale('symbol:src/engine.ts#foo');
    expect(registry.isStale('symbol:src/engine.ts#foo')).toBe(false);
  });

  it('filters by reason', () => {
    const registry = new StaleRefRegistry();
    registry.markStale('a', 'renamed', []);
    registry.markStale('b', 'deleted', []);
    registry.markStale('c', 'renamed', []);

    expect(registry.getByReason('renamed')).toHaveLength(2);
    expect(registry.getByReason('deleted')).toHaveLength(1);
  });

  it('getAllStale returns all entries', () => {
    const registry = new StaleRefRegistry();
    registry.markStale('a', 'renamed', []);
    registry.markStale('b', 'deleted', []);
    expect(registry.getAllStale()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// buildRenameProposal
// ---------------------------------------------------------------------------

describe('buildRenameProposal', () => {
  it('builds proposal for symbol rename', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: 'See [[src/engine.ts#createIssue]] for details.' },
      { path: 'docs/notes.md', content: 'Also [[src/engine.ts#createIssue]] here.' },
    ]);

    const proposal = buildRenameProposal(index, 'src/engine.ts', 'createIssue', 'createTask');

    expect(proposal.oldTarget).toBe('symbol:src/engine.ts#createIssue');
    expect(proposal.newTarget).toBe('symbol:src/engine.ts#createTask');
    expect(proposal.affectedFiles).toHaveLength(2);
    expect(proposal.rewrites).toHaveLength(2);
    expect(proposal.rewrites[0].oldText).toBe('[[src/engine.ts#createIssue]]');
    expect(proposal.rewrites[0].newText).toBe('[[src/engine.ts#createTask]]');
  });

  it('returns empty proposal when no refs match', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: 'See [[TRL-5]] only.' },
    ]);

    const proposal = buildRenameProposal(index, 'src/engine.ts', 'createIssue', 'createTask');
    expect(proposal.rewrites).toHaveLength(0);
    expect(proposal.affectedFiles).toHaveLength(0);
  });

  it('only proposes rewrites for matching symbol', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: '[[src/engine.ts#createIssue]] and [[src/engine.ts#TrellisVcsEngine]]' },
    ]);

    const proposal = buildRenameProposal(index, 'src/engine.ts', 'createIssue', 'createTask');
    expect(proposal.rewrites).toHaveLength(1);
    expect(proposal.rewrites[0].oldText).toBe('[[src/engine.ts#createIssue]]');
  });
});

// ---------------------------------------------------------------------------
// handleSymbolDeletion
// ---------------------------------------------------------------------------

describe('handleSymbolDeletion', () => {
  it('marks refs as stale when symbol is deleted', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: 'Uses [[src/engine.ts#createIssue]].' },
    ]);
    const registry = new StaleRefRegistry();

    const stale = handleSymbolDeletion(index, registry, 'src/engine.ts', 'createIssue', 'op:del1');

    expect(stale).not.toBeNull();
    expect(stale!.entityId).toBe('symbol:src/engine.ts#createIssue');
    expect(stale!.reason).toBe('deleted');
    expect(stale!.causeOpHash).toBe('op:del1');
    expect(stale!.sources).toHaveLength(1);
    expect(registry.isStale('symbol:src/engine.ts#createIssue')).toBe(true);
  });

  it('returns null when no refs reference the deleted symbol', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: 'No symbol refs here, just [[TRL-5]].' },
    ]);
    const registry = new StaleRefRegistry();

    const stale = handleSymbolDeletion(index, registry, 'src/engine.ts', 'createIssue');
    expect(stale).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleFileDeletion
// ---------------------------------------------------------------------------

describe('handleFileDeletion', () => {
  it('marks refs as stale when file is deleted', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: 'See [[src/engine.ts]] for the main module.' },
    ]);
    const registry = new StaleRefRegistry();

    const stale = handleFileDeletion(index, registry, 'src/engine.ts', 'op:del2');

    expect(stale).not.toBeNull();
    expect(stale!.entityId).toBe('file:src/engine.ts');
    expect(stale!.reason).toBe('deleted');
    expect(registry.isStale('file:src/engine.ts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getDiagnostics
// ---------------------------------------------------------------------------

describe('getDiagnostics', () => {
  it('reports stale refs as warnings', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: '[[src/engine.ts#createIssue]]' },
    ]);
    const registry = new StaleRefRegistry();
    handleSymbolDeletion(index, registry, 'src/engine.ts', 'createIssue');

    const resolved = new Set<string>();
    const diags = getDiagnostics(index, registry, resolved);

    expect(diags).toHaveLength(1);
    expect(diags[0].state).toBe('stale');
    expect(diags[0].message).toContain('stale');
    expect(diags[0].message).toContain('removed');
  });

  it('reports broken refs as errors', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: '[[src/engine.ts#nonexistent]]' },
    ]);
    const registry = new StaleRefRegistry();
    const resolved = new Set<string>(); // nothing resolved

    const diags = getDiagnostics(index, registry, resolved);

    expect(diags).toHaveLength(1);
    expect(diags[0].state).toBe('broken');
    expect(diags[0].message).toContain('does not exist');
  });

  it('does not report resolved refs', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: '[[TRL-5]]' },
    ]);
    const registry = new StaleRefRegistry();
    const resolved = new Set(['issue:TRL-5']);

    const diags = getDiagnostics(index, registry, resolved);
    expect(diags).toHaveLength(0);
  });

  it('stale takes priority over broken', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: '[[src/engine.ts#createIssue]]' },
    ]);
    const registry = new StaleRefRegistry();
    handleSymbolDeletion(index, registry, 'src/engine.ts', 'createIssue');

    // Not in resolved set, but IS stale — should show as stale, not broken
    const resolved = new Set<string>();
    const diags = getDiagnostics(index, registry, resolved);

    expect(diags).toHaveLength(1);
    expect(diags[0].state).toBe('stale');
  });
});

// ---------------------------------------------------------------------------
// processSemanticPatches
// ---------------------------------------------------------------------------

describe('processSemanticPatches', () => {
  it('produces rename-proposal event for symbolRename', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: '[[src/engine.ts#createIssue]]' },
    ]);
    const registry = new StaleRefRegistry();

    const patches: SemanticPatch[] = [
      { kind: 'symbolRename', entityId: 'fn:createIssue', oldName: 'createIssue', newName: 'createTask' },
    ];

    const events = processSemanticPatches(patches, 'src/engine.ts', index, registry);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('rename-proposal');
    expect(events[0].proposal).toBeDefined();
    expect(events[0].proposal!.rewrites).toHaveLength(1);
  });

  it('produces stale-detected event for symbolRemove', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: '[[src/engine.ts#createIssue]]' },
    ]);
    const registry = new StaleRefRegistry();

    const patches: SemanticPatch[] = [
      { kind: 'symbolRemove', entityId: 'fn:createIssue', entityName: 'createIssue' },
    ];

    const events = processSemanticPatches(patches, 'src/engine.ts', index, registry, 'op:xyz');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stale-detected');
    expect(events[0].staleRef).toBeDefined();
    expect(events[0].staleRef!.reason).toBe('deleted');
    expect(events[0].staleRef!.causeOpHash).toBe('op:xyz');
  });

  it('handles mixed patches', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: '[[src/engine.ts#createIssue]] and [[src/engine.ts#TrellisVcsEngine]]' },
    ]);
    const registry = new StaleRefRegistry();

    const patches: SemanticPatch[] = [
      { kind: 'symbolRename', entityId: 'fn:createIssue', oldName: 'createIssue', newName: 'createTask' },
      { kind: 'symbolRemove', entityId: 'cls:TrellisVcsEngine', entityName: 'TrellisVcsEngine' },
    ];

    const events = processSemanticPatches(patches, 'src/engine.ts', index, registry);

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('rename-proposal');
    expect(events[1].type).toBe('stale-detected');
  });

  it('ignores patches that do not affect any refs', () => {
    const index = buildTestIndex([
      { path: 'docs/design.md', content: '[[TRL-5]]' },
    ]);
    const registry = new StaleRefRegistry();

    const patches: SemanticPatch[] = [
      { kind: 'symbolRename', entityId: 'fn:foo', oldName: 'foo', newName: 'bar' },
      { kind: 'symbolRemove', entityId: 'fn:baz', entityName: 'baz' },
    ];

    const events = processSemanticPatches(patches, 'src/engine.ts', index, registry);
    expect(events).toHaveLength(0);
  });
});
