/**
 * Entity Reference Resolver Tests
 *
 * @see TRL-12
 */

import { describe, it, expect } from 'vitest';
import { resolveRef, resolveRefs } from '../../src/links/resolver.js';
import type { ResolverContext } from '../../src/links/resolver.js';
import type { EntityRef } from '../../src/links/types.js';

// ---------------------------------------------------------------------------
// Mock ResolverContext
// ---------------------------------------------------------------------------

function mockContext(overrides?: Partial<ResolverContext>): ResolverContext {
  return {
    hasTrackedFile: (path) =>
      ['src/engine.ts', 'src/vcs/types.ts', 'README.md'].includes(path),
    getIssueTitle: (id) => {
      const issues: Record<string, string> = {
        'TRL-5': 'Add Python parser',
        'TRL-11': 'Wiki-link parser',
      };
      return issues[id];
    },
    getMilestoneTitle: (idOrMsg) => {
      if (idOrMsg === 'milestone:abc123') return 'Context Graph v0.1';
      if (idOrMsg === 'v0.1') return 'Context Graph v0.1';
      return undefined;
    },
    hasSymbol: (filePath, symbolName) => {
      if (filePath === 'src/engine.ts' && symbolName === 'createIssue')
        return true;
      if (filePath === 'src/engine.ts' && symbolName === 'TrellisVcsEngine')
        return true;
      if (filePath === 'src/vcs/types.ts' && symbolName === 'VcsPayload')
        return true;
      return false;
    },
    hasIdentity: (id) =>
      ['agent:trentbrew', 'trentbrew', 'agent:cascade'].includes(id),
    getKnownAgentIds: () => ['agent:trentbrew', 'agent:cascade'],
    getTrackedFilePaths: () => [
      'src/engine.ts',
      'src/vcs/types.ts',
      'README.md',
    ],
    getIssueIds: () => ['TRL-5', 'TRL-11'],
    getMilestoneIds: () => ['milestone:abc123'],
    getSymbolNames: (filePath) => {
      if (filePath === 'src/engine.ts')
        return ['createIssue', 'TrellisVcsEngine'];
      if (filePath === 'src/vcs/types.ts') return ['VcsPayload', 'VcsOp'];
      return [];
    },
    hasDecision: (id) => ['DEC-1', 'DEC-2'].includes(id),
    getDecisionTitle: (id) => {
      const decisions: Record<string, string> = {
        'DEC-1': 'trellis_issue_create',
        'DEC-2': 'trellis_milestone',
      };
      return decisions[id];
    },
    ...overrides,
  };
}

function makeRef(
  overrides: Partial<EntityRef> & {
    namespace: EntityRef['namespace'];
    target: string;
  },
): EntityRef {
  return {
    raw: overrides.raw ?? `${overrides.namespace}:${overrides.target}`,
    namespace: overrides.namespace,
    target: overrides.target,
    anchor: overrides.anchor,
    alias: overrides.alias,
    source: overrides.source ?? {
      filePath: 'test.md',
      line: 1,
      col: 0,
      context: 'markdown',
    },
  };
}

// ---------------------------------------------------------------------------
// Issue resolution
// ---------------------------------------------------------------------------

describe('resolveRef — issue', () => {
  it('resolves a known issue', () => {
    const ref = makeRef({ namespace: 'issue', target: 'TRL-5' });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('resolved');
    expect(resolved.entityId).toBe('issue:TRL-5');
    expect(resolved.title).toBe('Add Python parser');
  });

  it('marks unknown issue as broken', () => {
    const ref = makeRef({ namespace: 'issue', target: 'TRL-999' });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('broken');
    expect(resolved.entityId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// File resolution
// ---------------------------------------------------------------------------

describe('resolveRef — file', () => {
  it('resolves a tracked file', () => {
    const ref = makeRef({ namespace: 'file', target: 'src/engine.ts' });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('resolved');
    expect(resolved.entityId).toBe('file:src/engine.ts');
  });

  it('marks untracked file as broken', () => {
    const ref = makeRef({ namespace: 'file', target: 'src/nonexistent.ts' });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('broken');
  });
});

// ---------------------------------------------------------------------------
// Symbol resolution
// ---------------------------------------------------------------------------

describe('resolveRef — symbol', () => {
  it('resolves a known symbol in a tracked file', () => {
    const ref = makeRef({
      namespace: 'symbol',
      target: 'src/engine.ts',
      anchor: 'createIssue',
    });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('resolved');
    expect(resolved.entityId).toBe('symbol:src/engine.ts#createIssue');
    expect(resolved.title).toBe('createIssue in src/engine.ts');
  });

  it('marks unknown symbol in tracked file as broken', () => {
    const ref = makeRef({
      namespace: 'symbol',
      target: 'src/engine.ts',
      anchor: 'nonexistentFn',
    });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('broken');
  });

  it('marks symbol in untracked file as broken', () => {
    const ref = makeRef({
      namespace: 'symbol',
      target: 'src/nonexistent.ts',
      anchor: 'foo',
    });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('broken');
  });

  it('falls back to file resolution when no anchor', () => {
    const ref = makeRef({ namespace: 'symbol', target: 'src/engine.ts' });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('resolved');
    expect(resolved.entityId).toBe('file:src/engine.ts');
  });
});

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

describe('resolveRef — identity', () => {
  it('resolves a known identity', () => {
    const ref = makeRef({ namespace: 'identity', target: 'trentbrew' });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('resolved');
    expect(resolved.entityId).toBe('identity:trentbrew');
  });

  it('resolves agent-prefixed identity', () => {
    const ref = makeRef({ namespace: 'identity', target: 'agent:cascade' });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('resolved');
  });

  it('marks unknown identity as broken', () => {
    const ref = makeRef({ namespace: 'identity', target: 'unknown-agent' });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('broken');
  });
});

// ---------------------------------------------------------------------------
// Milestone resolution
// ---------------------------------------------------------------------------

describe('resolveRef — milestone', () => {
  it('resolves a milestone by ID', () => {
    const ref = makeRef({ namespace: 'milestone', target: 'milestone:abc123' });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('resolved');
    expect(resolved.title).toBe('Context Graph v0.1');
  });

  it('resolves a milestone by message fragment', () => {
    const ref = makeRef({ namespace: 'milestone', target: 'v0.1' });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('resolved');
  });

  it('marks unknown milestone as broken', () => {
    const ref = makeRef({ namespace: 'milestone', target: 'v99.0' });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('broken');
  });
});

// ---------------------------------------------------------------------------
// Decision resolution
// ---------------------------------------------------------------------------

describe('resolveRef — decision', () => {
  it('resolves a known decision', () => {
    const ref = makeRef({ namespace: 'decision', target: 'DEC-1' });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('resolved');
    expect(resolved.entityId).toBe('decision:DEC-1');
    expect(resolved.title).toBe('trellis_issue_create');
  });

  it('marks unknown decision as broken', () => {
    const ref = makeRef({ namespace: 'decision', target: 'DEC-999' });
    const resolved = resolveRef(ref, mockContext());
    expect(resolved.state).toBe('broken');
  });
});

// ---------------------------------------------------------------------------
// Batch resolution
// ---------------------------------------------------------------------------

describe('resolveRefs', () => {
  it('resolves multiple refs in batch', () => {
    const refs = [
      makeRef({ namespace: 'issue', target: 'TRL-5' }),
      makeRef({ namespace: 'file', target: 'src/engine.ts' }),
      makeRef({ namespace: 'issue', target: 'TRL-999' }),
    ];
    const resolved = resolveRefs(refs, mockContext());
    expect(resolved).toHaveLength(3);
    expect(resolved[0].state).toBe('resolved');
    expect(resolved[1].state).toBe('resolved');
    expect(resolved[2].state).toBe('broken');
  });

  it('preserves original ref data in resolved refs', () => {
    const ref = makeRef({
      namespace: 'issue',
      target: 'TRL-5',
      alias: 'parser ticket',
      raw: 'issue:TRL-5|parser ticket',
    });
    const [resolved] = resolveRefs([ref], mockContext());
    expect(resolved.alias).toBe('parser ticket');
    expect(resolved.raw).toBe('issue:TRL-5|parser ticket');
    expect(resolved.source.filePath).toBe('test.md');
  });
});
