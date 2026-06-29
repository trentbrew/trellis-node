import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TrellisVcsEngine } from '../../src/engine.js';
import {
  formatWhereami,
  findWaitingOnYou,
  writeCheckpoint,
  getActiveContext,
} from '../../src/protocol/whereami.js';
import { formatIssueDescription } from '../../src/protocol/envelope.js';

const TEST_ROOT = '/tmp/trellis-protocol-whereami';
const TEST_ROOT_GIT = '/tmp/trellis-protocol-whereami-git';

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

describe('whereami', () => {
  let engine: TrellisVcsEngine;

  beforeEach(async () => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_ROOT, { recursive: true });
    engine = new TrellisVcsEngine({ rootPath: TEST_ROOT });
    await engine.initRepo({ indexWorkspace: false });
    engine.setCheckpointThreshold(0);
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('findWaitingOnYou includes open label:decision children', async () => {
    const parent = await engine.createIssue('Parent', { status: 'queue' });
    const parentId = parent.vcs!.issueId!;

    const decisionEnv = {
      from: 'executor' as const,
      to: 'human' as const,
      re: 'TRL-99',
      status: 'DECISION' as const,
      body: 'Ship or stack next wedge?',
    };

    await engine.createIssue('msg: DECISION TRL-99', {
      parentId,
      labels: ['decision'],
      description: formatIssueDescription(decisionEnv, 'route'),
      status: 'queue',
    });

    const waiting = findWaitingOnYou(engine);
    expect(waiting.length).toBe(1);
    expect(waiting[0].envelope.status).toBe('DECISION');
  });

  test('formatWhereami prints WAITING ON YOU and ACTIVE sections', async () => {
    await engine.createIssue('Active task', { status: 'in_progress' });

    const out = formatWhereami({ engine, rootPath: TEST_ROOT });
    expect(out).toContain('## WAITING ON YOU');
    expect(out).toContain('## ACTIVE');
    expect(out).toContain('## MOVED SINCE LAST');
    expect(out).toContain('Edit root:');
  });

  test('getActiveContext uses worktreePath when lane has one', async () => {
    rmSync(TEST_ROOT_GIT, { recursive: true, force: true });
    initGitRepo(TEST_ROOT_GIT);
    const gitEngine = new TrellisVcsEngine({
      rootPath: TEST_ROOT_GIT,
      lanes: { worktreeBind: true },
    });
    await gitEngine.initRepo({ indexWorkspace: false });
    gitEngine.setCheckpointThreshold(0);

    const lane = await gitEngine.createLane();
    const meta = gitEngine.getLaneMeta(lane.id)!;
    expect(meta.worktreePath).toBeTruthy();

    await gitEngine.enterLane(lane.id);
    const ctx = getActiveContext(gitEngine, TEST_ROOT_GIT);
    expect(ctx.editRoot).toBe(meta.worktreePath);
    expect(ctx.worktreePath).toBe(meta.worktreePath);

    const out = formatWhereami({ engine: gitEngine, rootPath: TEST_ROOT_GIT });
    expect(out).toContain(`Worktree: ${meta.worktreePath}`);

    await gitEngine.leaveLane();
    rmSync(TEST_ROOT_GIT, { recursive: true, force: true });
  });

  test('checkpoint enables MOVED SINCE LAST section', async () => {
    writeCheckpoint(TEST_ROOT, [], []);

    await engine.createIssue('msg: HANDOFF TRL-1', {
      labels: ['message'],
      description: formatIssueDescription({
        from: 'architect',
        to: 'executor',
        re: 'TRL-1',
        status: 'HANDOFF',
      }),
      status: 'queue',
    });

    const out = formatWhereami({ engine, rootPath: TEST_ROOT });
    expect(out).toContain('MOVED SINCE LAST');
    expect(out).not.toContain('no checkpoint');
  });
});
