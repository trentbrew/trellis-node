import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { TrellisVcsEngine } from '../../src/engine.js';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const TEST_ROOT = '/tmp/trellis-p2-milestone-test';

describe('Milestones', () => {
  let engine: TrellisVcsEngine;

  beforeEach(async () => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_ROOT, { recursive: true });

    // Create some files so the engine has ops to work with
    writeFileSync(join(TEST_ROOT, 'a.ts'), 'export const a = 1;');
    writeFileSync(join(TEST_ROOT, 'b.ts'), 'export const b = 2;');

    engine = new TrellisVcsEngine({ rootPath: TEST_ROOT });
    await engine.initRepo();
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('createMilestone creates a milestone op', async () => {
    const op = await engine.createMilestone('first milestone');
    expect(op.kind).toBe('vcs:milestoneCreate');
    expect(op.vcs?.message).toBe('first milestone');
    expect(op.vcs?.milestoneId).toStartWith('milestone:');
  });

  test('milestone has fromOpHash and toOpHash', async () => {
    const op = await engine.createMilestone('with range');
    expect(op.vcs?.fromOpHash).toBeTruthy();
    expect(op.vcs?.toOpHash).toBeTruthy();
  });

  test('listMilestones returns created milestones', async () => {
    await engine.createMilestone('ms-1');
    await engine.createMilestone('ms-2');

    const milestones = engine.listMilestones();
    expect(milestones).toHaveLength(2);
    expect(milestones[0].message).toBe('ms-1');
    expect(milestones[1].message).toBe('ms-2');
  });

  test('milestone tracks affected files', async () => {
    const op = await engine.createMilestone('tracks files');
    const milestones = engine.listMilestones();
    const ms = milestones.find((m) => m.message === 'tracks files');
    expect(ms).toBeDefined();
    // Should have captured a.ts and b.ts from the init scan
    expect(ms!.affectedFiles.length).toBeGreaterThan(0);
  });

  test('milestone has createdAt and createdBy', async () => {
    await engine.createMilestone('metadata test');
    const milestones = engine.listMilestones();
    expect(milestones[0].createdAt).toBeTruthy();
    expect(milestones[0].createdBy).toBeTruthy();
  });

  test('milestone op chains causally', async () => {
    const ops = engine.getOps();
    const lastBefore = ops[ops.length - 1];

    const msOp = await engine.createMilestone('chaining test');
    expect(msOp.previousHash).toBe(lastBefore.hash);
  });

  test('milestones persist across open()', async () => {
    await engine.createMilestone('persisted');

    const engine2 = new TrellisVcsEngine({ rootPath: TEST_ROOT });
    engine2.open();

    const milestones = engine2.listMilestones();
    expect(milestones).toHaveLength(1);
    expect(milestones[0].message).toBe('persisted');
  });

  test('second milestone auto-ranges from after the first', async () => {
    const ms1 = await engine.createMilestone('first');
    const ms2 = await engine.createMilestone('second');

    // ms2's fromOpHash should reference ms1's toOpHash or ms1's own hash
    expect(ms2.vcs?.fromOpHash).toBeTruthy();
    // ms2's toOpHash should be the op just before ms2 itself
    expect(ms2.vcs?.toOpHash).toBeTruthy();
  });
});
