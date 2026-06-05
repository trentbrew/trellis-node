import { describe, it, expect } from 'vitest';
import { projectIssues } from '../../demo/state-demo/issue-projector.js';
import type { VcsOp } from '../../src/vcs/types.js';

function op(partial: Partial<VcsOp> & { kind: VcsOp['kind'] }): VcsOp {
  return {
    hash: `trellis:op:${partial.kind}`,
    timestamp: '2026-01-01T00:00:00.000Z',
    agentId: 'agent:test',
    kind: partial.kind,
    vcs: partial.vcs ?? {},
    ...partial,
  } as VcsOp;
}

describe('projectIssues (state demo)', () => {
  it('projects create and close', () => {
    const ops: VcsOp[] = [
      op({
        kind: 'vcs:issueCreate',
        hash: 'h1',
        vcs: { issueId: 'TRL-1', issueTitle: 'Buy milk', issueStatus: 'queue' },
      }),
      op({
        kind: 'vcs:issueClose',
        hash: 'h2',
        previousHash: 'h1',
        vcs: { issueId: 'TRL-1', issueStatus: 'closed' },
      }),
    ];
    const issues = projectIssues(ops);
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe('Buy milk');
    expect(issues[0].status).toBe('closed');
  });
});
