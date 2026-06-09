import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { TrellisVcsEngine } from '../../src/engine.js';
import { createVcsOp } from '../../src/vcs/ops.js';
import { loadLaneMeta } from '../../src/vcs/lane.js';
import { planLanePromote } from '../../src/vcs/lane-promote.js';
import { BlobStore } from '../../src/vcs/blob-store.js';

const TEST_ROOT = '/tmp/trellis-p4-lane-promote';

describe('Lane promote', () => {
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

  test('disjoint lane ops on different issues promote cleanly', async () => {
    const opA = await engine.createIssue('Issue A');
    const opB = await engine.createIssue('Issue B');
    const idA = opA.vcs!.issueId!;
    const idB = opB.vcs!.issueId!;

    const laneA = await engine.createLane();
    await engine.enterLane(laneA.id);
    await engine.updateIssue(idA, { description: 'lane A work' });
    await engine.leaveLane();

    const laneB = await engine.createLane();
    await engine.enterLane(laneB.id);
    await engine.updateIssue(idB, { description: 'lane B work' });
    await engine.leaveLane();

    const resultA = await engine.promoteLane(laneA.id);
    expect(resultA.promoted).toBe(true);
    expect(resultA.blockingConflicts).toHaveLength(0);

    const resultB = await engine.promoteLane(laneB.id);
    expect(resultB.promoted).toBe(true);

    expect(engine.getIssue(idA)?.description).toBe('lane A work');
    expect(engine.getIssue(idB)?.description).toBe('lane B work');
    expect(loadLaneMeta(join(TEST_ROOT, '.trellis'), laneA.id)?.status).toBe('promoted');
    expect(loadLaneMeta(join(TEST_ROOT, '.trellis'), laneB.id)?.status).toBe('promoted');
  });

  test('same issue attribute diverged since fork is a hard conflict', async () => {
    const created = await engine.createIssue('Conflict issue');
    const issueId = created.vcs!.issueId!;

    const lane = await engine.createLane();
    await engine.updateIssue(issueId, { description: 'integration version' });

    await engine.enterLane(lane.id);
    await engine.updateIssue(issueId, { description: 'lane version' });
    await engine.leaveLane();

    const dryRun = await engine.promoteLane(lane.id, { dryRun: true });
    expect(dryRun.promoted).toBe(false);
    expect(dryRun.canPromote).toBe(false);
    expect(dryRun.blockingConflicts.some((c) => c.class === 'hard')).toBe(true);

    const result = await engine.promoteLane(lane.id);
    expect(result.promoted).toBe(false);
    expect(result.blockingConflicts.some((c) => c.class === 'hard')).toBe(true);
  });

  test('criterion added inside a lane routes to integration (no promote needed)', async () => {
    // Issue lifecycle + acceptance criteria are integration-direct kinds
    // (ISSUE_INTEGRATION_KINDS): they bypass the lane journal so issue state
    // is shared across lanes immediately.
    const created = await engine.createIssue('Parallel issue');
    const issueId = created.vcs!.issueId!;

    const lane = await engine.createLane();
    await engine.enterLane(lane.id);
    await engine.addCriterion(issueId, 'test:bun test');
    await engine.leaveLane();

    // Criterion is visible on integration without any promote.
    const issue = engine.getIssue(issueId);
    expect(issue?.criteria.some((c) => c.description === 'test:bun test')).toBe(true);

    // The lane journal stays empty: nothing to replay, no conflicts.
    const plan = await engine.promoteLane(lane.id, { dryRun: true });
    expect(plan.blockingConflicts).toHaveLength(0);
    expect(plan.opsToReplay).toHaveLength(0);
    expect(plan.canPromote).toBe(false);
  });

  test('same entity different attributes is a soft conflict', async () => {
    const created = await engine.createIssue('Soft conflict issue', {
      description: 'base description',
    });
    const issueId = created.vcs!.issueId!;

    const lane = await engine.createLane();
    await engine.updateIssue(issueId, { description: 'integration changed description' });

    await engine.enterLane(lane.id);
    await engine.updateIssue(issueId, { title: 'lane changed title' });
    await engine.leaveLane();

    const plan = await engine.promoteLane(lane.id, { dryRun: true });
    expect(plan.canPromote).toBe(false);
    expect(plan.blockingConflicts.some((c) => c.class === 'soft')).toBe(true);
  });

  test('dry-run reports ready when lane ops are safe', async () => {
    const lane = await engine.createLane();
    await engine.enterLane(lane.id);
    await engine.recordDecision({ toolName: 'test.lane', context: 'safe promote' });
    await engine.leaveLane();

    const plan = await engine.promoteLane(lane.id, { dryRun: true });
    expect(plan.canPromote).toBe(true);
    expect(plan.promoted).toBe(false);
    expect(plan.opsToReplay.length).toBe(1);
  });

  test('promote replays lane decision onto integration', async () => {
    const lane = await engine.createLane();
    await engine.enterLane(lane.id);
    await engine.recordDecision({ toolName: 'test.lane', context: 'promoted decision' });
    await engine.leaveLane();

    const before = engine.getIntegrationOpCount();
    const result = await engine.promoteLane(lane.id);
    expect(result.promoted).toBe(true);
    expect(engine.getIntegrationOpCount()).toBeGreaterThan(before);
    expect(engine.queryDecisions()).toHaveLength(1);
  });

  test('file modify with non-overlapping edits plans a clean three-way merge', async () => {
    const blobStore = new BlobStore(join(TEST_ROOT, '.trellis'));
    const baseHash = blobStore.putSync(Buffer.from('alpha\nbeta\n', 'utf-8'));
    const integrationHash = blobStore.putSync(Buffer.from('alpha\nBETA\n', 'utf-8'));
    const laneHash = blobStore.putSync(Buffer.from('alpha\nbeta\nomega\n', 'utf-8'));

    const filePath = 'notes.txt';
    const integrationOps = [
      await createVcsOp('vcs:fileAdd', {
        agentId: 'agent:test',
        vcs: { filePath, contentHash: baseHash },
      }),
      await createVcsOp('vcs:fileModify', {
        agentId: 'agent:test',
        previousHash: undefined,
        vcs: { filePath, contentHash: integrationHash },
      }),
    ];
    integrationOps[1] = await createVcsOp('vcs:fileModify', {
      agentId: 'agent:test',
      previousHash: integrationOps[0]!.hash,
      vcs: { filePath, contentHash: integrationHash },
    });

    const baseOpHash = integrationOps[0]!.hash;
    const snapshotHead = integrationOps[1]!.hash;

    const laneOps = [
      await createVcsOp('vcs:fileModify', {
        agentId: 'agent:lane',
        vcs: { filePath, contentHash: laneHash },
      }),
    ];

    const plan = await planLanePromote({
      laneId: 'lane-test',
      meta: {
        id: 'lane-test',
        status: 'active',
        baseBranch: 'main',
        baseOpHash,
        targetBranch: 'main',
        agentId: 'agent:lane',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      targetBranch: 'main',
      snapshotHead,
      integrationOps,
      laneOps,
      blobStore,
    });

    expect(plan.blockingConflicts).toHaveLength(0);
    expect(plan.canPromote).toBe(true);
    expect(plan.opsToReplay[0]?.mergedContent).toContain('omega');
    expect(plan.opsToReplay[0]?.mergedContent).toContain('BETA');
  });

  test('file modify-modify conflict blocks promote', async () => {
    const blobStore = new BlobStore(join(TEST_ROOT, '.trellis'));
    const baseHash = blobStore.putSync(Buffer.from('same line\n', 'utf-8'));
    const integrationHash = blobStore.putSync(Buffer.from('integration edit\n', 'utf-8'));
    const laneHash = blobStore.putSync(Buffer.from('lane edit\n', 'utf-8'));

    const filePath = 'conflict.txt';
    const addOp = await createVcsOp('vcs:fileAdd', {
      agentId: 'agent:test',
      vcs: { filePath, contentHash: baseHash },
    });
    const modOp = await createVcsOp('vcs:fileModify', {
      agentId: 'agent:test',
      previousHash: addOp.hash,
      vcs: { filePath, contentHash: integrationHash },
    });

    const laneOps = [
      await createVcsOp('vcs:fileModify', {
        agentId: 'agent:lane',
        vcs: { filePath, contentHash: laneHash },
      }),
    ];

    const plan = await planLanePromote({
      laneId: 'lane-file-conflict',
      meta: {
        id: 'lane-file-conflict',
        status: 'active',
        baseBranch: 'main',
        baseOpHash: addOp.hash,
        targetBranch: 'main',
        agentId: 'agent:lane',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      targetBranch: 'main',
      snapshotHead: modOp.hash,
      integrationOps: [addOp, modOp],
      laneOps,
      blobStore,
    });

    expect(plan.canPromote).toBe(false);
    expect(plan.blockingConflicts.some((c) => c.class === 'file')).toBe(true);
  });
});
