import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SubscriptionManager } from '../../src/server/realtime.js';
import { TenantPool } from '../../src/server/tenancy.js';

describe('SubscriptionManager.notify', () => {
  it('pushes updates for embed tenants when WS client.tenantId is null', async () => {
    const pool = new TenantPool(mkdtempSync(join(tmpdir(), 'trellis-notify-')));
    const subs = new SubscriptionManager(pool, null, null);
    const sent: string[] = [];

    subs.addClient(
      'c1',
      {
        send(data: string) {
          sent.push(data);
        },
        readyState: 1,
      },
      {
        userId: null,
        tenantId: null,
        roles: [],
        claims: {},
        authenticated: false,
      },
      null,
    );

    await subs.handleMessage(
      'c1',
      JSON.stringify({
        type: 'subscribe',
        id: 'sub_1',
        query: 'find ?e where type = KanbanCard',
        tenantId: 'embed-test-room',
      }),
    );

    const kernel = await pool.preload('embed-test-room');
    await kernel.createEntity(randomUUID(), 'KanbanCard', {
      title: 'Moved',
      status: 'doing',
    });

    sent.length = 0;
    await subs.notify('embed-test-room');

    const dataFrames = sent
      .map((raw) => JSON.parse(raw) as { type?: string; id?: string })
      .filter((msg) => msg.type === 'data' && msg.id === 'sub_1');

    expect(dataFrames.length).toBe(1);
  });
});
