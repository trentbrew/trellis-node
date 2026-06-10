import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  UsageMeter,
  sampleTenantStorage,
  resolveUsageTenantId,
  verifyAdminKey,
  dayKey,
} from '../../src/server/usage-meter.js';
import { TenantPool } from '../../src/server/tenancy.js';
import { SubscriptionManager } from '../../src/server/realtime.js';

describe('UsageMeter', () => {
  const fixedNow = new Date('2026-06-09T12:00:00.000Z');

  it('increments graph_io and egress per tenant/day', () => {
    const meter = new UsageMeter({ now: () => fixedNow });
    meter.recordGraphIo('tenant-a', 3);
    meter.recordEgress('tenant-a', 1024);

    const usage = meter.getUsage('tenant-a');
    expect(usage.day).toBe('2026-06-09');
    expect(usage.meters.graph_io).toBe(3);
    expect(usage.meters.egress_bytes).toBe(1024);
    expect(usage.meters.storage_bytes).toBe(0);
  });

  it('isolates tenants and day buckets', () => {
    let day = 0;
    const meter = new UsageMeter({
      now: () => new Date(Date.UTC(2026, 5, 9 + day)),
    });

    meter.recordGraphIo('t1');
    day = 1;
    meter.recordGraphIo('t1', 2);
    meter.recordGraphIo('t2');

    expect(meter.getUsage('t1', '2026-06-09').meters.graph_io).toBe(1);
    expect(meter.getUsage('t1', '2026-06-10').meters.graph_io).toBe(2);
    expect(meter.getUsage('t2', '2026-06-10').meters.graph_io).toBe(1);
    expect(meter.listDays('t1')).toEqual(['2026-06-09', '2026-06-10']);
  });

  it('sets storage gauge from sampler (not cumulative)', () => {
    const meter = new UsageMeter({ now: () => fixedNow });
    meter.recordStorage('default', 500);
    meter.recordStorage('default', 800);

    expect(meter.getUsage('default').meters.storage_bytes).toBe(800);
    expect(meter.getUsage('default').storageSampledAt).toBeDefined();
  });

  it('resolves null tenant to default', () => {
    expect(resolveUsageTenantId(null)).toBe('default');
    expect(resolveUsageTenantId(undefined)).toBe('default');
  });

  it('formats day keys in UTC', () => {
    expect(dayKey(new Date('2026-06-09T23:59:59.000Z'))).toBe('2026-06-09');
  });
});

describe('sampleTenantStorage', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'turtledb-meter-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('sums sqlite file and blobs directory', () => {
    const pool = new TenantPool(dir);
    const sqlitePath = pool.dbFilePath('default');
    writeFileSync(sqlitePath, Buffer.alloc(2048));

    const blobsDir = join(dir, 'blobs');
    mkdirSync(blobsDir, { recursive: true });
    writeFileSync(join(blobsDir, 'a.bin'), Buffer.alloc(512));
    writeFileSync(join(blobsDir, 'b.bin'), Buffer.alloc(256));

    expect(sampleTenantStorage(pool, null)).toBe(2048 + 512 + 256);
  });

  it('samples via UsageMeter.sampleStorage', () => {
    const pool = new TenantPool(dir);
    writeFileSync(pool.dbFilePath('acme'), Buffer.alloc(100));
    const meter = new UsageMeter({ now: () => new Date('2026-06-09T00:00:00Z') });

    const bytes = meter.sampleStorage(pool, 'acme');
    expect(bytes).toBe(100);
    expect(meter.getUsage('acme').meters.storage_bytes).toBe(100);
  });
});

describe('verifyAdminKey', () => {
  const prev = process.env.TURTLEDB_ADMIN_KEY;

  afterEach(() => {
    if (prev === undefined) delete process.env.TURTLEDB_ADMIN_KEY;
    else process.env.TURTLEDB_ADMIN_KEY = prev;
  });

  it('accepts Bearer and X-Turtledb-Admin-Key headers', () => {
    process.env.TURTLEDB_ADMIN_KEY = 'secret-admin';

    expect(
      verifyAdminKey(
        new Request('http://localhost/admin/usage', {
          headers: { Authorization: 'Bearer secret-admin' },
        }),
      ),
    ).toBe(true);

    expect(
      verifyAdminKey(
        new Request('http://localhost/admin/usage', {
          headers: { 'X-Turtledb-Admin-Key': 'secret-admin' },
        }),
      ),
    ).toBe(true);

    expect(
      verifyAdminKey(
        new Request('http://localhost/admin/usage', {
          headers: { Authorization: 'Bearer wrong' },
        }),
      ),
    ).toBe(false);
  });

  it('returns false when admin key is unset', () => {
    delete process.env.TURTLEDB_ADMIN_KEY;
    expect(
      verifyAdminKey(
        new Request('http://localhost/admin/usage', {
          headers: { Authorization: 'Bearer anything' },
        }),
      ),
    ).toBe(false);
  });
});

describe('SubscriptionManager egress metering', () => {
  it('records egress bytes on WS send', async () => {
    const meter = new UsageMeter({
      now: () => new Date('2026-06-09T00:00:00Z'),
    });
    const pool = new TenantPool(mkdtempSync(join(tmpdir(), 'turtledb-ws-')));
    const subs = new SubscriptionManager(pool, null, meter);

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
        tenantId: 'room-1',
        roles: [],
        claims: {},
        authenticated: false,
      },
      'room-1',
    );

    await subs.handleMessage('c1', JSON.stringify({ type: 'ping' }));
    expect(sent.length).toBe(1);

    const usage = meter.getUsage('room-1');
    expect(usage.meters.egress_bytes).toBeGreaterThan(0);
    expect(JSON.parse(sent[0]!).type).toBe('pong');
  });
});
