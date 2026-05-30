import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { TrellisVcsEngine } from '../../src/engine.js';
import { mkdirSync, rmSync, existsSync } from 'fs';

const TEST_ROOT = '/tmp/trellis-p2-branch-test';

describe('Branch Management', () => {
  let engine: TrellisVcsEngine;

  beforeEach(async () => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_ROOT, { recursive: true });

    engine = new TrellisVcsEngine({ rootPath: TEST_ROOT });
    await engine.initRepo();
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('initRepo creates the default branch', () => {
    const branches = engine.listBranches();
    expect(branches).toHaveLength(1);
    expect(branches[0].name).toBe('main');
    expect(branches[0].isCurrent).toBe(true);
  });

  test('getCurrentBranch returns main after init', () => {
    expect(engine.getCurrentBranch()).toBe('main');
  });

  test('createBranch creates a new branch', async () => {
    await engine.createBranch('feature-x');
    const branches = engine.listBranches();
    expect(branches).toHaveLength(2);
    const feature = branches.find((b) => b.name === 'feature-x');
    expect(feature).toBeDefined();
    expect(feature!.isCurrent).toBe(false);
  });

  test('createBranch records baseBranch in the op', async () => {
    const op = await engine.createBranch('hotfix');
    expect(op.vcs?.baseBranch).toBe('main');
  });

  test('createBranch throws for duplicate names', async () => {
    await engine.createBranch('dup');
    expect(engine.createBranch('dup')).rejects.toThrow("already exists");
  });

  test('switchBranch changes the current branch', async () => {
    await engine.createBranch('dev');
    engine.switchBranch('dev');
    expect(engine.getCurrentBranch()).toBe('dev');

    const branches = engine.listBranches();
    expect(branches.find((b) => b.name === 'dev')!.isCurrent).toBe(true);
    expect(branches.find((b) => b.name === 'main')!.isCurrent).toBe(false);
  });

  test('switchBranch throws for nonexistent branch', () => {
    expect(() => engine.switchBranch('nope')).toThrow("does not exist");
  });

  test('deleteBranch removes a branch', async () => {
    await engine.createBranch('temp');
    expect(engine.listBranches()).toHaveLength(2);

    await engine.deleteBranch('temp');
    expect(engine.listBranches()).toHaveLength(1);
    expect(engine.listBranches()[0].name).toBe('main');
  });

  test('deleteBranch throws for current branch', async () => {
    expect(engine.deleteBranch('main')).rejects.toThrow("Cannot delete the current branch");
  });

  test('deleteBranch throws for nonexistent branch', async () => {
    expect(engine.deleteBranch('ghost')).rejects.toThrow("does not exist");
  });

  test('branch state persists across open()', async () => {
    await engine.createBranch('persist-test');
    engine.switchBranch('persist-test');

    // Re-open the engine
    const engine2 = new TrellisVcsEngine({ rootPath: TEST_ROOT });
    engine2.open();

    expect(engine2.getCurrentBranch()).toBe('persist-test');
    expect(engine2.listBranches()).toHaveLength(2);
  });

  test('status() reflects current branch', async () => {
    await engine.createBranch('status-branch');
    engine.switchBranch('status-branch');
    expect(engine.status().branch).toBe('status-branch');
  });

  test('branchAdvance keeps main headOpHash at last content op', async () => {
    const milestone = await engine.createMilestone('seed integration head');
    expect(engine.getBranchHeadOpHash('main')).toBe(milestone.hash);
  });

  test('branchCreate does not advance current branch head', async () => {
    const headBefore = engine.getBranchHeadOpHash('main');
    await engine.createBranch('no-advance-test');
    expect(engine.getBranchHeadOpHash('main')).toBe(headBefore);
  });

  test('createMilestone advances current branch head to milestone op', async () => {
    const headBefore = engine.getBranchHeadOpHash('main');
    const milestone = await engine.createMilestone('checkpoint narrative');
    expect(engine.getBranchHeadOpHash('main')).toBe(milestone.hash);
    expect(milestone.hash).not.toBe(headBefore);
  });

  test('branch head survives open() replay', async () => {
    const headBefore = engine.getBranchHeadOpHash('main');

    const engine2 = new TrellisVcsEngine({ rootPath: TEST_ROOT });
    engine2.open();

    expect(engine2.getBranchHeadOpHash('main')).toBe(headBefore);
  });
});
