/**
 * Cross-framework contract for the typed, live read adapters — the same proof
 * the realtime adapters get: the Vue composable and the Svelte store are thin
 * bridges over one framework-agnostic `liveEntities` (Signal-first). Exercised
 * headlessly:
 *
 *   - Vue reactivity (`effectScope`, `shallowRef`, `computed`) runs without a DOM.
 *   - The Svelte store is plain TS implementing the lazy `subscribe`/start-stop
 *     contract — also DOM-free.
 *   - React's hook is the identical `useSignal` bridge; it needs a renderer, so
 *     it's covered by tsc + the headless tests here.
 *
 * The fake client models the REAL server contract: an EQL subscription delivers
 * sparse `{ e: id }` rows (the reactive trigger), and `read(id)` hydrates to a
 * full entity. `liveEntities` joins the two, so the adapters surface whole
 * records.
 */
import { describe, expect, test, vi } from 'vitest';
import { effectScope } from 'vue';
import { z } from 'zod';
import { defineType } from '../../src/schema/define.js';
import {
  useEntities as useVueEntities,
} from '../../src/vue/schema-hooks.js';
import { entitiesStore } from '../../src/svelte/schema-hooks.js';
import type {
  EntityData,
  Subscription,
  SubscriptionCallback,
  TrellisDb,
} from '../../src/client/sdk.js';

const Note = defineType('Note', {
  title: z.string(),
  pinned: z.boolean(),
}, { title: 'title' });

/**
 * A client whose `subscribe` captures the callback and emits sparse `{ e }` rows,
 * and whose `read` hydrates from a fixed table. `flush` awaits the hydration
 * microtasks so assertions see the joined result.
 */
function fakeClient(table: Record<string, EntityData>) {
  const subs: Array<{ eql: string; cb: SubscriptionCallback<{ e: string }> }> = [];
  const unsubscribe = vi.fn();
  const client = {
    subscribe: vi.fn(
      (eql: string, cb: SubscriptionCallback<{ e: string }>): Subscription => {
        subs.push({ eql, cb });
        return { unsubscribe };
      },
    ),
    read: vi.fn(async (id: string) => table[id] ?? null),
  } as unknown as TrellisDb;
  const push = (ids: string[]) =>
    subs.at(-1)!.cb(
      ids.map((e) => ({ e })),
      { added: [], updated: [], removed: [] },
    );
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { client, subs, push, flush, unsubscribe };
}

const TABLE: Record<string, EntityData> = {
  'note:1': { id: 'note:1', type: 'Note', title: 'Hello', pinned: true },
  'note:2': { id: 'note:2', type: 'Note', title: 'World', pinned: false },
};

describe('Vue useEntities', () => {
  test('subscribes by type, hydrates ids, tears down on scope stop', async () => {
    const { client, subs, push, flush, unsubscribe } = fakeClient(TABLE);
    const scope = effectScope();

    const list = scope.run(() => useVueEntities(client, Note))!;

    expect(client.subscribe).toHaveBeenCalledOnce();
    expect(subs[0]!.eql).toBe('find ?e where type = "Note"');
    expect(list.value.loading).toBe(true);

    push(['note:1', 'note:2']);
    await flush();
    expect(list.value.loading).toBe(false);
    expect(list.value.data).toEqual([
      { id: 'note:1', type: 'Note', title: 'Hello', pinned: true },
      { id: 'note:2', type: 'Note', title: 'World', pinned: false },
    ]);

    scope.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  test('passes structured where operators into the query', () => {
    const { client, subs } = fakeClient(TABLE);
    const scope = effectScope();
    scope.run(() =>
      useVueEntities(client, Note, {
        where: { pinned: true, order: { gte: 2 } },
      }),
    );
    expect(subs[0]!.eql).toBe(
      'find ?e where type = "Note" and pinned = true and order >= 2',
    );
    scope.stop();
  });
});

describe('Svelte entitiesStore', () => {
  test('is lazy: subscribes on first subscriber, hydrates, disposes on last', async () => {
    const { client, push, flush, unsubscribe } = fakeClient(TABLE);
    const store = entitiesStore(client, Note);

    expect(client.subscribe).not.toHaveBeenCalled();

    const seen: Array<{ data: unknown[]; loading: boolean }> = [];
    const off = store.subscribe((v) => seen.push(v));
    expect(client.subscribe).toHaveBeenCalledOnce();

    push(['note:1']);
    await flush();
    expect(seen.at(-1)).toMatchObject({
      loading: false,
      data: [{ title: 'Hello' }],
    });

    off();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
