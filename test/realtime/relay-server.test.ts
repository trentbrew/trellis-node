import { afterAll, describe, expect, it } from 'vitest';
import {
  createRealtimeRelay,
  type StandaloneRealtimeRelay,
} from '../../src/realtime/relay-server.js';

describe('createRealtimeRelay health', () => {
  let relay: StandaloneRealtimeRelay;

  afterAll(async () => {
    if (relay) await relay.close();
  });

  it('serves /health with CORS for browser probes', async () => {
    relay = await createRealtimeRelay({
      port: 0,
      hostname: '127.0.0.1',
    });

    const res = await fetch(`http://127.0.0.1:${relay.port}/health`, {
      headers: { Origin: 'http://localhost:3000' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    await expect(res.json()).resolves.toEqual({ ok: true, relay: '/rt' });
  });
});
