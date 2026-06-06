import { describe, test, expect } from 'vitest';
import {
  joinPresence,
  createPresenceTransport,
} from '../../src/realtime/presence.js';
import { DurableObjectRelayTransport } from '../../src/realtime/durable-object-relay-transport.js';
import { BroadcastChannelTransport } from '../../src/realtime/broadcast-channel-transport.js';
import { MemoryHub } from '../../src/realtime/memory-hub.js';
import type { RealtimeMessage } from '../../src/realtime/types.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

// --------------------------------------------------------------------------
// Mocks
// --------------------------------------------------------------------------

/** In-process BroadcastChannel mesh (cross-tab). */
class MockBroadcastChannel {
  static readonly rooms = new Map<string, Set<MockBroadcastChannel>>();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  private listeners = new Set<(event: { data: unknown }) => void>();

  constructor(readonly name: string) {
    if (!MockBroadcastChannel.rooms.has(name)) {
      MockBroadcastChannel.rooms.set(name, new Set());
    }
    MockBroadcastChannel.rooms.get(name)!.add(this);
  }
  addEventListener(type: 'message', fn: (event: { data: unknown }) => void) {
    if (type === 'message') this.listeners.add(fn);
  }
  postMessage(data: unknown) {
    for (const peer of MockBroadcastChannel.rooms.get(this.name) ?? []) {
      if (peer === this) continue;
      peer.onmessage?.({ data });
      for (const fn of peer.listeners) fn({ data });
    }
  }
  close() {
    MockBroadcastChannel.rooms.get(this.name)?.delete(this);
  }
}

/** WebSocket mesh that auto-opens — stands in for a relay's fan-out. */
class MeshWS {
  static readonly OPEN = 1;
  static readonly peers = new Set<MeshWS>();
  readyState = 0;
  private listeners = new Map<string, Set<(e: unknown) => void>>();

  constructor(_url: string) {
    MeshWS.peers.add(this);
    queueMicrotask(() => {
      this.readyState = MeshWS.OPEN;
      this.emit('open', {});
    });
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
  }
  send(data: string) {
    for (const peer of MeshWS.peers) {
      if (peer === this) continue;
      peer.emit('message', { data });
    }
  }
  close() {
    MeshWS.peers.delete(this);
    this.readyState = 3;
    this.emit('close', {});
  }
  private emit(type: string, e: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

/** Manually-driven socket for deterministic reconnect/buffer tests. */
class ControllableWS {
  static instances: ControllableWS[] = [];
  static reset() {
    ControllableWS.instances = [];
  }
  readyState = 0;
  sent: string[] = [];
  private listeners = new Map<string, Set<(e: unknown) => void>>();

  constructor(readonly url: string) {
    ControllableWS.instances.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.emit('close', {});
  }
  fireOpen() {
    this.readyState = 1;
    this.emit('open', {});
  }
  fireMessage(message: RealtimeMessage) {
    this.emit('message', { data: JSON.stringify(message) });
  }
  private emit(type: string, e: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
  get parsed(): RealtimeMessage[] {
    return this.sent.map((s) => JSON.parse(s) as RealtimeMessage);
  }
}

// --------------------------------------------------------------------------
// Transport selection
// --------------------------------------------------------------------------

describe('createPresenceTransport — intent-based selection', () => {
  test('defaults to BroadcastChannel (local / free) with no relayUrl', () => {
    const t = createPresenceTransport({
      peerId: 'a',
      room: 'r',
      BroadcastChannelImpl: MockBroadcastChannel as never,
    });
    expect(t).toBeInstanceOf(BroadcastChannelTransport);
    t.close();
  });

  test('uses the hosted relay transport when relayUrl is set (sync / paid)', () => {
    ControllableWS.reset();
    const t = createPresenceTransport({
      peerId: 'a',
      room: 'r',
      relayUrl: 'wss://relay.test',
      WebSocketImpl: ControllableWS as never,
    });
    expect(t).toBeInstanceOf(DurableObjectRelayTransport);
    t.close();
  });

  test('an explicit transport overrides relayUrl (escape hatch)', () => {
    const hub = new MemoryHub();
    const injected = hub.connect('a');
    const t = createPresenceTransport({
      peerId: 'a',
      room: 'r',
      relayUrl: 'wss://relay.test',
      transport: injected,
    });
    expect(t).toBe(injected);
  });
});

// --------------------------------------------------------------------------
// joinPresence propagation
// --------------------------------------------------------------------------

describe('joinPresence', () => {
  test('local: two tabs in the same room see each other', () => {
    MockBroadcastChannel.rooms.clear();
    const a = joinPresence({
      peerId: 'a',
      room: 'doc',
      initialPresence: { name: 'A' },
      heartbeatMs: 0,
      BroadcastChannelImpl: MockBroadcastChannel as never,
    });
    const b = joinPresence({
      peerId: 'b',
      room: 'doc',
      initialPresence: { name: 'B' },
      heartbeatMs: 0,
      BroadcastChannelImpl: MockBroadcastChannel as never,
    });

    expect(a.getOthers().map((p) => p.id)).toEqual(['b']);
    expect(b.getOthers().map((p) => p.id)).toEqual(['a']);

    a.setPresence({ cursor: { x: 1, y: 2 } });
    expect(b.getOthers().find((p) => p.id === 'a')?.state.cursor).toEqual({
      x: 1,
      y: 2,
    });

    a.leave();
    b.leave();
  });

  test('local: distinct rooms are isolated', () => {
    MockBroadcastChannel.rooms.clear();
    const a = joinPresence({
      peerId: 'a',
      room: 'doc-1',
      heartbeatMs: 0,
      BroadcastChannelImpl: MockBroadcastChannel as never,
    });
    const b = joinPresence({
      peerId: 'b',
      room: 'doc-2',
      heartbeatMs: 0,
      BroadcastChannelImpl: MockBroadcastChannel as never,
    });
    expect(a.getOthers()).toHaveLength(0);
    expect(b.getOthers()).toHaveLength(0);
    a.leave();
    b.leave();
  });

  test('relay: peers sync through the hosted transport', async () => {
    MeshWS.peers.clear();
    const a = joinPresence({
      peerId: 'a',
      room: 'doc',
      initialPresence: { name: 'A' },
      heartbeatMs: 0,
      relayUrl: 'wss://relay.test',
      WebSocketImpl: MeshWS as never,
    });
    const b = joinPresence({
      peerId: 'b',
      room: 'doc',
      initialPresence: { name: 'B' },
      heartbeatMs: 0,
      relayUrl: 'wss://relay.test',
      WebSocketImpl: MeshWS as never,
    });

    await tick();

    expect(a.getOthers().map((p) => p.id)).toContain('b');
    expect(b.getOthers().map((p) => p.id)).toContain('a');

    a.leave();
    b.leave();
    MeshWS.peers.clear();
  });
});

// --------------------------------------------------------------------------
// DurableObjectRelayTransport — reconnect / buffering
// --------------------------------------------------------------------------

describe('DurableObjectRelayTransport', () => {
  test('builds a room-aware, authed URL', () => {
    ControllableWS.reset();
    new DurableObjectRelayTransport({
      id: 'a',
      url: 'wss://relay.test',
      room: 'doc:42',
      auth: 'tok en',
      WebSocketImpl: ControllableWS as never,
    });
    expect(ControllableWS.instances[0].url).toBe(
      'wss://relay.test/doc%3A42?token=tok%20en',
    );
  });

  test('sends hello on open and flushes buffered frames', () => {
    ControllableWS.reset();
    const t = new DurableObjectRelayTransport({
      id: 'a',
      url: 'wss://relay.test',
      room: 'r',
      WebSocketImpl: ControllableWS as never,
    });
    // Queued before the socket is open.
    t.send({ v: 1, t: 'presence', from: 'a', state: { name: 'A' }, ts: 1 });

    const ws = ControllableWS.instances[0];
    expect(ws.sent).toHaveLength(0); // nothing sent while connecting

    ws.fireOpen();
    const kinds = ws.parsed.map((m) => m.t);
    expect(kinds[0]).toBe('hello'); // re-announce trigger first
    expect(kinds).toContain('presence'); // buffered frame flushed
    t.close();
  });

  test('reconnects after an unexpected close and re-sends hello', async () => {
    ControllableWS.reset();
    const t = new DurableObjectRelayTransport({
      id: 'a',
      url: 'wss://relay.test',
      room: 'r',
      reconnect: { baseDelayMs: 1 },
      WebSocketImpl: ControllableWS as never,
    });

    const ws1 = ControllableWS.instances[0];
    ws1.fireOpen();
    expect(ws1.parsed[0].t).toBe('hello');

    ws1.close(); // transport drop
    await new Promise((r) => setTimeout(r, 10)); // let backoff elapse

    expect(ControllableWS.instances.length).toBe(2);
    const ws2 = ControllableWS.instances[1];
    ws2.fireOpen();
    expect(ws2.parsed[0].t).toBe('hello'); // re-announce on reconnect

    t.close();
  });

  test('does not reconnect after an explicit close()', async () => {
    ControllableWS.reset();
    const t = new DurableObjectRelayTransport({
      id: 'a',
      url: 'wss://relay.test',
      reconnect: { baseDelayMs: 1 },
      WebSocketImpl: ControllableWS as never,
    });
    ControllableWS.instances[0].fireOpen();
    t.close();
    await new Promise((r) => setTimeout(r, 10));
    expect(ControllableWS.instances.length).toBe(1);
  });

  test('caps the offline buffer, dropping oldest frames', () => {
    ControllableWS.reset();
    const t = new DurableObjectRelayTransport({
      id: 'a',
      url: 'wss://relay.test',
      maxPending: 2,
      WebSocketImpl: ControllableWS as never,
    });
    // Three queued while connecting; cap is 2 → oldest dropped.
    for (const ts of [1, 2, 3]) {
      t.send({ v: 1, t: 'presence', from: 'a', state: { n: ts }, ts });
    }
    const ws = ControllableWS.instances[0];
    ws.fireOpen();

    const presenceTs = ws.parsed
      .filter((m) => m.t === 'presence')
      .map((m) => (m as Extract<RealtimeMessage, { t: 'presence' }>).ts);
    expect(presenceTs).toEqual([2, 3]); // frame ts=1 dropped
    t.close();
  });

  test('delivers inbound frames to subscribers', () => {
    ControllableWS.reset();
    const t = new DurableObjectRelayTransport({
      id: 'a',
      url: 'wss://relay.test',
      WebSocketImpl: ControllableWS as never,
    });
    const got: RealtimeMessage[] = [];
    t.onMessage((m) => got.push(m));

    const ws = ControllableWS.instances[0];
    ws.fireOpen();
    ws.fireMessage({ v: 1, t: 'presence', from: 'b', state: { name: 'B' }, ts: 5 });

    expect(got).toHaveLength(1);
    expect(got[0].from).toBe('b');
    t.close();
  });
});
