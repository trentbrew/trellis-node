import { describe, test, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IdbOpLog } from '../../src/vcs/idb-op-log.js';
import { createVcsOp } from '../../src/vcs/ops.js';
import type { VcsOp } from '../../src/vcs/types.js';

async function makeOp(previousHash?: string, value = 'fact'): Promise<VcsOp> {
  return createVcsOp('vcs:storeAssert', {
    agentId: 'agent:test',
    previousHash,
    vcs: {
      facts: [{ e: 'issue:lane-a:1', a: 'title', v: value }],
    },
  });
}

describe('IdbOpLog', () => {
  let factory: IDBFactory;

  beforeEach(() => {
    // Fresh IDB factory per test — clean state, no cross-test bleed.
    factory = new IDBFactory();
  });

  test('append/readAll/count/getLastOp serve from in-memory cache', async () => {
    const log = new IdbOpLog({ dbName: 'trellis-test', indexedDB: factory });
    await log.load();

    expect(log.count()).toBe(0);
    expect(log.getLastOp()).toBeUndefined();
    expect(log.readAll()).toEqual([]);

    const op1 = await makeOp();
    const op2 = await makeOp(op1.hash, 'second');
    log.append(op1);
    log.append(op2);

    expect(log.count()).toBe(2);
    expect(log.getLastOp()?.hash).toBe(op2.hash);
    expect(log.readAll().map((o) => o.hash)).toEqual([op1.hash, op2.hash]);
  });

  test('appending the same hash twice is a no-op (hash dedup)', async () => {
    const log = new IdbOpLog({ dbName: 'trellis-test', indexedDB: factory });
    await log.load();

    const op = await makeOp();
    log.append(op);
    log.append(op);

    expect(log.count()).toBe(1);
    await log.flush();
  });

  test('crash recovery: ops persist across close/reopen via the same factory', async () => {
    const dbName = 'trellis-persist';

    const writer = new IdbOpLog({ dbName, indexedDB: factory });
    await writer.load();
    const op1 = await makeOp();
    const op2 = await makeOp(op1.hash, 'persisted');
    writer.append(op1);
    writer.append(op2);
    await writer.flush();
    await writer.close();

    // Reopen via a fresh IdbOpLog instance — simulates a tab restart.
    const reader = new IdbOpLog({ dbName, indexedDB: factory });
    await reader.load();

    expect(reader.count()).toBe(2);
    expect(reader.readAll().map((o) => o.hash)).toEqual([op1.hash, op2.hash]);
    expect(reader.getLastOp()?.hash).toBe(op2.hash);
  });

  test('reopened log continues sequence — new appends sort after persisted ones', async () => {
    const dbName = 'trellis-resume';

    const first = new IdbOpLog({ dbName, indexedDB: factory });
    await first.load();
    const op1 = await makeOp();
    first.append(op1);
    await first.flush();
    await first.close();

    const second = new IdbOpLog({ dbName, indexedDB: factory });
    await second.load();
    const op2 = await makeOp(op1.hash, 'after-reload');
    second.append(op2);
    await second.flush();
    await second.close();

    // Third open observes the full ordered history.
    const third = new IdbOpLog({ dbName, indexedDB: factory });
    await third.load();
    expect(third.readAll().map((o) => o.hash)).toEqual([op1.hash, op2.hash]);
  });

  test('append before load() throws', async () => {
    const log = new IdbOpLog({ dbName: 'trellis-no-load', indexedDB: factory });
    const op = await makeOp();
    expect(() => log.append(op)).toThrow(/before load/);
  });

  test('flush resolves once all queued writes are durable', async () => {
    const log = new IdbOpLog({ dbName: 'trellis-flush', indexedDB: factory });
    await log.load();
    const op1 = await makeOp();
    const op2 = await makeOp(op1.hash, 'flushable');
    log.append(op1);
    log.append(op2);

    await log.flush();

    // After flush, a fresh open against the same factory must see both ops
    // — no race with in-flight writes.
    const verifier = new IdbOpLog({
      dbName: 'trellis-flush',
      indexedDB: factory,
    });
    await verifier.load();
    expect(verifier.count()).toBe(2);
  });
});
