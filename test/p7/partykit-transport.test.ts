import { describe, test, expect, beforeEach } from 'vitest';
import { PartyKitRoomTransport } from '../../src/sync/partykit-transport.js';
import type { SyncMessage } from '../../src/sync/types.js';
import { PROTOCOL_VERSION } from '../../src/sync/types.js';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readyState: 0 | 1 | 2 | 3 = 0;
  onopen: (() => void) | null = null;
  onmessage:
    | ((event: { data: unknown }) => void | Promise<void>)
    | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sent: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  async emit(message: SyncMessage): Promise<void> {
    await this.onmessage?.({ data: JSON.stringify(message) });
  }
}

describe('PartyKitRoomTransport', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  test('sends sync messages to a room websocket and receives room replies', async () => {
    const transport = new PartyKitRoomTransport({
      peerId: 'peer-a',
      roomId: 'project-room',
      roomUrl: 'wss://party.example/project-room',
      WebSocketImpl: FakeWebSocket,
    });
    const received: SyncMessage[] = [];
    transport.onMessage((message) => {
      received.push(message);
    });

    await transport.send('project-room', {
      version: PROTOCOL_VERSION,
      type: 'have',
      peerId: 'peer-a',
      heads: {},
      opCount: 0,
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe('wss://party.example/project-room');
    expect(socket.sent.map((item) => JSON.parse(item))).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: 'have',
        peerId: 'peer-a',
        heads: {},
        opCount: 0,
      },
    ]);

    await socket.emit({
      version: PROTOCOL_VERSION,
      type: 'want',
      peerId: 'project-room',
      wantHashes: [],
    });

    expect(received).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: 'want',
        peerId: 'project-room',
        wantHashes: [],
      },
    ]);
    expect(transport.peers()).toEqual([
      { id: 'project-room', name: 'project-room' },
    ]);
  });

  test('only sends through the configured room peer', async () => {
    const transport = new PartyKitRoomTransport({
      peerId: 'peer-a',
      roomId: 'project-room',
      roomUrl: 'wss://party.example/project-room',
      WebSocketImpl: FakeWebSocket,
    });

    await expect(
      transport.send('peer-b', {
        version: PROTOCOL_VERSION,
        type: 'want',
        peerId: 'peer-a',
        wantHashes: [],
      }),
    ).rejects.toThrow('can only send to project-room');
  });

  test('reconnects after unexpected close and calls onReconnect', async () => {
    let reconnects = 0;
    const transport = new PartyKitRoomTransport({
      peerId: 'peer-a',
      roomId: 'room',
      roomUrl: 'wss://party.example/room',
      WebSocketImpl: FakeWebSocket,
      reconnect: { baseDelayMs: 10, maxDelayMs: 50 },
      onReconnect: async () => {
        reconnects++;
      },
    });

    await transport.connect();
    const socket = FakeWebSocket.instances[0];
    socket.onclose?.();

    await new Promise((r) => setTimeout(r, 80));

    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
    expect(reconnects).toBeGreaterThan(0);
    transport.close();
  });
});
