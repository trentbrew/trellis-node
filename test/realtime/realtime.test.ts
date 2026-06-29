import { describe, test, expect } from 'vitest';
import { BroadcastChannelTransport } from '../../src/realtime/broadcast-channel-transport.js';
import { WebSocketRelayTransport } from '../../src/realtime/websocket-relay-transport.js';
import { MemoryHub } from '../../src/realtime/memory-hub.js';
import { RealtimeRoom } from '../../src/realtime/room.js';
import { RealtimeText } from '../../src/realtime/text.js';
import type { PresenceState } from '../../src/realtime/types.js';

/** In-process BroadcastChannel mesh for cross-tab transport tests. */
class MockBroadcastChannel {
  static readonly rooms = new Map<string, Set<MockBroadcastChannel>>();
  readonly name: string;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  private listeners = new Set<(event: { data: unknown }) => void>();

  constructor(name: string) {
    this.name = name;
    if (!MockBroadcastChannel.rooms.has(name)) {
      MockBroadcastChannel.rooms.set(name, new Set());
    }
    MockBroadcastChannel.rooms.get(name)!.add(this);
  }

  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void {
    if (type === 'message') this.listeners.add(listener);
  }

  postMessage(data: unknown): void {
    for (const peer of MockBroadcastChannel.rooms.get(this.name) ?? []) {
      if (peer === this) continue;
      const event = { data };
      peer.onmessage?.(event);
      for (const listener of peer.listeners) listener(event);
    }
  }

  close(): void {
    MockBroadcastChannel.rooms.get(this.name)?.delete(this);
  }
}

interface DemoPresence extends PresenceState {
  name: string;
  color?: string;
  cursor?: { x: number; y: number };
}

function joinRoom(hub: MemoryHub, id: string, presence: DemoPresence) {
  return RealtimeRoom.join<DemoPresence>({
    transport: hub.connect(id),
    initialPresence: presence,
    heartbeatMs: 0,
  });
}

describe('RealtimeRoom presence', () => {
  test('peers discover each other on join', () => {
    const hub = new MemoryHub();
    const a = joinRoom(hub, 'a', { name: 'Ada', color: '#f00' });
    const b = joinRoom(hub, 'b', { name: 'Bob', color: '#00f' });

    const aOthers = a.getOthers();
    const bOthers = b.getOthers();

    expect(aOthers.map((p) => p.id)).toEqual(['b']);
    expect(bOthers.map((p) => p.id)).toEqual(['a']);
    expect(aOthers[0].state.name).toBe('Bob');
    expect(bOthers[0].state.name).toBe('Ada');

    // Self is always present and listed first.
    expect(a.getPresence()[0].self).toBe(true);
    expect(a.getPresence()[0].id).toBe('a');

    a.leave();
    b.leave();
  });

  test('late joiner sees existing peers via hello re-announce', () => {
    const hub = new MemoryHub();
    const a = joinRoom(hub, 'a', { name: 'Ada' });
    const b = joinRoom(hub, 'b', { name: 'Bob' });
    const c = joinRoom(hub, 'c', { name: 'Cleo' });

    expect(c.getOthers().map((p) => p.id).sort()).toEqual(['a', 'b']);

    a.leave();
    b.leave();
    c.leave();
  });

  test('later presence heartbeats update remote state (sender ts ordering)', () => {
    const hub = new MemoryHub();
    const a = joinRoom(hub, 'a', { name: 'Ada', cursor: { x: 0, y: 0 } });
    const b = joinRoom(hub, 'b', { name: 'Bob' });

    a.setPresence({ cursor: { x: 0.5, y: 0.25 } });
    expect(b.getOthers().find((p) => p.id === 'a')?.state.cursor).toEqual({
      x: 0.5,
      y: 0.25,
    });

    a.setPresence({ cursor: { x: 0.9, y: 0.1 } });
    expect(b.getOthers().find((p) => p.id === 'a')?.state.cursor).toEqual({
      x: 0.9,
      y: 0.1,
    });

    a.leave();
    b.leave();
  });

  test('setPresence propagates to other peers', () => {
    const hub = new MemoryHub();
    const a = joinRoom(hub, 'a', { name: 'Ada' });
    const b = joinRoom(hub, 'b', { name: 'Bob' });

    a.setPresence({ cursor: { x: 0.5, y: 0.25 } });

    const seen = b.getOthers().find((p) => p.id === 'a');
    expect(seen?.state.cursor).toEqual({ x: 0.5, y: 0.25 });

    a.leave();
    b.leave();
  });

  test('leave removes a peer for everyone', () => {
    const hub = new MemoryHub();
    const a = joinRoom(hub, 'a', { name: 'Ada' });
    const b = joinRoom(hub, 'b', { name: 'Bob' });

    a.leave();
    expect(b.getOthers()).toHaveLength(0);

    b.leave();
  });

  test('buffers relay replay until a subscriber is registered', () => {
    const hub = new MemoryHub();
    const aT = hub.connect('a');
    const relayT = hub.connect('relay');

    const a = RealtimeRoom.join({
      transport: aT,
      initialPresence: { name: 'Ada' },
      heartbeatMs: 0,
    });

    relayT.send({
      v: 1,
      t: 'replay',
      from: 'relay',
      messages: [
        {
          v: 1,
          t: 'msg',
          from: 'b',
          channel: 'chat',
          event: 'message',
          payload: { text: 'history' },
          ts: 1,
        },
      ],
    });

    const got: unknown[] = [];
    a.on('chat', (e) => got.push(e.payload));
    expect(got).toEqual([{ text: 'history' }]);

    a.leave();
  });

  test('flushes replay when it arrives after subscribers exist', async () => {
    const hub = new MemoryHub();
    const aT = hub.connect('a');
    const relayT = hub.connect('relay');

    const a = RealtimeRoom.join({
      transport: aT,
      initialPresence: { name: 'Ada' },
      heartbeatMs: 0,
    });

    const got: unknown[] = [];
    a.on('chat', (e) => got.push(e.payload));

    relayT.send({
      v: 1,
      t: 'replay',
      from: 'relay',
      messages: [
        {
          v: 1,
          t: 'msg',
          from: 'b',
          channel: 'chat',
          event: 'message',
          payload: { text: 'after subscribe' },
          ts: 1,
        },
      ],
    });

    expect(got).toEqual([{ text: 'after subscribe' }]);
    a.leave();
  });

  test('dedupes replayed broadcasts by id (grow-only, idempotent)', () => {
    const hub = new MemoryHub();
    const aT = hub.connect('a');
    const relayT = hub.connect('relay');

    const a = RealtimeRoom.join({
      transport: aT,
      initialPresence: { name: 'Ada' },
      heartbeatMs: 0,
    });

    const got: unknown[] = [];
    a.on('chat', (e) => got.push(e.payload));

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

    // Same id delivered twice (e.g. live frame then a relay replay) lands once.
    relayT.send({ v: 1, t: 'replay', from: 'relay', messages: [frame] });
    relayT.send({ v: 1, t: 'replay', from: 'relay', messages: [frame] });

    expect(got).toEqual([{ text: 'history' }]);
    a.leave();
  });

  test('broadcast returns an id and dedupes its own echo', () => {
    const hub = new MemoryHub();
    const aT = hub.connect('a');
    const relayT = hub.connect('relay');

    const a = RealtimeRoom.join({
      transport: aT,
      initialPresence: { name: 'Ada' },
      heartbeatMs: 0,
    });

    const got: unknown[] = [];
    a.on('chat', (e) => got.push(e.id));

    const id = a.broadcast('chat', 'message', { text: 'mine' });
    expect(typeof id).toBe('string');

    // An echo of our own message (id we already emitted) is dropped.
    relayT.send({
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
          payload: { text: 'mine' },
          ts: 1,
          id,
        },
      ],
    });

    expect(got).toEqual([]); // never delivered to our own handler
    a.leave();
  });

  test('replay of own presence does not duplicate self in peer list', () => {
    const hub = new MemoryHub();
    const aT = hub.connect('a');
    const relayT = hub.connect('relay');

    const a = RealtimeRoom.join({
      transport: aT,
      initialPresence: { name: 'Ada' },
      heartbeatMs: 0,
    });

    relayT.send({
      v: 1,
      t: 'replay',
      from: 'relay',
      messages: [
        {
          v: 1,
          t: 'presence',
          from: 'a',
          state: { name: 'Ada' },
          ts: 1,
        },
      ],
    });

    expect(a.getPresence().map((p) => p.id)).toEqual(['a']);
    expect(a.getPresence().filter((p) => p.id === 'a')).toHaveLength(1);

    a.leave();
  });

  test('onPresence fires on changes', () => {
    const hub = new MemoryHub();
    const a = joinRoom(hub, 'a', { name: 'Ada' });

    const snapshots: number[] = [];
    const unsub = a.onPresence((peers) => snapshots.push(peers.length));

    const b = joinRoom(hub, 'b', { name: 'Bob' });
    expect(snapshots[snapshots.length - 1]).toBe(2);

    b.leave();
    expect(snapshots[snapshots.length - 1]).toBe(1);

    unsub();
    a.leave();
  });
});

/** Minimal WebSocket mesh for relay transport tests. */
class MockWebSocket {
  static readonly OPEN = 1;
  static readonly peers = new Set<MockWebSocket>();
  readyState = 0;
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(_url: string) {
    MockWebSocket.peers.add(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.emit('open', {});
    });
  }

  addEventListener(type: string, fn: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  send(data: string): void {
    for (const peer of MockWebSocket.peers) {
      if (peer === this) continue;
      peer.emit('message', { data });
    }
  }

  close(): void {
    MockWebSocket.peers.delete(this);
    this.readyState = 3;
  }

  private emit(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
}

describe('WebSocketRelayTransport', () => {
  test('relays chat across two logical clients', async () => {
    MockWebSocket.peers.clear();
    const Impl = MockWebSocket as unknown as typeof WebSocket;

    const a = RealtimeRoom.join({
      transport: new WebSocketRelayTransport({
        id: 'firefox',
        url: 'ws://test/rt',
        WebSocketImpl: Impl,
      }),
      initialPresence: { name: 'Firefox', color: '#f00' },
      heartbeatMs: 0,
    });
    const b = RealtimeRoom.join({
      transport: new WebSocketRelayTransport({
        id: 'chrome',
        url: 'ws://test/rt',
        WebSocketImpl: Impl,
      }),
      initialPresence: { name: 'Chrome', color: '#00f' },
      heartbeatMs: 0,
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(a.getOthers().map((p) => p.id)).toContain('chrome');
    expect(b.getOthers().map((p) => p.id)).toContain('firefox');

    const got: unknown[] = [];
    b.on('chat', (e) => got.push(e.payload));
    a.broadcast('chat', 'message', { text: 'hi browsers' });
    expect(got).toEqual([{ text: 'hi browsers' }]);

    a.leave();
    b.leave();
    MockWebSocket.peers.clear();
  });
});

describe('BroadcastChannelTransport', () => {
  test('two tabs on the same channel exchange presence and chat', () => {
    MockBroadcastChannel.rooms.clear();
    const Impl = MockBroadcastChannel as unknown as new (
      name: string,
    ) => MockBroadcastChannel;

    const a = RealtimeRoom.join({
      transport: new BroadcastChannelTransport({
        id: 'tab-a',
        channel: 'trellis-rt:live',
        BroadcastChannelImpl: Impl,
      }),
      initialPresence: { name: 'Tab A', color: '#f00' },
      heartbeatMs: 0,
    });
    const b = RealtimeRoom.join({
      transport: new BroadcastChannelTransport({
        id: 'tab-b',
        channel: 'trellis-rt:live',
        BroadcastChannelImpl: Impl,
      }),
      initialPresence: { name: 'Tab B', color: '#0f0' },
      heartbeatMs: 0,
    });

    expect(a.getOthers().map((p) => p.id)).toEqual(['tab-b']);
    expect(b.getOthers().map((p) => p.id)).toEqual(['tab-a']);

    const received: unknown[] = [];
    b.on('chat', (e) => received.push(e.payload));
    a.broadcast('chat', 'message', { text: 'cross-tab' });
    expect(received).toEqual([{ text: 'cross-tab' }]);

    a.setPresence({ cursor: { x: 1, y: 0 } });
    expect(b.getOthers().find((p) => p.id === 'tab-a')?.state.cursor).toEqual({
      x: 1,
      y: 0,
    });

    a.leave();
    b.leave();
  });
});

describe('RealtimeRoom broadcast', () => {
  test('chat-style broadcast reaches other peers only', () => {
    const hub = new MemoryHub();
    const a = joinRoom(hub, 'a', { name: 'Ada' });
    const b = joinRoom(hub, 'b', { name: 'Bob' });

    const aReceived: unknown[] = [];
    const bReceived: unknown[] = [];
    a.on('chat', (e) => aReceived.push(e.payload));
    b.on('chat', (e) => bReceived.push(e.payload));

    a.broadcast('chat', 'message', { text: 'hello' });

    expect(bReceived).toEqual([{ text: 'hello' }]);
    expect(aReceived).toEqual([]); // no self-echo

    a.leave();
    b.leave();
  });
});

describe('RealtimeText CRDT', () => {
  test('converges under concurrent inserts regardless of order', () => {
    const a = new RealtimeText({ peerId: 'a' });
    const b = new RealtimeText({ peerId: 'b' });

    const opsA = a.insert(0, 'AAA');
    const opsB = b.insert(0, 'BBB');

    // Cross-apply in opposite orders.
    a.applyOps(opsB);
    b.applyOps(opsA);

    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).toContain('AAA');
    expect(a.toString()).toContain('BBB');
    expect(a.length).toBe(6);
  });

  test('delete is idempotent and commutative', () => {
    const a = new RealtimeText({ peerId: 'a' });
    const b = new RealtimeText({ peerId: 'b' });

    const ins = a.insert(0, 'hello');
    b.applyOps(ins);

    const del = a.delete(0, 1); // remove 'h'
    b.applyOps(del);
    b.applyOps(del); // duplicate delivery

    expect(a.toString()).toBe('ello');
    expect(b.toString()).toBe('ello');
  });

  test('room-bound editors sync edits live', () => {
    const hub = new MemoryHub();
    const roomA = RealtimeRoom.join({
      transport: hub.connect('a'),
      heartbeatMs: 0,
    });
    const roomB = RealtimeRoom.join({
      transport: hub.connect('b'),
      heartbeatMs: 0,
    });

    const textA = new RealtimeText({ peerId: 'a', room: roomA });
    const textB = new RealtimeText({ peerId: 'b', room: roomB });

    textA.insert(0, 'shared');
    expect(textB.toString()).toBe('shared');

    textB.insert(6, '!');
    expect(textA.toString()).toBe('shared!');

    textA.dispose();
    textB.dispose();
    roomA.leave();
    roomB.leave();
  });

  test('late-joining editor receives full document via state sync', () => {
    const hub = new MemoryHub();
    const roomA = RealtimeRoom.join({
      transport: hub.connect('a'),
      heartbeatMs: 0,
    });
    const textA = new RealtimeText({ peerId: 'a', room: roomA });
    textA.insert(0, 'preexisting');

    const roomB = RealtimeRoom.join({
      transport: hub.connect('b'),
      heartbeatMs: 0,
    });
    const textB = new RealtimeText({ peerId: 'b', room: roomB });

    // textB's constructor broadcast 'state-req'; textA replied synchronously.
    expect(textB.toString()).toBe('preexisting');

    textA.dispose();
    textB.dispose();
    roomA.leave();
    roomB.leave();
  });
});
