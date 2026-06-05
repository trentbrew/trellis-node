import { createVcsOp } from '../../src/vcs/ops.js';
import type { VcsOp } from '../../src/vcs/types.js';
import { projectIssues, type DemoIssue } from './issue-projector.js';

export type DemoSessionOptions = {
  agentId?: string;
  onChange?: (state: DemoSessionState) => void;
  /** Called after local writes (for room sync). */
  onAfterWrite?: () => void | Promise<void>;
};

export type DemoSessionState = {
  ops: VcsOp[];
  issues: DemoIssue[];
};

export class DemoSession {
  private agentId: string;
  private ops: VcsOp[] = [];
  private issueSeq = 0;
  private onChange?: (state: DemoSessionState) => void;
  private onAfterWrite?: () => void | Promise<void>;

  constructor(opts: DemoSessionOptions = {}) {
    this.agentId = opts.agentId ?? 'agent:demo';
    this.onChange = opts.onChange;
    this.onAfterWrite = opts.onAfterWrite;
  }

  getAgentId(): string {
    return this.agentId;
  }

  getOps(): VcsOp[] {
    return [...this.ops];
  }

  getIssues(): DemoIssue[] {
    const owned = new Set<string>();
    for (const op of this.ops) {
      if (
        op.kind === 'vcs:issueCreate' &&
        op.agentId === this.agentId &&
        op.vcs?.issueId
      ) {
        owned.add(op.vcs.issueId);
      }
    }
    return projectIssues(this.ops).filter((i) => owned.has(i.id));
  }

  /** Merge remote ops (dedupe by hash, sort by time). */
  integrate(remote: VcsOp[]): void {
    const seen = new Set(this.ops.map((o) => o.hash));
    let changed = false;
    for (const op of remote) {
      if (seen.has(op.hash)) continue;
      this.ops.push(op);
      seen.add(op.hash);
      changed = true;
    }
    if (changed) {
      this.ops.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      this.emit();
    }
  }

  private nextIssueId(): string {
    this.issueSeq += 1;
    const slug = this.agentId.replace(/^agent:/, '') || 'peer';
    return `TRL-${slug}-${this.issueSeq}`;
  }

  async addIssue(title: string, priority: 'low' | 'medium' | 'high' = 'medium'): Promise<VcsOp> {
    const issueId = this.nextIssueId();
    const op = await createVcsOp('vcs:issueCreate', {
      agentId: this.agentId,
      previousHash: this.lastHash(),
      vcs: {
        issueId,
        issueTitle: title.trim() || 'Untitled',
        issueStatus: 'queue',
        issuePriority: priority,
      },
    });
    this.ops.push(op);
    const advance = await createVcsOp('vcs:branchAdvance', {
      agentId: this.agentId,
      previousHash: op.hash,
      vcs: { branchName: 'main', headHash: op.hash },
    });
    this.ops.push(advance);
    this.emit();
    return op;
  }

  async setIssueClosed(id: string, closed: boolean): Promise<VcsOp | null> {
    const issue = this.getIssues().find((i) => i.id === id);
    if (!issue) return null;
    if (closed && issue.status === 'closed') return null;
    if (!closed && issue.status === 'open') return null;

    const kind = closed ? 'vcs:issueClose' : 'vcs:issueReopen';
    const op = await createVcsOp(kind, {
      agentId: this.agentId,
      previousHash: this.lastHash(),
      vcs: {
        issueId: id,
        issueStatus: closed ? 'closed' : 'queue',
      },
    });
    this.ops.push(op);
    this.emit();
    return op;
  }

  private lastHash(): string | undefined {
    return this.ops[this.ops.length - 1]?.hash;
  }

  private emit(): void {
    this.onChange?.({ ops: this.getOps(), issues: this.getIssues() });
    void this.onAfterWrite?.();
  }
}

/** Merge peer op logs for a shared causal graph view. */
export function mergeOps(...logs: VcsOp[][]): VcsOp[] {
  const seen = new Set<string>();
  const merged: VcsOp[] = [];
  for (const log of logs) {
    for (const op of log) {
      if (seen.has(op.hash)) continue;
      seen.add(op.hash);
      merged.push(op);
    }
  }
  return merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
