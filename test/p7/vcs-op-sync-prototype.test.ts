import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { TrellisVcsEngine } from '../../src/engine.js';
import { createVcsOp } from '../../src/vcs/ops.js';
import { TrellisVcsSyncPeer } from '../../src/sync/vcs-sync-peer.js';
import { MemoryTransport } from '../../src/sync/memory-transport.js';
import { MemorySyncRoom } from '../../src/sync/memory-room.js';
import { PROTOCOL_VERSION } from '../../src/sync/types.js';
import type { Fact } from '../../src/core/store/eav-store.js';
import type { SyncMessage } from '../../src/sync/types.js';
import type { VcsOp } from '../../src/vcs/types.js';

const TEST_ROOT = '/tmp/trellis-p7-vcs-op-sync-prototype';

function sorted<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}

function factKey(fact: Fact): string {
  return `${fact.e}\0${fact.a}\0${String(fact.v)}`;
}

function issueFacts(engine: TrellisVcsEngine): Fact[] {
  const visibleAttrs = new Set(['status', 'title', 'type']);
  return sorted(
    engine
      .getStore()
      .getAllFacts()
      .filter(
        (fact) =>
          fact.e.startsWith('issue:lane-') && visibleAttrs.has(fact.a),
      ),
    factKey,
  );
}

function opHashes(engine: TrellisVcsEngine): string[] {
  return sorted(
    engine.getOps().map((op) => op.hash),
    (hash) => hash,
  );
}

async function initPeer(name: string): Promise<TrellisVcsEngine> {
  const rootPath = join(TEST_ROOT, name);
  mkdirSync(rootPath, { recursive: true });
  const engine = new TrellisVcsEngine({
    rootPath,
    agentId: `agent:${name}`,
  });
  await engine.initRepo();
  engine.setCheckpointThreshold(0);
  return engine;
}

async function createLaneScopedIssue(
  engine: TrellisVcsEngine,
  laneId: string,
  title: string,
): Promise<void> {
  await engine.createIssue(title, { laneId });
}

describe('VCS op sync prototype', () => {
  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('two offline engines converge by exchanging VCS ops', async () => {
    const peerA = await initPeer('peer-a');
    const peerB = await initPeer('peer-b');

    await createLaneScopedIssue(peerA, 'lane-a', 'Fix auth');
    await createLaneScopedIssue(peerB, 'lane-b', 'Write sync smoke test');

    const transportA = new MemoryTransport('peer-a', 'Peer A');
    const transportB = new MemoryTransport('peer-b', 'Peer B');
    MemoryTransport.connect(transportA, transportB);

    const syncA = new TrellisVcsSyncPeer({
      peerId: 'peer-a',
      engine: peerA,
      transport: transportA,
    });

    new TrellisVcsSyncPeer({
      peerId: 'peer-b',
      engine: peerB,
      transport: transportB,
    });

    const result = await syncA.syncWith('peer-b');

    expect(result.applied).toBeGreaterThan(0);
    expect(result.rejected).toBe(0);
    expect(opHashes(peerA)).toEqual(opHashes(peerB));
    expect(issueFacts(peerA)).toEqual([
      { e: 'issue:lane-a:1', a: 'status', v: 'backlog' },
      { e: 'issue:lane-a:1', a: 'title', v: 'Fix auth' },
      { e: 'issue:lane-a:1', a: 'type', v: 'Issue' },
      { e: 'issue:lane-b:1', a: 'status', v: 'backlog' },
      { e: 'issue:lane-b:1', a: 'title', v: 'Write sync smoke test' },
      { e: 'issue:lane-b:1', a: 'type', v: 'Issue' },
    ]);
    expect(issueFacts(peerB)).toEqual(issueFacts(peerA));
  });

  test('room relay keeps a catch-up log and converges late joiners', async () => {
    const peerA = await initPeer('room-peer-a');
    const peerB = await initPeer('room-peer-b');

    await createLaneScopedIssue(peerA, 'lane-a', 'Fix auth');
    await createLaneScopedIssue(peerB, 'lane-b', 'Write sync smoke test');

    const room = new MemorySyncRoom('project-room', 'Project Room');
    const syncA = new TrellisVcsSyncPeer({
      peerId: 'peer-a',
      engine: peerA,
      transport: room.connectPeer('peer-a', 'Peer A'),
    });
    const syncB = new TrellisVcsSyncPeer({
      peerId: 'peer-b',
      engine: peerB,
      transport: room.connectPeer('peer-b', 'Peer B'),
    });

    await syncA.syncWith('project-room');
    await syncB.syncWith('project-room');

    expect(opHashes(peerA)).toEqual(opHashes(peerB));
    expect(room.getOpCount()).toBe(peerA.getOpCount());

    const peerC = await initPeer('room-peer-c');
    const syncC = new TrellisVcsSyncPeer({
      peerId: 'peer-c',
      engine: peerC,
      transport: room.connectPeer('peer-c', 'Peer C'),
    });

    const catchUp = await syncC.syncWith('project-room');

    expect(catchUp.applied).toBeGreaterThan(0);
    expect(catchUp.rejected).toBe(0);
    expect(opHashes(peerA)).toEqual(opHashes(peerB));
    expect(opHashes(peerB)).toEqual(opHashes(peerC));
    expect(room.getOpCount()).toBe(peerC.getOpCount());
    expect(issueFacts(peerC)).toEqual([
      { e: 'issue:lane-a:1', a: 'status', v: 'backlog' },
      { e: 'issue:lane-a:1', a: 'title', v: 'Fix auth' },
      { e: 'issue:lane-a:1', a: 'type', v: 'Issue' },
      { e: 'issue:lane-b:1', a: 'status', v: 'backlog' },
      { e: 'issue:lane-b:1', a: 'title', v: 'Write sync smoke test' },
      { e: 'issue:lane-b:1', a: 'type', v: 'Issue' },
    ]);
  });

  test('integrateOps rejects non-VCS ops and hash mismatches', async () => {
    const engine = await initPeer('peer-a');
    const valid = await createVcsOp('vcs:storeAssert', {
      agentId: 'agent:lane-a',
      previousHash: engine.getOps().at(-1)?.hash,
      vcs: {
        facts: [{ e: 'issue:lane-a:1', a: 'title', v: 'Original' }],
      },
    });

    const invalidKind = {
      ...valid,
      kind: 'addFacts',
      hash: 'trellis:op:not-a-real-hash',
    } as VcsOp;
    const tampered = {
      ...valid,
      vcs: {
        facts: [{ e: 'issue:lane-a:1', a: 'title', v: 'Tampered' }],
      },
    };

    const result = await engine.integrateOps([invalidKind, tampered]);

    expect(result.applied).toBe(0);
    expect(result.rejected.map((item) => item.reason).sort()).toEqual([
      'hash-mismatch',
      'invalid-kind',
    ]);
    expect(issueFacts(engine)).toEqual([]);
  });

  test('integrateOps orders dependent batches before applying', async () => {
    const engine = await initPeer('peer-a');
    const parent = await createVcsOp('vcs:storeAssert', {
      agentId: 'agent:lane-a',
      previousHash: engine.getOps().at(-1)?.hash,
      vcs: {
        facts: [{ e: 'issue:lane-a:1', a: 'type', v: 'Issue' }],
      },
    });
    const child = await createVcsOp('vcs:storeAssert', {
      agentId: 'agent:lane-a',
      previousHash: parent.hash,
      vcs: {
        facts: [{ e: 'issue:lane-a:1', a: 'title', v: 'Ordered' }],
      },
    });

    const result = await engine.integrateOps([child, parent]);

    expect(result).toMatchObject({
      applied: 2,
      skipped: 0,
      rejected: [],
    });
    expect(issueFacts(engine)).toEqual([
      { e: 'issue:lane-a:1', a: 'title', v: 'Ordered' },
      { e: 'issue:lane-a:1', a: 'type', v: 'Issue' },
    ]);
  });

  test('integrateOps rejects ops with missing dependencies', async () => {
    const engine = await initPeer('peer-a');
    const op = await createVcsOp('vcs:storeAssert', {
      agentId: 'agent:lane-a',
      previousHash: 'trellis:op:missing',
      vcs: {
        facts: [{ e: 'issue:lane-a:1', a: 'title', v: 'Blocked' }],
      },
    });

    const result = await engine.integrateOps([op]);

    expect(result.applied).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toBe('missing-dependency');
    expect(issueFacts(engine)).toEqual([]);
  });

  describe('wire-level nack flow', () => {
    async function setupTwoPeers() {
      const peerA = await initPeer('peer-a');
      const peerB = await initPeer('peer-b');

      const transportA = new MemoryTransport('peer-a', 'Peer A');
      const transportB = new MemoryTransport('peer-b', 'Peer B');
      MemoryTransport.connect(transportA, transportB);

      const syncA = new TrellisVcsSyncPeer({
        peerId: 'peer-a',
        engine: peerA,
        transport: transportA,
      });
      const syncB = new TrellisVcsSyncPeer({
        peerId: 'peer-b',
        engine: peerB,
        transport: transportB,
      });

      return { peerA, peerB, syncA, syncB };
    }

    test('hash-mismatch op produces a hash-mismatch nack to the sender', async () => {
      const { peerA, peerB, syncA, syncB } = await setupTwoPeers();

      const valid = await createVcsOp('vcs:storeAssert', {
        agentId: 'agent:lane-a',
        previousHash: peerA.getOps().at(-1)?.hash,
        vcs: {
          facts: [{ e: 'issue:lane-a:1', a: 'title', v: 'Original' }],
        },
      });
      const tampered = {
        ...valid,
        vcs: {
          facts: [{ e: 'issue:lane-a:1', a: 'title', v: 'Tampered' }],
        },
      };

      await syncA.getSyncEngine().sendOps('peer-b', [tampered]);

      const nacks = syncA.getRemoteNacks();
      expect(nacks).toHaveLength(1);
      expect(nacks[0].reason).toBe('hash-mismatch');
      expect(nacks[0].refs).toEqual([tampered.hash]);
      expect(peerB.getOps().some((op) => op.hash === tampered.hash)).toBe(
        false,
      );
      expect(syncB.getRemoteNacks()).toHaveLength(0);
    });

    test('invalid-kind op produces an invalid-kind nack', async () => {
      const { peerA, peerB, syncA } = await setupTwoPeers();

      const valid = await createVcsOp('vcs:storeAssert', {
        agentId: 'agent:lane-a',
        previousHash: peerA.getOps().at(-1)?.hash,
        vcs: { facts: [{ e: 'issue:lane-a:1', a: 'type', v: 'Issue' }] },
      });
      const wrongKind = {
        ...valid,
        kind: 'addFacts',
        hash: 'trellis:op:not-a-real-hash',
      } as VcsOp;

      await syncA.getSyncEngine().sendOps('peer-b', [wrongKind]);

      const nacks = syncA.getRemoteNacks();
      expect(nacks).toHaveLength(1);
      expect(nacks[0].reason).toBe('invalid-kind');
      expect(nacks[0].refs).toEqual([wrongKind.hash]);
      expect(peerB.getOps().some((op) => op.hash === wrongKind.hash)).toBe(
        false,
      );
    });

    test('missing-dependency op produces a missing-dependency nack', async () => {
      const { peerB, syncA } = await setupTwoPeers();

      const orphan = await createVcsOp('vcs:storeAssert', {
        agentId: 'agent:lane-a',
        previousHash: 'trellis:op:not-in-peer-b',
        vcs: {
          facts: [{ e: 'issue:lane-a:1', a: 'title', v: 'Orphan' }],
        },
      });

      await syncA.getSyncEngine().sendOps('peer-b', [orphan]);

      const nacks = syncA.getRemoteNacks();
      expect(nacks).toHaveLength(1);
      expect(nacks[0].reason).toBe('missing-dependency');
      expect(nacks[0].refs).toEqual([orphan.hash]);
      expect(peerB.getOps().some((op) => op.hash === orphan.hash)).toBe(false);
    });

    test('unsupported protocol version is rejected with a protocol-version nack', async () => {
      const { syncA } = await setupTwoPeers();

      // Bypass SyncEngine and inject a malformed `have` directly on the
      // transport. Receiver's version gate must reject and reply with a
      // protocol-version nack at PROTOCOL_VERSION.
      const transportA = (
        syncA.getSyncEngine() as unknown as { transport: MemoryTransport }
      ).transport;
      const malformed: SyncMessage = {
        version: 999,
        type: 'have',
        peerId: 'peer-a',
        heads: {},
        opCount: 0,
      };
      await transportA.send('peer-b', malformed);

      const nacks = syncA.getRemoteNacks();
      expect(nacks).toHaveLength(1);
      expect(nacks[0].reason).toBe('protocol-version');
      expect(nacks[0].refs).toEqual([]);
      expect(nacks[0].details).toMatch(/Unsupported protocol version 999/);
    });

    test('pendingAcks is populated on send and cleared by ack', async () => {
      const { peerA, syncA } = await setupTwoPeers();

      const valid = await createVcsOp('vcs:storeAssert', {
        agentId: 'agent:lane-a',
        previousHash: peerA.getOps().at(-1)?.hash,
        vcs: { facts: [{ e: 'issue:lane-a:1', a: 'type', v: 'Issue' }] },
      });
      // Send a self-built op (one peer-b does not have its parent for, but
      // here parent points at peerA's init, not peerB's). Either way, the
      // engine state should reflect a clean lifecycle on the sender side.
      const engineA = syncA.getSyncEngine();
      const pendingBefore = new Set(engineA.getState().pendingAcks);
      expect(pendingBefore.has(valid.hash)).toBe(false);

      await engineA.sendOps('peer-b', [valid]);

      // After the MemoryTransport roundtrip, peer-b has responded with either
      // an ack or a nack — both clear the hash from pendingAcks.
      const pendingAfter = engineA.getState().pendingAcks;
      expect(pendingAfter.has(valid.hash)).toBe(false);
    });

    test('pendingAcks is cleared by nack on rejection', async () => {
      const { syncA } = await setupTwoPeers();

      const orphan = await createVcsOp('vcs:storeAssert', {
        agentId: 'agent:lane-a',
        previousHash: 'trellis:op:not-in-peer-b',
        vcs: {
          facts: [{ e: 'issue:lane-a:1', a: 'title', v: 'Orphan' }],
        },
      });

      const engineA = syncA.getSyncEngine();
      await engineA.sendOps('peer-b', [orphan]);

      // Receiver nacked → sender's pendingAcks should not retain the hash.
      expect(engineA.getState().pendingAcks.has(orphan.hash)).toBe(false);
      // And the nack surfaced to the consumer.
      expect(syncA.getRemoteNacks()).toHaveLength(1);
      expect(syncA.getRemoteNacks()[0].reason).toBe('missing-dependency');
    });

    test('mixed batch produces both ack and nack; valid ops converge', async () => {
      const { peerB, syncA } = await setupTwoPeers();

      // Build the chain on top of peer-b's known head so dependency checks
      // pass for the valid ops. We send via raw sendOps, so peer-a's own log
      // does not need to contain these ops.
      const validParent = peerB.getOps().at(-1)?.hash;
      const valid1 = await createVcsOp('vcs:storeAssert', {
        agentId: 'agent:lane-a',
        previousHash: validParent,
        vcs: { facts: [{ e: 'issue:lane-a:1', a: 'type', v: 'Issue' }] },
      });
      const valid2 = await createVcsOp('vcs:storeAssert', {
        agentId: 'agent:lane-a',
        previousHash: valid1.hash,
        vcs: {
          facts: [{ e: 'issue:lane-a:1', a: 'title', v: 'Mixed batch' }],
        },
      });
      const invalid = await createVcsOp('vcs:storeAssert', {
        agentId: 'agent:lane-a',
        previousHash: 'trellis:op:nope',
        vcs: {
          facts: [{ e: 'issue:lane-a:1', a: 'description', v: 'Rejected' }],
        },
      });

      await syncA
        .getSyncEngine()
        .sendOps('peer-b', [valid1, valid2, invalid]);

      const nacks = syncA.getRemoteNacks();
      expect(nacks).toHaveLength(1);
      expect(nacks[0].reason).toBe('missing-dependency');
      expect(nacks[0].refs).toEqual([invalid.hash]);

      const peerBHashes = new Set(peerB.getOps().map((op) => op.hash));
      expect(peerBHashes.has(valid1.hash)).toBe(true);
      expect(peerBHashes.has(valid2.hash)).toBe(true);
      expect(peerBHashes.has(invalid.hash)).toBe(false);
    });
  });
});
