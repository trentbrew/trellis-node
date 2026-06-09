import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { TrellisVcsEngine } from '../../src/engine.js';
import {
  cloneStore,
  materializeIntegrationOps,
  overlayLaneOps,
  reapplyIntegrationCriterionUpdates,
} from '../../src/vcs/lane-materialize.js';
import { EAVStore } from '../../src/core/store/eav-store.js';
import { createVcsOp } from '../../src/vcs/ops.js';

const TEST_ROOT = '/tmp/trellis-p4-lane-materialize';

describe('lane materialize helpers', () => {
  test('cloneStore preserves facts', async () => {
    const store = new EAVStore();
    store.addFacts([{ e: 'issue:TRL-1', a: 'type', v: 'Issue' }]);

    const clone = cloneStore(store);
    expect(clone.getFactsByEntity('issue:TRL-1')).toHaveLength(1);
    clone.addFacts([{ e: 'issue:TRL-1', a: 'title', v: 'Changed' }]);
    expect(store.getFactsByEntity('issue:TRL-1')).toHaveLength(1);
  });

  test('integration cache hits when tail unchanged', async () => {
    const op = await createVcsOp('vcs:decisionRecord', {
      agentId: 'agent:test',
      vcs: { decisionId: 'decision:1', decisionContext: 'cache test' },
    });
    const first = materializeIntegrationOps([op], null, op.hash);
    const second = materializeIntegrationOps([op], first.cache, op.hash);

    expect(first.stats.integrationOpsReplayed).toBe(1);
    expect(second.stats.integrationCacheHit).toBe(true);
    expect(second.stats.integrationOpsReplayed).toBe(0);
    expect(second.store).toBe(first.store);
  });

  test('reapplyIntegrationCriterionUpdates wins over lane pending status', async () => {
    const integrationOp = await createVcsOp('vcs:criterionUpdate', {
      agentId: 'agent:test',
      vcs: {
        issueId: 'TRL-1',
        criterionId: 'criterion:TRL-1:ac-1',
        criterionStatus: 'passed',
      },
    });
    const { store: integration } = materializeIntegrationOps(
      [integrationOp],
      null,
      integrationOp.hash,
    );

    const laneAdd = await createVcsOp('vcs:criterionAdd', {
      agentId: 'agent:lane',
      vcs: {
        issueId: 'TRL-1',
        criterionId: 'criterion:TRL-1:ac-1',
        criterionDescription: 'Gate',
      },
    });
    const { store } = overlayLaneOps(integration, [laneAdd]);
    const beforeStatuses = store
      .getFactsByEntity('criterion:TRL-1:ac-1')
      .filter((f) => f.a === 'status')
      .map((f) => f.v);
    expect(beforeStatuses[beforeStatuses.length - 1]).toBe('pending');

    reapplyIntegrationCriterionUpdates(store, [integrationOp]);
    const statuses = store
      .getFactsByEntity('criterion:TRL-1:ac-1')
      .filter((f) => f.a === 'status')
      .map((f) => f.v);
    expect(statuses).toEqual(['passed']);
  });

  test('overlayLaneOps forks integration state', async () => {
    const integration = new EAVStore();
    integration.addFacts([{ e: 'issue:TRL-1', a: 'title', v: 'base' }]);

    const laneOp = await createVcsOp('vcs:decisionRecord', {
      agentId: 'agent:lane',
      vcs: { decisionId: 'decision:lane', decisionContext: 'lane-only' },
    });

    const { store, laneOpsReplayed } = overlayLaneOps(integration, [laneOp]);
    expect(laneOpsReplayed).toBe(1);
    expect(store.getFactsByEntity('decision:lane').length).toBeGreaterThan(0);
    expect(integration.getFactsByEntity('decision:lane')).toHaveLength(0);
  });
});

describe('Engine lazy lane replay', () => {
  let engine: TrellisVcsEngine;

  beforeEach(async () => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_ROOT, { recursive: true });
    engine = new TrellisVcsEngine({ rootPath: TEST_ROOT });
    await engine.initRepo();
    engine.setCheckpointThreshold(0);

    for (let i = 0; i < 50; i++) {
      await engine.recordDecision({
        toolName: 'test.integration',
        context: `integration op ${i}`,
      });
    }
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('leaveLane restores integration view without replaying integration ops', async () => {
    const lane = await engine.createLane();
    await engine.enterLane(lane.id);
    const firstEnter = engine.getMaterializationStats();
    expect(firstEnter.laneOpsReplayed).toBe(0);
    expect(firstEnter.integrationCacheHit || firstEnter.integrationOpsReplayed > 0).toBe(
      true,
    );

    await engine.leaveLane();
    const stats = engine.getMaterializationStats();
    expect(stats.integrationOpsReplayed).toBe(0);
    expect(stats.integrationCacheHit).toBe(true);
    expect(stats.laneOpsReplayed).toBe(0);
    expect(engine.queryDecisions()).toHaveLength(50);
  });

  test('re-entering lane hits integration cache', async () => {
    const lane = await engine.createLane();
    await engine.enterLane(lane.id);
    await engine.recordDecision({ toolName: 'test.lane', context: 'lane work' });
    await engine.leaveLane();

    await engine.enterLane(lane.id);
    const stats = engine.getMaterializationStats();
    expect(stats.integrationCacheHit).toBe(true);
    expect(stats.integrationOpsReplayed).toBe(0);
    expect(stats.laneOpsReplayed).toBe(1);
    expect(engine.queryDecisions()).toHaveLength(51);
  });

  test('open with active lane overlays lane ops once', async () => {
    const lane = await engine.createLane();
    await engine.enterLane(lane.id);
    await engine.recordDecision({ toolName: 'test.lane', context: 'persist' });

    const engine2 = new TrellisVcsEngine({ rootPath: TEST_ROOT });
    const opened = engine2.open();
    expect(engine2.getActiveLaneId()).toBe(lane.id);
    expect(engine2.queryDecisions()).toHaveLength(51);
    expect(opened.opsReplayed).toBeGreaterThan(0);
  });
});
