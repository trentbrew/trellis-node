/**
 * Minimal issue projection from a causal op list (browser demo — no full engine).
 */
import type { VcsOp } from '../../src/vcs/types.js';

export type DemoIssue = {
  id: string;
  title: string;
  status: 'open' | 'closed';
  priority?: string;
  agentId?: string;
};

export function projectIssues(ops: VcsOp[]): DemoIssue[] {
  const byId = new Map<string, DemoIssue>();

  for (const op of ops) {
    const id = op.vcs?.issueId;
    if (!id) continue;

    if (op.kind === 'vcs:issueCreate') {
      byId.set(id, {
        id,
        title: op.vcs?.issueTitle ?? id,
        status: op.vcs?.issueStatus === 'closed' ? 'closed' : 'open',
        priority: op.vcs?.issuePriority,
        agentId: op.agentId,
      });
      continue;
    }

    const issue = byId.get(id);
    if (!issue) continue;

    if (op.kind === 'vcs:issueClose') {
      issue.status = 'closed';
    } else if (op.kind === 'vcs:issueReopen') {
      issue.status = 'open';
    } else if (op.kind === 'vcs:issueUpdate' && op.vcs?.issueStatus === 'closed') {
      issue.status = 'closed';
    } else if (op.kind === 'vcs:issueUpdate' && op.vcs?.issueTitle) {
      issue.title = op.vcs.issueTitle;
    }
  }

  return [...byId.values()];
}
