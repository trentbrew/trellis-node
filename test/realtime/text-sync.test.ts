/**
 * Cross-client RealtimeText sync — universal-presence "second tab" contract.
 *
 * Two WebSocket relay clients share one in-process hub (same path as production
 * `createRealtimeRelay`). Client A edits via RGA; client B must converge through
 * live `op` frames on `onChange` — no polling.
 *
 * Late-join `state-req` / CRDT convergence is covered in `realtime.test.ts`
 * (MemoryHub); relay persistence tail behavior is in `relay-persistence.test.ts`.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import {
  createRealtimeRelay,
  type StandaloneRealtimeRelay,
} from '../../src/realtime/relay-server.js';
import { RealtimeRoom } from '../../src/realtime/room.js';
import { RealtimeText } from '../../src/realtime/text.js';
import { WebSocketRelayTransport } from '../../src/realtime/websocket-relay-transport.js';

let relay: StandaloneRealtimeRelay;

beforeAll(async () => {
  relay = await createRealtimeRelay({
    port: 0,
    hostname: '127.0.0.1',
    replayGraceMs: 0,
  });
});

afterAll(async () => {
  if (relay) await relay.close();
});

function waitFor<T>(
  fn: () => T | undefined | null | false,
  timeoutMs = 5000,
  intervalMs = 25,
): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const v = fn();
      if (v) {
        resolve(v as T);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitFor timeout'));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function roomUrl(room: string): string {
  return `ws://127.0.0.1:${relay.port}/rt/${encodeURIComponent(room)}`;
}

function joinRelay(peerId: string, room: string): RealtimeRoom {
  return RealtimeRoom.join({
    transport: new WebSocketRelayTransport({
      id: peerId,
      url: roomUrl(room),
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
    }),
    heartbeatMs: 0,
  });
}

async function joinPair(room: string): Promise<{ roomA: RealtimeRoom; roomB: RealtimeRoom }> {
  const roomA = joinRelay('a', room);
  const roomB = joinRelay('b', room);
  await waitFor(() => relay.clientCount(room) >= 2);
  return { roomA, roomB };
}

describe('universal-presence text sync (two relay clients)', () => {
  it('delivers remote inserts to onChange without polling', async () => {
    const room = `text-sync-${Date.now()}-live`;
    const { roomA, roomB } = await joinPair(room);

    const textA = new RealtimeText({ peerId: 'a', room: roomA });
    const textB = new RealtimeText({ peerId: 'b', room: roomB });

    let latest = textB.toString();
    const off = textB.onChange((t) => {
      latest = t;
    });

    textA.insert(0, 'Cross-tab probe');

    await waitFor(() => latest === 'Cross-tab probe');

    expect(textA.toString()).toBe('Cross-tab probe');
    expect(textB.toString()).toBe('Cross-tab probe');

    off();
    textA.dispose();
    textB.dispose();
    roomA.leave();
    roomB.leave();
  });

  it('concurrent inserts from both clients converge', async () => {
    const room = `text-sync-${Date.now()}-concurrent`;
    const { roomA, roomB } = await joinPair(room);

    const textA = new RealtimeText({ peerId: 'a', room: roomA });
    const textB = new RealtimeText({ peerId: 'b', room: roomB });

    textA.insert(0, 'AAA');
    textB.insert(0, 'BBB');

    await waitFor(
      () => textA.toString() === textB.toString() && textA.length === 6,
    );

    const converged = textA.toString();
    expect(converged).toContain('AAA');
    expect(converged).toContain('BBB');

    textA.dispose();
    textB.dispose();
    roomA.leave();
    roomB.leave();
  });

});
