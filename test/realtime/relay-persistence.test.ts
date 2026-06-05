import { describe, test, expect } from 'vitest';
import { RelayPersistence } from '../../src/realtime/relay-persistence.js';

describe('RelayPersistence', () => {
  test('retains chat tail and latest presence per peer', () => {
    const p = new RelayPersistence({ maxChat: 2 });

    p.record({
      v: 1,
      t: 'presence',
      from: 'a',
      state: { name: 'Ada' },
      ts: 1,
    });
    p.record({
      v: 1,
      t: 'msg',
      from: 'a',
      channel: 'chat',
      event: 'message',
      payload: { text: 'one' },
      ts: 2,
    });
    p.record({
      v: 1,
      t: 'msg',
      from: 'b',
      channel: 'chat',
      event: 'message',
      payload: { text: 'two' },
      ts: 3,
    });
    p.record({
      v: 1,
      t: 'msg',
      from: 'a',
      channel: 'chat',
      event: 'message',
      payload: { text: 'three' },
      ts: 4,
    });
    p.record({
      v: 1,
      t: 'presence',
      from: 'a',
      state: { name: 'Ada', cursor: { x: 1, y: 0 } },
      ts: 5,
    });

    const replay = p.buildReplay();
    const chat = replay.filter((m) => m.t === 'msg');
    expect(chat).toHaveLength(2);
    expect(chat.map((m) => (m as { payload: { text: string } }).payload.text)).toEqual([
      'two',
      'three',
    ]);

    const presence = replay.find((m) => m.t === 'presence' && m.from === 'a');
    expect(presence && presence.t === 'presence' && presence.state).toMatchObject({
      name: 'Ada',
      cursor: { x: 1, y: 0 },
    });
  });

  test('chat is a grow-only set: duplicate ids are recorded once', () => {
    const p = new RelayPersistence();
    const msg = {
      v: 1 as const,
      t: 'msg' as const,
      from: 'a',
      channel: 'chat',
      event: 'message',
      payload: { text: 'hi' },
      ts: 2,
      id: 'a:abc',
    };

    // Same id arriving twice (e.g. a reconnect re-sending its tail) is idempotent.
    p.record(msg);
    p.record({ ...msg, ts: 9 }); // same id, different ts — still one member

    const chat = p.buildReplay().filter((m) => m.t === 'msg');
    expect(chat).toHaveLength(1);
    expect((chat[0] as { id?: string }).id).toBe('a:abc');
  });

  test('replays equal-timestamp chat in a deterministic order', () => {
    const p = new RelayPersistence();
    const base = {
      v: 1 as const,
      t: 'msg' as const,
      channel: 'chat',
      event: 'message',
      ts: 5,
    };
    p.record({ ...base, from: 'b', payload: { text: 'two' }, id: 'b:2' });
    p.record({ ...base, from: 'a', payload: { text: 'one' }, id: 'a:1' });

    const ids = p
      .buildReplay()
      .filter((m) => m.t === 'msg')
      .map((m) => (m as { id?: string }).id);
    expect(ids).toEqual(['a:1', 'b:2']);
  });

  test('prefers text snapshot over op tail', () => {
    const p = new RelayPersistence();
    p.record({
      v: 1,
      t: 'msg',
      from: 'a',
      channel: 'text',
      event: 'op',
      payload: [{ op: 'ins', id: '1@a', ch: 'x', after: null }],
      ts: 1,
    });
    p.record({
      v: 1,
      t: 'msg',
      from: 'b',
      channel: 'text',
      event: 'state',
      payload: [{ id: '1@a', ch: 'hello', after: null, deleted: false }],
      ts: 2,
    });

    const replay = p.buildReplay().filter((m) => m.t === 'msg' && m.channel === 'text');
    expect(replay).toHaveLength(1);
    expect(replay[0].event).toBe('state');
  });
});
