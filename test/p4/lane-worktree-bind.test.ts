import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TrellisVcsEngine } from '../../src/engine.js';
import { BlobStore } from '../../src/vcs/blob-store.js';
import { laneDir, loadLaneMeta, updateLaneHead } from '../../src/vcs/lane.js';
import { LaneOpLog } from '../../src/vcs/op-log.js';
import { createVcsOp } from '../../src/vcs/ops.js';

const TEST_ROOT = '/tmp/trellis-p4-lane-worktree-bind';

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

async function appendLaneFileOp(
  rootPath: string,
  laneId: string,
  filePath: string,
  content: string,
): Promise<void> {
  const trellisDir = join(rootPath, '.trellis');
  const blob = new BlobStore(trellisDir);
  const hash = blob.putSync(Buffer.from(content, 'utf-8'));
  const meta = loadLaneMeta(trellisDir, laneId)!;
  const laneLog = new LaneOpLog(laneDir(trellisDir, laneId));
  laneLog.load();
  const op = await createVcsOp('vcs:fileModify', {
    agentId: 'agent:test',
    previousHash: laneLog.getLastOp()?.hash ?? meta.baseOpHash,
    vcs: { filePath, contentHash: hash, laneId },
  });
  laneLog.append(op);
  updateLaneHead(trellisDir, laneId, op.hash);
}

describe('Lane worktree bind (W5-MVP)', () => {
  let engine: TrellisVcsEngine;

  beforeEach(async () => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    initGitRepo(TEST_ROOT);
    engine = new TrellisVcsEngine({
      rootPath: TEST_ROOT,
      lanes: { worktreeBind: true },
    });
    await engine.initRepo({ indexWorkspace: false });
    engine.setCheckpointThreshold(0);
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('createLane provisions worktree when bind enabled', async () => {
    const lane = await engine.createLane();
    const meta = loadLaneMeta(join(TEST_ROOT, '.trellis'), lane.id)!;

    expect(meta.worktreePath).toBeTruthy();
    expect(existsSync(meta.worktreePath!)).toBe(true);
    expect(git(TEST_ROOT, 'worktree list')).toContain(meta.worktreePath!);
  });

  test('enterLane materializes lane file ops to worktree', async () => {
    const lane = await engine.createLane();
    await appendLaneFileOp(TEST_ROOT, lane.id, 'src/lane.txt', 'lane content');

    const meta = loadLaneMeta(join(TEST_ROOT, '.trellis'), lane.id)!;
    await engine.enterLane(lane.id);

    const diskPath = join(meta.worktreePath!, 'src/lane.txt');
    expect(readFileSync(diskPath, 'utf-8')).toBe('lane content');
    await engine.leaveLane();
  });

  test('two lanes isolate file content on disk', async () => {
    const laneA = await engine.createLane();
    const laneB = await engine.createLane();

    await appendLaneFileOp(TEST_ROOT, laneA.id, 'shared.txt', 'content A');
    await appendLaneFileOp(TEST_ROOT, laneB.id, 'shared.txt', 'content B');

    const metaA = loadLaneMeta(join(TEST_ROOT, '.trellis'), laneA.id)!;
    const metaB = loadLaneMeta(join(TEST_ROOT, '.trellis'), laneB.id)!;

    await engine.enterLane(laneA.id);
    expect(readFileSync(join(metaA.worktreePath!, 'shared.txt'), 'utf-8')).toBe(
      'content A',
    );
    await engine.leaveLane();

    await engine.enterLane(laneB.id);
    expect(readFileSync(join(metaB.worktreePath!, 'shared.txt'), 'utf-8')).toBe(
      'content B',
    );
    await engine.leaveLane();
  });

  test('dropLane removes worktree', async () => {
    const lane = await engine.createLane();
    const meta = loadLaneMeta(join(TEST_ROOT, '.trellis'), lane.id)!;
    const path = meta.worktreePath!;

    await engine.dropLane(lane.id);
    expect(existsSync(path)).toBe(false);
    expect(git(TEST_ROOT, 'worktree list')).not.toContain(path);
  });
});

describe('Lane routing without worktree bind', () => {
  let engine: TrellisVcsEngine;

  beforeEach(async () => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_ROOT, { recursive: true });
    engine = new TrellisVcsEngine({ rootPath: TEST_ROOT });
    await engine.initRepo();
    engine.setCheckpointThreshold(0);
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('createLane does not set worktreePath by default', async () => {
    const lane = await engine.createLane();
    const meta = loadLaneMeta(join(TEST_ROOT, '.trellis'), lane.id)!;
    expect(meta.worktreePath).toBeUndefined();
  });
});
