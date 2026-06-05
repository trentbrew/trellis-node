import { describe, test, expect } from 'vitest';
import { MemoryHub } from '../../src/realtime/memory-hub.js';
import { RealtimeRoom } from '../../src/realtime/room.js';
import {
  PersistentChannel,
  type ChannelRecord,
  type ChannelStore,
} from '../../src/realtime/persistent-channel.js';

/** In-memory store that survives across "refresh" (new room) like localStorage. */
function memStore<T = unknown>(
  initial: ChannelRecord<T>[] = [],
): ChannelStore<T> & { dump: () => ChannelRecord<T>[] } {
  let data: ChannelRecord<T>[] = [...initial];
  return {
    load: () => data,
    save: (r) => {
      data = [...r];
    },
    dump: () => data,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function join(hub: MemoryHub, id: string) {
  return RealtimeRoom.join({
    transport: hub.connect(id),
    initialPresence: { name: id },
    heartbeatMs: 0,
  });
}

type Chat = { text: string };

describe('PersistentChannel', () => {
  test('send records optimistically, persists, and assigns an id', async () => {
    const hub = new MemoryHub();
    const room = join(hub, 'a');
    const store = memStore<Chat>();

    const chat = PersistentChannel.create<Chat>(room, 'chat', {
      store,
      now: () => 100,
    });

    const id = chat.send({ text: 'hello' });
    expect(typeof id).toBe('string');
    expect(chat.snapshot().map((m) => m.payload.text)).toEqual(['hello']);
    await tick();
    expect(store.dump().map((m) => m.payload.text)).toEqual(['hello']);

    chat.dispose();
    room.leave();
  });

  test('orders messages by (ts, id) regardless of arrival order', async () => {
    const hub = new MemoryHub();
    const a = join(hub, 'a');
    const b = join(hub, 'b');

    const chatA = PersistentChannel.create<Chat>(a, 'chat');
    const chatB = PersistentChannel.create<Chat>(b, 'chat');

    // b sends two; a sends one in between (by timestamp).
    chatB.send({ text: 'first' });
    chatA.send({ text: 'middle' });
    chatB.send({ text: 'last' });
    await tick();

    const texts = chatA.snapshot().map((m) => m.payload.text);
    expect(texts).toEqual(['first', 'middle', 'last']);

    chatA.dispose();
    chatB.dispose();
    a.leave();
    b.leave();
  });

  test('dedupes a replayed message by id (grow-only, idempotent)', () => {
    const hub = new MemoryHub();
    const a = join(hub, 'a');
    const relay = hub.connect('relay');

    const chat = PersistentChannel.create<Chat>(a, 'chat');

    const frame = {
      v: 1 as const,
      t: 'msg' as const,
      from: 'b',
      channel: 'chat',
      event: 'message',
      payload: { text: 'history' },
      ts: 1,
      id: 'b:1',
    };
    relay.send({ v: 1, t: 'replay', from: 'relay', messages: [frame] });
    relay.send({ v: 1, t: 'replay', from: 'relay', messages: [frame] });

    expect(chat.snapshot().map((m) => m.payload.text)).toEqual(['history']);
    chat.dispose();
    a.leave();
  });

  test('hydrates from the store on construct (survives refresh)', async () => {
    const store = memStore<Chat>();

    // Session 1: send, then "close the tab".
    const hub1 = new MemoryHub();
    const room1 = join(hub1, 'a');
    const chat1 = PersistentChannel.create<Chat>(room1, 'chat', {
      store,
      now: () => 1,
    });
    chat1.send({ text: 'persisted' });
    await tick();
    chat1.dispose();
    room1.leave();

    // Session 2: fresh room + channel, same store → message is restored.
    const hub2 = new MemoryHub();
    const room2 = join(hub2, 'a');
    const chat2 = PersistentChannel.create<Chat>(room2, 'chat', { store });
    await tick();

    expect(chat2.snapshot().map((m) => m.payload.text)).toEqual(['persisted']);
    chat2.dispose();
    room2.leave();
  });

  test('does not double-count a cached message echoed by relay replay', async () => {
    // Cache already holds id 'x'; a replay delivers the same id.
    const store = memStore<Chat>([
      { id: 'x', from: 'a', ts: 1, payload: { text: 'once' } },
    ]);
    const hub = new MemoryHub();
    const a = join(hub, 'a');
    const relay = hub.connect('relay');

    const chat = PersistentChannel.create<Chat>(a, 'chat', { store });
    await tick();

    relay.send({
      v: 1,
      t: 'replay',
      from: 'relay',
      messages: [
        {
          v: 1,
          t: 'msg',
          from: 'a',
          channel: 'chat',
          event: 'message',
          payload: { text: 'once' },
          ts: 1,
          id: 'x',
        },
      ],
    });

    expect(chat.snapshot()).toHaveLength(1);
    chat.dispose();
    a.leave();
  });

  test('caps the set to the most recent `max`', () => {
    const hub = new MemoryHub();
    const room = join(hub, 'a');
    let t = 0;
    const chat = PersistentChannel.create<Chat>(room, 'chat', {
      max: 2,
      now: () => ++t,
    });

    chat.send({ text: '1' });
    chat.send({ text: '2' });
    chat.send({ text: '3' });

    expect(chat.snapshot().map((m) => m.payload.text)).toEqual(['2', '3']);
    chat.dispose();
    room.leave();
  });

  test('ignores non-message events (e.g. typing)', () => {
    const hub = new MemoryHub();
    const a = join(hub, 'a');
    const b = join(hub, 'b');
    const chatA = PersistentChannel.create<Chat>(a, 'chat');

    b.broadcast('chat', 'typing', { typing: true });

    expect(chatA.snapshot()).toHaveLength(0);
    chatA.dispose();
    a.leave();
    b.leave();
  });
});
