import { describe, test, expect } from 'vitest';
import { SyncEngine } from '../../src/sync/sync-engine.js';
import { MemoryTransport } from '../../src/sync/memory-transport.js';
import type { VcsOp } from '../../src/vcs/types.js';
import type { SyncMessage } from '../../src/sync/types.js';
import { PROTOCOL_VERSION } from '../../src/sync/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOp(hash: string, kind: string, opts?: Partial<VcsOp>): VcsOp {
  return {
    hash,
    kind,
    timestamp: opts?.timestamp ?? new Date().toISOString(),
    agentId: opts?.agentId ?? 'test',
    vcs: opts?.vcs,
    previousHash: opts?.previousHash,
  } as VcsOp;
}

// ---------------------------------------------------------------------------
// MemoryTransport
// ---------------------------------------------------------------------------

describe('MemoryTransport', () => {
  test('connect allows message exchange', async () => {
    const tA = new MemoryTransport('peer-a', 'Alice');
    const tB = new MemoryTransport('peer-b', 'Bob');
    MemoryTransport.connect(tA, tB);

    const received: SyncMessage[] = [];
    tB.onMessage((msg) => received.push(msg));

    await tA.send('peer-b', {
      version: PROTOCOL_VERSION,
      type: 'have',
      peerId: 'peer-a',
      heads: { main: 'h1' },
      opCount: 1,
    });

    expect(received.length).toBe(1);
    expect(received[0].type).toBe('have');
  });

  test('peers() lists connected peers', () => {
    const tA = new MemoryTransport('peer-a', 'Alice');
    const tB = new MemoryTransport('peer-b', 'Bob');
    MemoryTransport.connect(tA, tB);

    const peers = tA.peers();
    expect(peers.length).toBe(1);
    expect(peers[0].id).toBe('peer-b');
    expect(peers[0].name).toBe('Bob');
  });

  test('disconnect removes peer', () => {
    const tA = new MemoryTransport('peer-a');
    const tB = new MemoryTransport('peer-b');
    MemoryTransport.connect(tA, tB);
    expect(tA.peers().length).toBe(1);

    MemoryTransport.disconnect(tA, tB);
    expect(tA.peers().length).toBe(0);
  });

  test('send to unconnected peer throws', async () => {
    const tA = new MemoryTransport('peer-a');
    await expect(
      tA.send('unknown', {
        version: PROTOCOL_VERSION,
        type: 'have',
        peerId: 'peer-a',
        heads: {},
        opCount: 0,
      }),
    ).rejects.toThrow('Peer not connected');
  });
});

// ---------------------------------------------------------------------------
// SyncEngine
// ---------------------------------------------------------------------------

describe('SyncEngine', () => {
  test('pushTo sends have message to peer', async () => {
    const tA = new MemoryTransport('peer-a');
    const tB = new MemoryTransport('peer-b');
    MemoryTransport.connect(tA, tB);

    const ops = [makeOp('h1', 'vcs:fileAdd')];
    const received: SyncMessage[] = [];
    tB.onMessage((msg) => received.push(msg));

    const engine = new SyncEngine({
      localPeerId: 'peer-a',
      transport: tA,
      getLocalOps: () => ops,
      onOpsReceived: () => {},
    });

    await engine.pushTo('peer-b');
    expect(received.length).toBe(1);
    expect(received[0].type).toBe('have');
  });

  test('pullFrom sends want message', async () => {
    const tA = new MemoryTransport('peer-a');
    const tB = new MemoryTransport('peer-b');
    MemoryTransport.connect(tA, tB);

    const received: SyncMessage[] = [];
    tB.onMessage((msg) => received.push(msg));

    const engine = new SyncEngine({
      localPeerId: 'peer-a',
      transport: tA,
      getLocalOps: () => [makeOp('h1', 'vcs:fileAdd')],
      onOpsReceived: () => {},
    });

    await engine.pullFrom('peer-b');
    expect(received.length).toBe(1);
    expect(received[0].type).toBe('want');
  });

  test('two engines sync ops via have/want/ops protocol', async () => {
    const tA = new MemoryTransport('peer-a');
    const tB = new MemoryTransport('peer-b');
    MemoryTransport.connect(tA, tB);

    const sharedOps = [makeOp('h1', 'vcs:branchCreate')];
    const opsA = [...sharedOps, makeOp('a1', 'vcs:fileAdd', { vcs: { filePath: 'a.ts' } })];
    const opsB = [...sharedOps];
    const receivedByB: VcsOp[] = [];

    const engineA = new SyncEngine({
      localPeerId: 'peer-a',
      transport: tA,
      getLocalOps: () => opsA,
      onOpsReceived: () => {},
    });

    const engineB = new SyncEngine({
      localPeerId: 'peer-b',
      transport: tB,
      getLocalOps: () => opsB,
      onOpsReceived: (ops) => receivedByB.push(...ops),
    });

    // A pushes to B
    await engineA.pushTo('peer-b');
    // B's handler processes 'have', sends 'want', A responds with 'ops'

    // Since messages are awaited in MemoryTransport, the full
    // have→want→ops chain happens immediately
    // B should have received the new op
    expect(receivedByB.length).toBe(1);
    expect(receivedByB[0].hash).toBe('a1');
  });

  test('sendOps directly sends ops to peer', async () => {
    const tA = new MemoryTransport('peer-a');
    const tB = new MemoryTransport('peer-b');
    MemoryTransport.connect(tA, tB);

    const receivedByB: VcsOp[] = [];
    const engineB = new SyncEngine({
      localPeerId: 'peer-b',
      transport: tB,
      getLocalOps: () => [],
      onOpsReceived: (ops) => receivedByB.push(...ops),
    });

    const engineA = new SyncEngine({
      localPeerId: 'peer-a',
      transport: tA,
      getLocalOps: () => [],
      onOpsReceived: () => {},
    });

    const ops = [makeOp('h1', 'vcs:fileAdd'), makeOp('h2', 'vcs:fileModify')];
    await engineA.sendOps('peer-b', ops);

    // B receives ops via message handler
    expect(receivedByB.length).toBe(2);
  });

  test('linear mode filters duplicate ops', async () => {
    const tA = new MemoryTransport('peer-a');
    const tB = new MemoryTransport('peer-b');
    MemoryTransport.connect(tA, tB);

    const sharedOp = makeOp('h1', 'vcs:fileAdd');
    const receivedByB: VcsOp[] = [];

    const engineB = new SyncEngine({
      localPeerId: 'peer-b',
      transport: tB,
      getLocalOps: () => [sharedOp], // B already has h1
      onOpsReceived: (ops) => receivedByB.push(...ops),
      branchPolicy: { linear: true },
    });

    const engineA = new SyncEngine({
      localPeerId: 'peer-a',
      transport: tA,
      getLocalOps: () => [],
      onOpsReceived: () => {},
    });

    // Send ops that B already has
    await engineA.sendOps('peer-b', [sharedOp, makeOp('h2', 'vcs:fileModify')]);

    // B should only receive h2 (not the duplicate h1)
    expect(receivedByB.length).toBe(1);
    expect(receivedByB[0].hash).toBe('h2');
  });

  test('reconcileWith merges op streams', () => {
    const tA = new MemoryTransport('peer-a');

    const shared = [makeOp('h1', 'vcs:branchCreate')];
    const localOps = [...shared, makeOp('a1', 'vcs:fileAdd', { vcs: { filePath: 'a.ts' } })];
    const remoteOps = [...shared, makeOp('b1', 'vcs:fileAdd', { vcs: { filePath: 'b.ts' } })];

    const engine = new SyncEngine({
      localPeerId: 'peer-a',
      transport: tA,
      getLocalOps: () => localOps,
      onOpsReceived: () => {},
    });

    const result = engine.reconcileWith(remoteOps);
    expect(result.merged.length).toBe(3);
    expect(result.clean).toBe(true);
  });

  test('getBranchPolicy returns current policy', () => {
    const t = new MemoryTransport('peer-a');
    const engine = new SyncEngine({
      localPeerId: 'peer-a',
      transport: t,
      getLocalOps: () => [],
      onOpsReceived: () => {},
      branchPolicy: { linear: false },
    });

    expect(engine.getBranchPolicy().linear).toBe(false);
  });

  test('setBranchPolicy changes policy', () => {
    const t = new MemoryTransport('peer-a');
    const engine = new SyncEngine({
      localPeerId: 'peer-a',
      transport: t,
      getLocalOps: () => [],
      onOpsReceived: () => {},
    });

    expect(engine.getBranchPolicy().linear).toBe(true);
    engine.setBranchPolicy({ linear: false });
    expect(engine.getBranchPolicy().linear).toBe(false);
  });

  test('listPeers returns connected peers', () => {
    const tA = new MemoryTransport('peer-a', 'Alice');
    const tB = new MemoryTransport('peer-b', 'Bob');
    MemoryTransport.connect(tA, tB);

    const engine = new SyncEngine({
      localPeerId: 'peer-a',
      transport: tA,
      getLocalOps: () => [],
      onOpsReceived: () => {},
    });

    const peers = engine.listPeers();
    expect(peers.length).toBe(1);
    expect(peers[0].name).toBe('Bob');
  });
});
