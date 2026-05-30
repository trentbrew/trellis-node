import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { TrellisVcsEngine } from '../../src/engine.js';
import { loadLaneMeta } from '../../src/vcs/lane.js';

const TEST_ROOT = '/tmp/trellis-p4-lane-fork';

describe('Lane sibling fork (ADR 0006)', () => {
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

  test('forkLane creates sibling with shared baseOpHash and provenance', async () => {
    const parent = await engine.createLane({ issueId: 'TRL-1', sessionId: 'sess-a' });
    await engine.enterLane(parent.id);
    await engine.recordDecision({ toolName: 'test.lane', context: 'parent work' });
    await engine.leaveLane();

    const child = await engine.forkLane(parent.id, {
      sessionId: 'sess-b',
    });

    expect(child.parentLaneId).toBe(parent.id);
    expect(child.forkKind).toBe('sibling');
    expect(child.forkedAt).toBeTruthy();
    expect(child.baseOpHash).toBe(parent.baseOpHash);
    expect(child.baseBranch).toBe(parent.baseBranch);
    expect(child.issueId).toBe('TRL-1');
    expect(child.sessionId).toBe('sess-b');
    expect(child.id).not.toBe(parent.id);

    const reloaded = loadLaneMeta(join(TEST_ROOT, '.trellis'), child.id);
    expect(reloaded?.parentLaneId).toBe(parent.id);
  });

  test('forkLane writes laneCreate to integration journal', async () => {
    const parent = await engine.createLane();
    const integrationBefore = engine.getIntegrationOpCount();
    await engine.forkLane(parent.id, { sessionId: 'sess-fork' });
    expect(engine.getIntegrationOpCount()).toBeGreaterThan(integrationBefore);
  });

  test('cannot fork while inside active lane', async () => {
    const parent = await engine.createLane();
    await engine.enterLane(parent.id);
    await expect(engine.forkLane(parent.id)).rejects.toThrow('inside lane');
  });

  test('cannot fork dropped or promoted parent', async () => {
    const parent = await engine.createLane();
    await engine.dropLane(parent.id);
    await expect(engine.forkLane(parent.id)).rejects.toThrow('dropped');
  });

  test('child fork sets virtualBaseOpHash from parent journal head', async () => {
    const parent = await engine.createLane({ sessionId: 'sess-parent' });
    await engine.enterLane(parent.id);
    const parentOp = await engine.recordDecision({
      toolName: 'test.lane',
      context: 'parent work',
    });
    await engine.leaveLane();

    const child = await engine.forkLane(parent.id, {
      forkKind: 'child',
      sessionId: 'sess-child',
    });

    expect(child.forkKind).toBe('child');
    expect(child.virtualBaseOpHash).toBe(parentOp.hash);
    expect(child.baseOpHash).toBe(parent.baseOpHash);
    expect(child.parentLaneId).toBe(parent.id);
  });

  test('enter child lane materializes parent journal state', async () => {
    const parent = await engine.createLane();
    await engine.enterLane(parent.id);
    await engine.recordDecision({
      toolName: 'test.lane',
      context: 'visible in child',
    });
    await engine.leaveLane();

    const child = await engine.forkLane(parent.id, { forkKind: 'child' });
    await engine.enterLane(child.id);

    const decisions = engine.queryDecisions();
    expect(decisions.some((d) => d.context === 'visible in child')).toBe(true);

    await engine.recordDecision({
      toolName: 'test.lane',
      context: 'child only',
    });
    await engine.leaveLane();

    expect(engine.getLaneOpCount(child.id)).toBe(1);
    expect(engine.queryDecisions()).toHaveLength(0);
  });

  test('child lane promote replays child ops only', async () => {
    const created = await engine.createIssue('Child promote issue');
    const issueId = created.vcs!.issueId!;

    const parent = await engine.createLane({ issueId });
    await engine.enterLane(parent.id);
    await engine.updateIssue(issueId, { description: 'parent lane edit' });
    await engine.leaveLane();

    const child = await engine.forkLane(parent.id, { forkKind: 'child' });
    await engine.enterLane(child.id);
    await engine.updateIssue(issueId, { title: 'child lane title' });
    await engine.leaveLane();

    const result = await engine.promoteLane(child.id);
    expect(result.promoted).toBe(true);
    expect(engine.getIssue(issueId)?.title).toBe('child lane title');
    expect(engine.getIssue(issueId)?.description).not.toBe('parent lane edit');
  });

  test('sibling lanes have isolated journals after fork', async () => {
    const parent = await engine.createLane();
    await engine.enterLane(parent.id);
    await engine.recordDecision({ toolName: 'test.lane', context: 'parent only' });
    await engine.leaveLane();

    const child = await engine.forkLane(parent.id);
    await engine.enterLane(child.id);
    await engine.recordDecision({ toolName: 'test.lane', context: 'child only' });
    await engine.leaveLane();

    expect(engine.getLaneOpCount(parent.id)).toBe(1);
    expect(engine.getLaneOpCount(child.id)).toBe(1);
  });
});
