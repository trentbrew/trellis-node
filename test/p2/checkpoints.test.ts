import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { TrellisVcsEngine } from '../../src/engine.js';
import { createVcsOp } from '../../src/vcs/ops.js';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const TEST_ROOT = '/tmp/trellis-p2-checkpoint-test';

describe('Checkpoints', () => {
  let engine: TrellisVcsEngine;

  beforeEach(async () => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_ROOT, { recursive: true });

    writeFileSync(join(TEST_ROOT, 'file.ts'), 'const x = 1;');

    engine = new TrellisVcsEngine({ rootPath: TEST_ROOT });
    await engine.initRepo();
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('createCheckpoint creates a checkpoint op', async () => {
    const op = await engine.createCheckpoint('manual');
    expect(op.kind).toBe('vcs:checkpointCreate');
    expect(op.vcs?.trigger).toBe('manual');
  });

  test('listCheckpoints returns created checkpoints', async () => {
    await engine.createCheckpoint('manual');
    await engine.createCheckpoint('manual');

    const checkpoints = engine.listCheckpoints();
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0].trigger).toBe('manual');
    expect(checkpoints[1].trigger).toBe('manual');
  });

  test('checkpoint has createdAt', async () => {
    await engine.createCheckpoint('manual');
    const checkpoints = engine.listCheckpoints();
    expect(checkpoints[0].createdAt).toBeTruthy();
  });

  test('checkpoint op chains causally', async () => {
    const ops = engine.getOps();
    const lastBefore = ops[ops.length - 1];

    const cpOp = await engine.createCheckpoint('manual');
    expect(cpOp.previousHash).toBe(lastBefore.hash);
  });

  test('checkpoints persist across open()', async () => {
    await engine.createCheckpoint('manual');

    const engine2 = new TrellisVcsEngine({ rootPath: TEST_ROOT });
    engine2.open();

    const checkpoints = engine2.listCheckpoints();
    expect(checkpoints).toHaveLength(1);
  });

  test('auto-checkpoint triggers after threshold ops', async () => {
    // Set low threshold
    engine.setCheckpointThreshold(3);

    // The init already created some ops, reset by creating a fresh engine
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_ROOT, { recursive: true });
    writeFileSync(join(TEST_ROOT, 'x.ts'), 'x');

    const freshEngine = new TrellisVcsEngine({ rootPath: TEST_ROOT });
    freshEngine.setCheckpointThreshold(5);
    await freshEngine.initRepo();

    // initRepo creates: 1 branch op + 1 file op = 2 ops
    // Auto-checkpoint should not have triggered yet (threshold=5)
    let cps = freshEngine.listCheckpoints();
    expect(cps).toHaveLength(0);

    // Add more files to exceed threshold
    // We need to create ops manually to trigger auto-checkpoint
    // Create 3 more milestones to hit 5 total ops
    await freshEngine.createMilestone('ms-1');
    await freshEngine.createMilestone('ms-2');
    await freshEngine.createMilestone('ms-3');

    // Now we should have 5 ops (2 from init + 3 milestones) and an auto-checkpoint
    cps = freshEngine.listCheckpoints();
    expect(cps.length).toBeGreaterThanOrEqual(1);
    expect(cps.some((c) => c.trigger === 'op-count')).toBe(true);
  });

  test('setCheckpointThreshold(0) disables auto-checkpoints', async () => {
    engine.setCheckpointThreshold(0);

    // Create several milestones — no auto-checkpoint should fire
    await engine.createMilestone('a');
    await engine.createMilestone('b');
    await engine.createMilestone('c');
    await engine.createMilestone('d');
    await engine.createMilestone('e');

    const cps = engine.listCheckpoints();
    expect(cps).toHaveLength(0);
  });
});
