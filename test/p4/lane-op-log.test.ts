import { describe, test, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { JsonOpLog, LaneOpLog } from '../../src/vcs/op-log.js';
import {
  createLaneMeta,
  loadLaneMeta,
  laneDir,
} from '../../src/vcs/lane.js';
import { createVcsOp } from '../../src/vcs/ops.js';

function stubOp(agentId: string, n: number, previousHash?: string) {
  return createVcsOp('vcs:decisionRecord', {
    agentId,
    previousHash,
    vcs: { decisionId: `decision:test-${n}`, decisionContext: 'lane test' },
  });
}

describe('LaneOpLog', () => {
  test('two lane journals append concurrently without cross-contamination', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trellis-lane-'));
    const trellisDir = join(root, '.trellis');

    const metaA = createLaneMeta(trellisDir, {
      baseBranch: 'main',
      baseOpHash: 'trellis:op:base',
      agentId: 'agent:a',
    });
    const metaB = createLaneMeta(trellisDir, {
      baseBranch: 'main',
      baseOpHash: 'trellis:op:base',
      agentId: 'agent:b',
    });

    const logA = new LaneOpLog(laneDir(trellisDir, metaA.id));
    const logB = new LaneOpLog(laneDir(trellisDir, metaB.id));
    logA.load();
    logB.load();

    const appendMany = async (log: LaneOpLog, agent: string, count: number) => {
      let prev = log.getLastOp()?.hash;
      for (let i = 0; i < count; i++) {
        const op = await stubOp(agent, i, prev);
        log.append(op);
        prev = op.hash;
      }
    };

    await Promise.all([
      appendMany(logA, 'agent:a', 50),
      appendMany(logB, 'agent:b', 50),
    ]);

    expect(logA.count()).toBe(50);
    expect(logB.count()).toBe(50);

    const integration = new JsonOpLog(join(trellisDir, 'ops.json'));
    integration.load();
    expect(integration.count()).toBe(0);

    expect(loadLaneMeta(trellisDir, metaA.id)?.agentId).toBe('agent:a');
    expect(loadLaneMeta(trellisDir, metaB.id)?.agentId).toBe('agent:b');

    rmSync(root, { recursive: true, force: true });
  });
});
