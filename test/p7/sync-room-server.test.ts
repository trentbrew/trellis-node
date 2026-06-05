import { describe, test, expect } from 'vitest';
import { SyncRoomServer } from '../../src/sync/sync-room-server.js';
import type { SyncMessage } from '../../src/sync/types.js';
import { PROTOCOL_VERSION } from '../../src/sync/types.js';

describe('SyncRoomServer', () => {
  test('sends welcome snapshot on connect', async () => {
    const server = new SyncRoomServer({
      roomId: 'room',
      welcomeSnapshot: true,
      welcomeSnapshotMaxOps: 50,
    });

    const received: SyncMessage[] = [];
    await server.connect({
      peerId: 'peer-a',
      send(message) {
        received.push(message);
      },
    });

    expect(received.some((m) => m.type === 'snapshot')).toBe(true);
    const snap = received.find((m) => m.type === 'snapshot');
    expect(snap?.type).toBe('snapshot');
    if (snap?.type === 'snapshot') {
      expect(snap.truncated).toBe(false);
      expect(snap.opCount).toBe(0);
    }
  });

  test('routes have/ops between peers', async () => {
    const server = new SyncRoomServer({
      roomId: 'room',
      welcomeSnapshot: false,
    });

    const inboxA: SyncMessage[] = [];
    const inboxB: SyncMessage[] = [];

    await server.connect({
      peerId: 'peer-a',
      send(m) {
        inboxA.push(m);
      },
    });
    await server.connect({
      peerId: 'peer-b',
      send(m) {
        inboxB.push(m);
      },
    });

    await server.handleMessage('peer-a', {
      version: PROTOCOL_VERSION,
      type: 'have',
      peerId: 'peer-a',
      heads: {},
      opCount: 0,
    });

    expect(inboxA.some((m) => m.type === 'want')).toBe(true);
  });
});
