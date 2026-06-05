import { describe, test, expect, beforeEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { TrellisVcsEngine } from '../../src/engine.js';
import { SyncRoomCore } from '../../src/sync/room-core.js';
import { TrellisVcsSyncPeer } from '../../src/sync/vcs-sync-peer.js';
import { MemorySyncRoom } from '../../src/sync/memory-room.js';
import { PROTOCOL_VERSION } from '../../src/sync/types.js';

const TEST_ROOT = '/tmp/trellis-p7-room-snapshot';

async function initPeer(name: string): Promise<TrellisVcsEngine> {
  const rootPath = join(TEST_ROOT, name);
  mkdirSync(rootPath, { recursive: true });
  const engine = new TrellisVcsEngine({
    rootPath,
    agentId: `agent:${name}`,
  });
  await engine.initRepo();
  return engine;
}

describe('SyncRoomCore snapshot catch-up', () => {
  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('buildSnapshot truncates large logs', async () => {
    const engine = await initPeer('snap-peer');
    for (let i = 0; i < 60; i++) {
      await engine.createIssue(`Issue ${i}`, { laneId: 'lane-a' });
    }

    const core = new SyncRoomCore();
    await core.appendOps(engine.getOps());

    const snap = core.buildSnapshot(10);
    expect(snap.truncated).toBe(true);
    expect(snap.opCount).toBeGreaterThan(10);
    expect(snap.ops.length).toBe(10);
    expect(snap.headHash).toBe(engine.getOps().at(-1)?.hash);
  });

  test('sync-snapshot request returns tail for late joiner', async () => {
    const peerA = await initPeer('peer-a');
    const peerB = await initPeer('peer-b');

    for (let i = 0; i < 20; i++) {
      await peerA.createIssue(`Issue ${i}`, { laneId: 'lane-a' });
    }

    const room = new MemorySyncRoom('room');
    const syncA = new TrellisVcsSyncPeer({
      peerId: 'peer-a',
      engine: peerA,
      transport: room.connectPeer('peer-a'),
    });
    const syncB = new TrellisVcsSyncPeer({
      peerId: 'peer-b',
      engine: peerB,
      transport: room.connectPeer('peer-b'),
    });

    await syncA.syncWith('room');

    await syncB.requestSnapshot('room', 5);
    await syncB.syncWith('room');

    expect(peerB.getOpCount()).toBe(peerA.getOpCount());
    expect(peerB.listIssues().length).toBe(20);
  });

  test('want with maxOps delivers snapshot message', async () => {
    const engine = await initPeer('want-peer');
    await engine.createIssue('One', { laneId: 'lane-a' });
    await engine.createIssue('Two', { laneId: 'lane-a' });

    const core = new SyncRoomCore();
    await core.appendOps(engine.getOps());

    const deliveries = await core.receive('peer-a', {
      version: PROTOCOL_VERSION,
      type: 'want',
      peerId: 'peer-a',
      wantHashes: [],
      maxOps: 1,
    });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].message.type).toBe('snapshot');
    if (deliveries[0].message.type === 'snapshot') {
      expect(deliveries[0].message.ops.length).toBeLessThanOrEqual(1);
      expect(deliveries[0].message.opCount).toBe(engine.getOpCount());
    }
  });
});
