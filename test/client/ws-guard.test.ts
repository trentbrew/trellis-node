import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TrellisDb } from '../../src/client/sdk.js';

describe('TrellisDb WebSocket in-flight guard', () => {
  let socketsCreated = 0;

  class MockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = MockWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    send = vi.fn();
    close = vi.fn(() => {
      this.readyState = 3;
      this.onclose?.();
    });

    constructor(public url: string) {
      socketsCreated++;
      queueMicrotask(() => {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
      });
    }
  }

  beforeEach(() => {
    socketsCreated = 0;
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens one socket when many subscribe() run before connect completes', async () => {
    const db = new TrellisDb({ url: 'http://localhost:3920', apiKey: 'test' });

    const subs = Array.from({ length: 9 }, () =>
      db.subscribe('SELECT ?e WHERE { }', () => {}),
    );

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(socketsCreated).toBe(1);

    for (const sub of subs) {
      sub.unsubscribe();
    }
    db.disconnect();
  });
});
