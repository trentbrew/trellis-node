/**
 * TRL-9 — liveEntity read-first + subscription updates.
 */
import { describe, expect, test, vi } from 'vitest';
import { liveEntity } from '../../src/client/live.js';
import type {
  EntityData,
  Subscription,
  SubscriptionCallback,
  TrellisDb,
} from '../../src/client/sdk.js';

const TABLE: Record<string, EntityData> = {
  'note:1': { id: 'note:1', type: 'Note', title: 'Hello', pinned: true },
  'note:2': { id: 'note:2', type: 'Note', title: 'World', pinned: false },
};

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

  return { client, subs, push, unsubscribe };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('liveEntity', () => {
  test('read-first then stays live via type subscription', async () => {
    const { client, subs, push, unsubscribe } = fakeClient(TABLE);
    const res = liveEntity(client, 'Note', 'note:1');
    const stop = res.start();

    expect(client.read).toHaveBeenCalledWith('note:1');
    await flush();
    expect(res.signal.peek().loading).toBe(false);
    expect(res.signal.peek().data).toMatchObject({ title: 'Hello' });

    expect(client.subscribe).toHaveBeenCalledOnce();
    expect(subs[0]!.eql).toBe('find ?e where type = "Note"');

    push(['note:1', 'note:2']);
    await flush();
    expect(res.signal.peek().data).toMatchObject({ title: 'Hello' });

    TABLE['note:1'] = {
      ...TABLE['note:1']!,
      title: 'Updated',
    };
    push(['note:1', 'note:2']);
    await flush();
    expect(res.signal.peek().data?.title).toBe('Updated');

    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  test('null id is idle without network', () => {
    const { client } = fakeClient(TABLE);
    const res = liveEntity(client, 'Note', null);
    const stop = res.start();
    expect(client.read).not.toHaveBeenCalled();
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(res.signal.peek()).toMatchObject({
      data: null,
      loading: false,
      error: null,
    });
    stop();
  });
});
