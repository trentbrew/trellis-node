import { describe, expect, test } from 'bun:test';
import { EAVStore } from '../../src/core/store/eav-store.js';
import type { EngineContext } from '../../src/vcs/engine-context.js';
import {
  createEntity,
  getEntity,
  listEntities,
  addLink,
} from '../../src/vcs/store.js';

function mockCtx(store: EAVStore): EngineContext {
  const ops: any[] = [];
  return {
    store,
    agentId: 'agent:test',
    readAllOps: () => ops,
    getLastOp: () => ops[ops.length - 1],
    applyOp: async (op) => {
      ops.push(op);
      if (op.vcs?.facts) store.addFacts(op.vcs.facts);
      if (op.vcs?.links) store.addLinks(op.vcs.links);
    },
  };
}

describe('vcs/store', () => {
  test('createEntity asserts type and attributes', async () => {
    const store = new EAVStore();
    const ctx = mockCtx(store);
    await createEntity(ctx, 'event:acm-2026', 'Event', {
      title: 'ACM 2026',
    });
    const entity = getEntity(ctx, 'event:acm-2026');
    expect(entity?.type).toBe('Event');
    expect(entity?.facts.find((f) => f.a === 'title')?.v).toBe('ACM 2026');
  });

  test('listEntities excludes VCS internal ids by default', async () => {
    const store = new EAVStore();
    const ctx = mockCtx(store);
    await createEntity(ctx, 'event:acm-2026', 'Event', { title: 'ACM' });
    store.addFacts([{ e: 'issue:TRL-1', a: 'type', v: 'Issue' }]);
    const listed = listEntities(ctx);
    expect(listed.map((e) => e.id)).toEqual(['event:acm-2026']);
  });

  test('addLink creates storeLink op payload', async () => {
    const store = new EAVStore();
    const ctx = mockCtx(store);
    await createEntity(ctx, 'event:acm-2026', 'Event', {});
    await createEntity(ctx, 'person:katie', 'Contact', {});
    const op = await addLink(ctx, 'event:acm-2026', 'managedBy', 'person:katie');
    expect(op.kind).toBe('vcs:storeLink');
    expect(store.getLinksByEntity('event:acm-2026')).toHaveLength(1);
  });
});
