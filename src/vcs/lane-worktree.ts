/**
 * Per-lane git worktree provisioning (ADR 0014 Phase 2 / W5).
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

export function laneShortId(laneId: string): string {
  return laneId.replace(/^lane-/, '').slice(0, 8);
}

export function laneGitBranch(laneId: string): string {
  return `lane/${laneShortId(laneId)}`;
}

export function defaultWorktreePath(trellisDir: string, laneId: string): string {
  return join(trellisDir, 'worktrees', laneShortId(laneId));
}

export function isGitRepo(rootPath: string): boolean {
  return existsSync(join(rootPath, '.git'));
}

function git(rootPath: string, command: string): string {
  return execSync(`git -C "${rootPath}" ${command}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export function resolveBaseRef(rootPath: string, baseBranch: string): string {
  try {
    return git(rootPath, `rev-parse ${baseBranch}`);
  } catch {
    return git(rootPath, 'rev-parse HEAD');
  }
}

function isRegisteredWorktree(rootPath: string, worktreePath: string): boolean {
  try {
    const list = git(rootPath, 'worktree list --porcelain');
    return list.split('\n').some((line) => line === `worktree ${worktreePath}`);
  } catch {
    return false;
  }
}

export function provisionWorktree(opts: {
  rootPath: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
}): void {
  if (
    existsSync(opts.worktreePath) &&
    isRegisteredWorktree(opts.rootPath, opts.worktreePath)
  ) {
    return;
  }

  mkdirSync(dirname(opts.worktreePath), { recursive: true });

  const branchExists = (() => {
    try {
      git(opts.rootPath, `rev-parse --verify ${opts.branch}`);
      return true;
    } catch {
      return false;
    }
  })();

  if (branchExists) {
    git(
      opts.rootPath,
      `worktree add "${opts.worktreePath}" ${opts.branch}`,
    );
  } else {
    git(
      opts.rootPath,
      `worktree add -b ${opts.branch} "${opts.worktreePath}" ${opts.baseRef}`,
    );
  }
}

export function removeWorktree(opts: {
  rootPath: string;
  worktreePath: string;
  branch?: string;
  deleteBranch?: boolean;
}): void {
  if (existsSync(opts.worktreePath)) {
    try {
      git(opts.rootPath, `worktree remove --force "${opts.worktreePath}"`);
    } catch {
      // best-effort cleanup
    }
  }

  if (opts.deleteBranch && opts.branch) {
    try {
      git(opts.rootPath, `branch -D ${opts.branch}`);
    } catch {
      // branch may already be merged or absent
    }
  }
}
