/**
 * Issue Module
 *
 * Extracted per DESIGN.md pattern (like milestone.ts, branch.ts).
 * Handles issue creation, lifecycle (start/pause/resume/close/reopen),
 * acceptance criteria, and queries.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
} from 'fs';
import { join, dirname } from 'path';
import { createVcsOp } from './ops.js';
import type { VcsOp } from './types.js';
import { issueEntityId, criterionEntityId } from './types.js';
import type { EngineContext } from './engine-context.js';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueInfo {
  /**
   * Canonical, collision-resistant identifier.
   * Legacy unlaned issues use `TRL-N`; lane-scoped use `issue:<laneId>:<seq>`.
   * Always present; safe to use as a map key, link target, and nack ref.
   */
  id: string;
  /**
   * Optional human-readable name.
   * For legacy `TRL-N` ids this mirrors `id`. For lane-scoped ids it is
   * undefined until a promotion step assigns one. UI may fall back to `id`.
   */
  displayId?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  labels: string[];
  assignee?: string;
  createdAt?: string;
  createdBy?: string;
  startedAt?: string;
  pausedAt?: string;
  pauseNote?: string;
  closedAt?: string;
  parentId?: string;
  branchName?: string;
  blockedBy: string[];
  blocking: string[];
  isBlocked: boolean;
  criteria: CriterionInfo[];
}

export interface CriterionInfo {
  id: string;
  description?: string;
  command?: string;
  status?: string;
  lastRunAt?: string;
  lastOutput?: string;
}

export interface CriterionResult {
  id: string;
  description?: string;
  command?: string;
  status: 'passed' | 'failed' | 'skipped';
  output?: string;
  exitCode?: number;
}

export interface IssueFilters {
  status?: string;
  assignee?: string;
  label?: string;
  parentId?: string;
  blocked?: boolean;
}

export interface IssueCreateOptions {
  priority?: 'critical' | 'high' | 'medium' | 'low';
  labels?: string[];
  assignee?: string;
  parentId?: string;
  description?: string;
  status?: 'backlog' | 'queue';
  criteria?: Array<{ description: string; command?: string }>;
  /**
   * Creates a collision-resistant canonical ID scoped to this lane, e.g.
   * `issue:lane-a:1`. Omit to keep the legacy repo-wide `TRL-N` allocator.
   */
  laneId?: string;
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function getIssueCounterPath(rootPath: string): string {
  return join(rootPath, '.trellis', 'issue-counter.json');
}

function getLaneIssueCounterPath(rootPath: string, laneId: string): string {
  return join(
    rootPath,
    '.trellis',
    'issue-counters',
    `${encodeURIComponent(laneId)}.json`,
  );
}

function nextIssueId(rootPath: string, laneId?: string): string {
  const laneScope = laneId?.trim();
  const counterPath = getIssueCounterPath(rootPath);
  const scopedCounterPath = laneScope
    ? getLaneIssueCounterPath(rootPath, laneScope)
    : counterPath;
  const dir = dirname(scopedCounterPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const lockPath = `${scopedCounterPath}.lock`;
  const deadline = Date.now() + 5000;
  let lockFd: number | undefined;

  while (Date.now() < deadline) {
    try {
      lockFd = openSync(lockPath, 'wx');
      break;
    } catch (err: any) {
      if (err?.code !== 'EEXIST') {
        throw err;
      }
    }
  }

  if (lockFd === undefined) {
    throw new Error(
      `Timed out waiting for issue counter lock: ${lockPath}. Another Trellis process may be stalled.`,
    );
  }

  try {
    let counter = 0;
    if (existsSync(scopedCounterPath)) {
      try {
        counter =
          JSON.parse(readFileSync(scopedCounterPath, 'utf-8')).counter ?? 0;
      } catch {}
    }
    counter++;
    writeFileSync(scopedCounterPath, JSON.stringify({ counter }, null, 2));
    if (laneScope) return `issue:${laneScope}:${counter}`;
    return `TRL-${counter}`;
  } finally {
    closeSync(lockFd);
    try {
      unlinkSync(lockPath);
    } catch {}
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getIssueFact(
  ctx: EngineContext,
  entityId: string,
  attr: string,
): string | undefined {
  const facts = ctx.store.getFactsByEntity(entityId);
  // Return the LAST matching fact — EAV store appends, so latest is authoritative
  const matches = facts.filter((f) => f.a === attr);
  return matches.length > 0
    ? (matches[matches.length - 1].v as string)
    : undefined;
}

function getIssueLinks(
  ctx: EngineContext,
  entityId: string,
  attr: string,
): string[] {
  const links = ctx.store.getLinksByEntity(entityId);
  // Only forward links (e1 === entityId), not reverse
  return links
    .filter((l) => l.a === attr && l.e1 === entityId)
    .map((l) => l.e2);
}

function issueInfoIdFromEntityId(entityId: string): string {
  const bare = entityId.replace(/^issue:/, '');
  return bare.includes(':') ? entityId : bare;
}

function getCriteriaForIssue(
  ctx: EngineContext,
  issueId: string,
): CriterionInfo[] {
  const eid = issueEntityId(issueId);
  // Find all criterion entities linked to this issue
  const criterionLinks = ctx.store
    .getLinksByAttribute('criterionOf')
    .filter((l) => l.e2 === eid);

  return criterionLinks.map((link) => {
    const ceid = link.e1;
    const facts = ctx.store.getFactsByEntity(ceid);
    const getLast = (a: string) => {
      const matches = facts.filter((f) => f.a === a);
      return matches.length > 0
        ? (matches[matches.length - 1].v as string)
        : undefined;
    };
    return {
      id: ceid,
      description: getLast('description'),
      command: getLast('command'),
      status: getLast('status'),
      lastRunAt: getLast('lastRunAt'),
      lastOutput: getLast('lastOutput'),
    };
  });
}

function buildIssueInfo(ctx: EngineContext, entityId: string): IssueInfo {
  const facts = ctx.store.getFactsByEntity(entityId);
  // Use last matching fact for each attribute (latest is authoritative)
  const get = (a: string) => {
    const matches = facts.filter((f) => f.a === a);
    return matches.length > 0
      ? (matches[matches.length - 1].v as string)
      : undefined;
  };

  const labelsStr = get('labels');
  const labels = labelsStr ? labelsStr.split(',').filter(Boolean) : [];

  const trackedOnLinks = getIssueLinks(ctx, entityId, 'trackedOn');
  const branchName =
    trackedOnLinks.length > 0
      ? trackedOnLinks[0].replace(/^branch:/, '')
      : undefined;

  const childOfLinks = getIssueLinks(ctx, entityId, 'childOf');
  const parentId =
    childOfLinks.length > 0
      ? issueInfoIdFromEntityId(childOfLinks[0])
      : undefined;

  const issueId = issueInfoIdFromEntityId(entityId);

  // Blocking: forward blockedBy links (this issue is blocked by...)
  const blockedByLinks = getIssueLinks(ctx, entityId, 'blockedBy');
  const blockedBy = blockedByLinks.map(issueInfoIdFromEntityId);

  // Blocking: reverse blockedBy links (this issue blocks...)
  const allBlockedByLinks = ctx.store.getLinksByAttribute('blockedBy');
  const blocking = allBlockedByLinks
    .filter((l) => l.e2 === entityId)
    .map((l) => issueInfoIdFromEntityId(l.e1));

  // Derived: isBlocked if any blocker is not closed
  const isBlocked = blockedByLinks.some((blockerEid) => {
    const blockerStatus = getIssueFact(ctx, blockerEid, 'status');
    return blockerStatus !== 'closed';
  });

  return {
    id: issueId,
    displayId: defaultDisplayId(issueId),
    title: get('title'),
    description: get('description'),
    status: get('status'),
    priority: get('priority'),
    labels,
    assignee: get('assignee'),
    createdAt: get('createdAt'),
    createdBy: get('createdBy'),
    startedAt: get('startedAt'),
    pausedAt: get('pausedAt'),
    pauseNote: get('pauseNote') || undefined,
    closedAt: get('closedAt'),
    parentId,
    branchName,
    blockedBy,
    blocking,
    isBlocked,
    criteria: getCriteriaForIssue(ctx, issueId),
  };
}

/**
 * Default display alias for a canonical issue id.
 * Legacy `TRL-N` ids are already human-readable; lane-scoped canonical ids
 * have no alias until a promotion step assigns one.
 */
function defaultDisplayId(id: string): string | undefined {
  return /^TRL-\d+$/.test(id) ? id : undefined;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Create a new issue.
 */
export async function createIssue(
  ctx: EngineContext,
  rootPath: string,
  title: string,
  opts?: IssueCreateOptions,
): Promise<VcsOp> {
  const id = nextIssueId(rootPath, opts?.laneId);

  const op = await createVcsOp('vcs:issueCreate', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: {
      issueId: id,
      issueTitle: title,
      issueDescription: opts?.description,
      issueStatus: opts?.status ?? 'backlog',
      issuePriority: opts?.priority ?? 'medium',
      issueLabels: opts?.labels,
      issueAssignee: opts?.assignee,
      parentIssueId: opts?.parentId,
    },
  });
  await ctx.applyOp(op);

  // Add acceptance criteria if provided
  if (opts?.criteria) {
    for (let i = 0; i < opts.criteria.length; i++) {
      await addCriterion(
        ctx,
        id,
        opts.criteria[i].description,
        opts.criteria[i].command,
      );
    }
  }

  return op;
}

/**
 * Update an issue's metadata.
 */
export async function updateIssue(
  ctx: EngineContext,
  id: string,
  updates: {
    title?: string;
    description?: string;
    priority?: 'critical' | 'high' | 'medium' | 'low';
    labels?: string[];
    assignee?: string;
    status?: 'backlog' | 'queue' | 'in_progress' | 'paused' | 'closed';
    /** Set parent issue id, or `null` to remove an existing parent link. */
    parentId?: string | null;
  },
): Promise<VcsOp> {
  const issue = getIssue(ctx, id);
  if (!issue) {
    throw new Error(`Issue ${id} not found.`);
  }

  const vcs: NonNullable<VcsOp['vcs']> = { issueId: id };

  if (updates.title !== undefined) vcs.issueTitle = updates.title;
  if (updates.description !== undefined) vcs.issueDescription = updates.description;
  if (updates.status !== undefined) {
    vcs.oldIssueStatus = getIssueFact(ctx, issueEntityId(id), 'status') as any;
    vcs.issueStatus = updates.status;
  }
  if (updates.priority !== undefined) vcs.issuePriority = updates.priority;
  if (updates.labels !== undefined) vcs.issueLabels = updates.labels;
  if (updates.assignee !== undefined) vcs.issueAssignee = updates.assignee;

  if (updates.parentId !== undefined) {
    const newParent = updates.parentId;
    if (newParent === id) {
      throw new Error(`Issue ${id} cannot be its own parent.`);
    }
    if (newParent) {
      const parent = getIssue(ctx, newParent);
      if (!parent) {
        throw new Error(`Parent issue ${newParent} not found.`);
      }
    }
    const currentParent = issue.parentId;
    if (newParent !== currentParent) {
      if (currentParent) vcs.oldParentIssueId = currentParent;
      if (newParent) vcs.parentIssueId = newParent;
    }
  }

  const op = await createVcsOp('vcs:issueUpdate', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs,
  });
  await ctx.applyOp(op);
  return op;
}

/**
 * Start working on an issue: sets in_progress, auto-assigns, creates branch.
 * Returns the issueStart op. The caller (engine) is responsible for
 * actually creating the branch and switching to it.
 */
export async function startIssue(
  ctx: EngineContext,
  id: string,
  branchName: string,
): Promise<VcsOp> {
  const eid = issueEntityId(id);
  const status = getIssueFact(ctx, eid, 'status');
  if (status === 'closed') {
    throw new Error(`Cannot start closed issue ${id}. Reopen it first.`);
  }
  if (status === 'in_progress') {
    throw new Error(`Issue ${id} is already in progress.`);
  }
  // Allow start from backlog, queue, or paused

  const op = await createVcsOp('vcs:issueStart', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: {
      issueId: id,
      oldIssueStatus: status as any,
      issueAssignee: ctx.agentId,
      branchName,
    },
  });
  await ctx.applyOp(op);
  return op;
}

/**
 * Pause an in-progress issue.
 */
export async function pauseIssue(
  ctx: EngineContext,
  id: string,
  note: string,
): Promise<VcsOp> {
  if (!note || !note.trim()) {
    throw new Error(
      `A pause note is required. Explain why the issue is paused and what must happen before resuming.`,
    );
  }

  const eid = issueEntityId(id);
  const status = getIssueFact(ctx, eid, 'status');
  if (status !== 'in_progress') {
    throw new Error(
      `Cannot pause issue ${id} — status is '${status}', expected 'in_progress'.`,
    );
  }

  const op = await createVcsOp('vcs:issuePause', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { 
      issueId: id, 
      oldIssueStatus: status as any,
      pauseNote: note.trim() 
    },
  });
  await ctx.applyOp(op);
  return op;
}

/**
 * Resume a paused issue.
 */
export async function resumeIssue(
  ctx: EngineContext,
  id: string,
): Promise<VcsOp> {
  const eid = issueEntityId(id);
  const status = getIssueFact(ctx, eid, 'status');
  if (status !== 'paused') {
    throw new Error(
      `Cannot resume issue ${id} — status is '${status}', expected 'paused'.`,
    );
  }

  const op = await createVcsOp('vcs:issueResume', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { issueId: id, oldIssueStatus: status as any },
  });
  await ctx.applyOp(op);
  return op;
}

/**
 * Close an issue. Requires all criteria to have passed and confirm=true.
 */
export async function closeIssue(
  ctx: EngineContext,
  id: string,
  opts?: { confirm?: boolean },
): Promise<{ op?: VcsOp; criteriaResults: CriterionResult[] }> {
  const eid = issueEntityId(id);
  const status = getIssueFact(ctx, eid, 'status');
  if (status === 'closed') {
    throw new Error(`Issue ${id} is already closed.`);
  }

  // Check criteria status in the store
  const criteria = getCriteriaForIssue(ctx, id);
  const results: CriterionResult[] = criteria.map((c) => ({
    id: c.id,
    description: c.description,
    command: c.command,
    status: (c.status as 'passed' | 'failed') ?? ('pending' as any),
  }));

  const allPassed =
    results.length === 0 || results.every((r) => r.status === 'passed');

  if (!allPassed) {
    const failing = results.filter((r) => r.status !== 'passed');
    throw new Error(
      `Cannot close issue ${id}: ${failing.length} criteria not passing:\n` +
        failing
          .map((f) => `  - ${f.description ?? f.id} (${f.status})`)
          .join('\n'),
    );
  }

  if (!opts?.confirm) {
    return { criteriaResults: results };
  }

  // Compute duration from startedAt
  const startedAt = getIssueFact(ctx, eid, 'startedAt');

  const op = await createVcsOp('vcs:issueClose', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { issueId: id, oldIssueStatus: status as any },
  });
  await ctx.applyOp(op);

  // Store duration as a fact if we have startedAt
  if (startedAt) {
    const durationMs = Date.now() - new Date(startedAt).getTime();
    ctx.store.addFacts([{ e: eid, a: 'durationMs', v: durationMs }]);
  }

  return { op, criteriaResults: results };
}

/**
 * Triage a backlog issue to queue (ready to start).
 */
export async function triageIssue(
  ctx: EngineContext,
  id: string,
): Promise<VcsOp> {
  const eid = issueEntityId(id);
  const status = getIssueFact(ctx, eid, 'status');
  if (status !== 'backlog') {
    throw new Error(
      `Cannot triage issue ${id} — status is '${status}', expected 'backlog'.`,
    );
  }

  const op = await createVcsOp('vcs:issueUpdate', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: {
      issueId: id,
      oldIssueStatus: status as any,
      issueStatus: 'queue',
    },
  });
  await ctx.applyOp(op);
  return op;
}

/**
 * Reopen a closed issue.
 */
export async function reopenIssue(
  ctx: EngineContext,
  id: string,
): Promise<VcsOp> {
  const eid = issueEntityId(id);
  const status = getIssueFact(ctx, eid, 'status');
  if (status !== 'closed') {
    throw new Error(
      `Cannot reopen issue ${id} — status is '${status}', expected 'closed'.`,
    );
  }

  const op = await createVcsOp('vcs:issueReopen', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { issueId: id, oldIssueStatus: status as any },
  });
  await ctx.applyOp(op);
  return op;
}

/**
 * Assign an issue to an agent.
 */
export async function assignIssue(
  ctx: EngineContext,
  id: string,
  agentId: string,
): Promise<VcsOp> {
  return updateIssue(ctx, id, { assignee: agentId });
}

/**
 * Block an issue by another issue.
 */
export async function blockIssue(
  ctx: EngineContext,
  id: string,
  blockedById: string,
): Promise<VcsOp> {
  const eid = issueEntityId(id);
  const blockerEid = issueEntityId(blockedById);

  // Validate both issues exist
  if (!getIssueFact(ctx, eid, 'type')) {
    throw new Error(`Issue ${id} not found.`);
  }
  if (!getIssueFact(ctx, blockerEid, 'type')) {
    throw new Error(`Blocking issue ${blockedById} not found.`);
  }
  if (id === blockedById) {
    throw new Error(`Issue cannot block itself.`);
  }

  const op = await createVcsOp('vcs:issueBlock', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { issueId: id, blockedByIssueId: blockedById },
  });
  await ctx.applyOp(op);
  return op;
}

/**
 * Remove a blocking relationship.
 */
export async function unblockIssue(
  ctx: EngineContext,
  id: string,
  blockedById: string,
): Promise<VcsOp> {
  const op = await createVcsOp('vcs:issueUnblock', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { issueId: id, blockedByIssueId: blockedById },
  });
  await ctx.applyOp(op);
  return op;
}

/**
 * Add an acceptance criterion to an issue.
 */
export async function addCriterion(
  ctx: EngineContext,
  issueId: string,
  description: string,
  command?: string,
): Promise<VcsOp> {
  // Count existing criteria to determine index
  const existing = getCriteriaForIssue(ctx, issueId);
  const index = existing.length + 1;
  const cid = criterionEntityId(issueId, index);

  const op = await createVcsOp('vcs:criterionAdd', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: {
      issueId,
      criterionId: cid,
      criterionDescription: description,
      criterionCommand: command,
    },
  });
  await ctx.applyOp(op);
  return op;
}

/**
 * Manually set a criterion's status (for non-command criteria).
 */
export async function setCriterionStatus(
  ctx: EngineContext,
  issueId: string,
  criterionIndex: number,
  status: 'passed' | 'failed' | 'pending',
): Promise<VcsOp> {
  const criteria = getCriteriaForIssue(ctx, issueId);
  if (criterionIndex < 1 || criterionIndex > criteria.length) {
    throw new Error(
      `Criterion index ${criterionIndex} out of range (1–${criteria.length})`,
    );
  }
  const c = criteria[criterionIndex - 1];

  const op = await createVcsOp('vcs:criterionUpdate', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: {
      issueId,
      criterionId: c.id,
      criterionStatus: status,
    },
  });
  await ctx.applyOp(op);
  return op;
}

/**
 * Run all acceptance criteria for an issue. Executes test commands
 * and emits criterionUpdate ops with results.
 */
export async function runCriteria(
  ctx: EngineContext,
  issueId: string,
  rootPath: string,
): Promise<CriterionResult[]> {
  const criteria = getCriteriaForIssue(ctx, issueId);
  const results: CriterionResult[] = [];

  for (const c of criteria) {
    if (!c.command) {
      // No command — check-only criterion, skip automated run
      results.push({
        id: c.id,
        description: c.description,
        status: (c.status as 'passed' | 'failed') ?? 'skipped',
      });
      continue;
    }

    let status: 'passed' | 'failed' = 'failed';
    let output = '';
    let exitCode = 1;

    try {
      const result = await execAsync(c.command, {
        cwd: rootPath,
        timeout: 120_000,
      });
      output = (result.stdout + '\n' + result.stderr).trim();
      exitCode = 0;
      status = 'passed';
    } catch (err: any) {
      output = (err.stdout ?? '') + '\n' + (err.stderr ?? err.message ?? '');
      output = output.trim();
      exitCode = err.code ?? 1;
      status = 'failed';
    }

    // Emit criterionUpdate op
    const updateOp = await createVcsOp('vcs:criterionUpdate', {
      agentId: ctx.agentId,
      previousHash: ctx.getLastOp()?.hash,
      vcs: {
        criterionId: c.id,
        criterionStatus: status,
        criterionOutput: output.slice(0, 4096),
      },
    });
    await ctx.applyOp(updateOp);

    results.push({
      id: c.id,
      description: c.description,
      command: c.command,
      status,
      output,
      exitCode,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List all issues, optionally filtered.
 */
export function listIssues(
  ctx: EngineContext,
  filters?: IssueFilters,
): IssueInfo[] {
  const issueFacts = ctx.store
    .getFactsByAttribute('type')
    .filter((f) => f.v === 'Issue');

  let issues = issueFacts.map((f) => buildIssueInfo(ctx, f.e));

  if (filters?.status) {
    issues = issues.filter((i) => i.status === filters.status);
  }
  if (filters?.assignee) {
    issues = issues.filter((i) => i.assignee === filters.assignee);
  }
  if (filters?.label) {
    issues = issues.filter((i) => i.labels.includes(filters.label!));
  }
  if (filters?.parentId) {
    issues = issues.filter((i) => i.parentId === filters.parentId);
  }
  if (filters?.blocked !== undefined) {
    issues = issues.filter((i) => i.isBlocked === filters.blocked);
  }

  return issues;
}

/**
 * Get a single issue by ID.
 */
export function getIssue(ctx: EngineContext, id: string): IssueInfo | null {
  const eid = issueEntityId(id);
  const typeFact = ctx.store
    .getFactsByEntity(eid)
    .find((f) => f.a === 'type' && f.v === 'Issue');
  if (!typeFact) return null;
  return buildIssueInfo(ctx, eid);
}

/**
 * Get all active (in_progress) issues.
 */
export function getActiveIssues(ctx: EngineContext): IssueInfo[] {
  return listIssues(ctx, { status: 'in_progress' });
}

// ---------------------------------------------------------------------------
// Completion Readiness
// ---------------------------------------------------------------------------

export interface CompletionReadiness {
  ready: boolean;
  queue: IssueInfo[];
  paused: IssueInfo[];
  inProgress: IssueInfo[];
  summary: string;
}

/**
 * Check whether all work is complete: no issues in queue, paused, or in_progress.
 */
export function checkCompletionReadiness(
  ctx: EngineContext,
): CompletionReadiness {
  const all = listIssues(ctx);
  const queue = all.filter((i) => i.status === 'queue');
  const paused = all.filter((i) => i.status === 'paused');
  const inProgress = all.filter((i) => i.status === 'in_progress');

  const ready =
    queue.length === 0 && paused.length === 0 && inProgress.length === 0;

  const parts: string[] = [];
  if (ready) {
    parts.push('✓ All clear — no queue, paused, or in-progress issues.');
  } else {
    parts.push('✗ Not ready for completion:');
    if (queue.length > 0) {
      parts.push(
        `  Queue (${queue.length}): ${queue.map((i) => i.id).join(', ')}`,
      );
    }
    if (inProgress.length > 0) {
      parts.push(
        `  In progress (${inProgress.length}): ${inProgress.map((i) => i.id).join(', ')}`,
      );
    }
    if (paused.length > 0) {
      parts.push(
        `  Paused (${paused.length}): ${paused.map((i) => `${i.id}${i.pauseNote ? ` — ${i.pauseNote}` : ''}`).join(', ')}`,
      );
    }
  }

  return { ready, queue, paused, inProgress, summary: parts.join('\n') };
}
