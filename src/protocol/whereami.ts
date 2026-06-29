/**
 * Re-entry orientation — WAITING ON YOU / MOVED / ACTIVE.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { TrellisVcsEngine } from '../engine.js';
import type { IssueInfo } from '../vcs/issue.js';
import {
  tryParseEnvelope,
  isWaitingOnHuman,
  type HandoffEnvelope,
} from './envelope.js';

export interface ReentryCheckpoint {
  at: string;
  issueIds: string[];
  openMessageIds: string[];
}

export interface WhereamiOptions {
  engine: TrellisVcsEngine;
  rootPath: string;
  debug?: boolean;
}

function trellisDir(rootPath: string): string {
  return join(rootPath, '.trellis');
}

function checkpointPath(rootPath: string): string {
  return join(trellisDir(rootPath), 'reentry-checkpoint.json');
}

export function loadCheckpoint(rootPath: string): ReentryCheckpoint | null {
  const path = checkpointPath(rootPath);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ReentryCheckpoint;
  } catch {
    return null;
  }
}

export function writeCheckpoint(
  rootPath: string,
  issueIds: string[],
  openMessageIds: string[],
): ReentryCheckpoint {
  const cp: ReentryCheckpoint = {
    at: new Date().toISOString(),
    issueIds,
    openMessageIds,
  };
  const dir = trellisDir(rootPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(checkpointPath(rootPath), JSON.stringify(cp, null, 2), 'utf-8');
  return cp;
}

function isOpenProtocolChild(issue: IssueInfo): boolean {
  if (issue.status === 'closed') return false;
  return issue.labels.includes('message') || issue.labels.includes('decision');
}

export function collectProtocolChildren(engine: TrellisVcsEngine): IssueInfo[] {
  return engine
    .listIssues()
    .filter(isOpenProtocolChild);
}

export function findWaitingOnYou(engine: TrellisVcsEngine): Array<{
  issue: IssueInfo;
  envelope: HandoffEnvelope;
}> {
  const waiting: Array<{ issue: IssueInfo; envelope: HandoffEnvelope }> = [];

  for (const issue of collectProtocolChildren(engine)) {
    const envelope = tryParseEnvelope(issue.description);
    if (!envelope) continue;

    if (issue.labels.includes('decision')) {
      waiting.push({ issue, envelope });
      continue;
    }

    if (isWaitingOnHuman(envelope)) {
      waiting.push({ issue, envelope });
    }
  }

  return waiting;
}

export function findMovedSinceCheckpoint(
  engine: TrellisVcsEngine,
  rootPath: string,
): IssueInfo[] {
  const cp = loadCheckpoint(rootPath);
  if (!cp) return [];

  const known = new Set([...cp.issueIds, ...cp.openMessageIds]);
  const moved: IssueInfo[] = [];

  for (const issue of engine.listIssues()) {
    if (known.has(issue.id)) continue;
    if (issue.labels.includes('message') || issue.labels.includes('decision')) {
      moved.push(issue);
    }
  }

  for (const issue of collectProtocolChildren(engine)) {
    if (cp.openMessageIds.includes(issue.id)) continue;
    if (
      issue.labels.includes('message') ||
      issue.labels.includes('decision')
    ) {
      if (!moved.some((m) => m.id === issue.id)) {
        moved.push(issue);
      }
    }
  }

  return moved;
}

export interface ActiveContext {
  issues: IssueInfo[];
  laneId?: string;
  worktreePath?: string;
  editRoot: string;
}

export function getActiveContext(
  engine: TrellisVcsEngine,
  rootPath: string,
): ActiveContext {
  const issues = engine.listIssues({ status: 'in_progress' });
  const laneId = engine.getActiveLaneId();
  let worktreePath: string | undefined;
  if (laneId) {
    worktreePath = engine.getLaneMeta(laneId)?.worktreePath;
  }
  const editRoot = worktreePath ?? rootPath;
  return { issues, laneId, worktreePath, editRoot };
}

export function formatWhereami(opts: WhereamiOptions): string {
  const { engine, rootPath } = opts;
  const lines: string[] = ['Trellis whereami', ''];

  lines.push('## WAITING ON YOU');
  const waiting = findWaitingOnYou(engine);
  if (waiting.length === 0) {
    lines.push('  (none)');
  } else {
    for (const { issue, envelope } of waiting) {
      lines.push(
        `  ${issue.id} · ${envelope.status} · to:${envelope.to} · re:${envelope.re}`,
      );
      if (envelope.body) {
        const preview = envelope.body.split('\n')[0].slice(0, 80);
        lines.push(`    ${preview}`);
      }
    }
  }

  lines.push('');
  lines.push('## ACTIVE');
  const active = getActiveContext(engine, rootPath);
  if (active.issues.length === 0) {
    lines.push('  (no in_progress issues)');
  } else {
    for (const issue of active.issues) {
      lines.push(`  ${issue.id} · ${issue.title ?? '(untitled)'}`);
    }
  }
  if (active.laneId) {
    lines.push(`  Lane: ${active.laneId}`);
  }
  if (active.worktreePath) {
    lines.push(`  Worktree: ${active.worktreePath}`);
  }
  lines.push(`  Edit root: ${active.editRoot}`);

  lines.push('');
  lines.push('## MOVED SINCE LAST');
  const cp = loadCheckpoint(rootPath);
  if (!cp) {
    lines.push('  (no checkpoint — run trellis whereami checkpoint)');
  } else {
    const moved = findMovedSinceCheckpoint(engine, rootPath);
    if (moved.length === 0) {
      lines.push(`  (none since ${cp.at})`);
    } else {
      for (const issue of moved) {
        lines.push(`  ${issue.id} · ${issue.title ?? '(untitled)'}`);
      }
    }
  }

  return lines.join('\n');
}
