import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  defaultWorktreePath,
  laneGitBranch,
  laneShortId,
  provisionWorktree,
  removeWorktree,
  resolveBaseRef,
} from '../../src/vcs/lane-worktree.js';

const TEST_ROOT = '/tmp/trellis-lane-worktree';

function git(root: string, cmd: string): string {
  return execSync(`git -C "${root}" ${cmd}`, { encoding: 'utf-8' }).trim();
}

function initGitRepo(root: string): void {
  mkdirSync(root, { recursive: true });
  git(root, 'init');
  git(root, 'config user.email "test@trellis.dev"');
  git(root, 'config user.name "Test"');
  writeFileSync(join(root, 'README.md'), '# test\n');
  git(root, 'add -A');
  git(root, 'commit -m "init"');
  git(root, 'branch -M main');
}

describe('lane-worktree helpers', () => {
  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('laneShortId and branch naming', () => {
    const laneId = 'lane-550e8400-e29b-41d4-a716-446655440000';
    expect(laneShortId(laneId)).toBe('550e8400');
    expect(laneGitBranch(laneId)).toBe('lane/550e8400');
    expect(defaultWorktreePath('/repo/.trellis', laneId)).toBe(
      '/repo/.trellis/worktrees/550e8400',
    );
  });

  test('provision and remove worktree in git repo', () => {
    initGitRepo(TEST_ROOT);
    const trellisDir = join(TEST_ROOT, '.trellis');
    mkdirSync(trellisDir, { recursive: true });
    const laneId = 'lane-550e8400-e29b-41d4-a716-446655440000';
    const worktreePath = defaultWorktreePath(trellisDir, laneId);
    const branch = laneGitBranch(laneId);
    const baseRef = resolveBaseRef(TEST_ROOT, 'main');

    provisionWorktree({
      rootPath: TEST_ROOT,
      worktreePath,
      branch,
      baseRef,
    });

    expect(git(TEST_ROOT, 'worktree list')).toContain(worktreePath);

    removeWorktree({
      rootPath: TEST_ROOT,
      worktreePath,
      branch,
      deleteBranch: true,
    });

    expect(git(TEST_ROOT, 'worktree list')).not.toContain(worktreePath);
  });
});
