/**
 * TurtleDB Cloud — in-process usage counters (C1 stub).
 *
 * Per-tenant day buckets for graph I/O, storage, and egress.
 * Report-only — broker pull / Stripe wiring is C1.1.
 *
 * @module trellis/server
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { TenantPool } from './tenancy.js';
import { DEFAULT_TENANT } from './tenancy.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MeterName = 'graph_io' | 'storage_bytes' | 'egress_bytes';

export interface DayBucket {
  graph_io: number;
  storage_bytes: number;
  egress_bytes: number;
}

export interface TenantUsageSnapshot {
  tenantId: string;
  day: string;
  meters: DayBucket;
  /** ISO timestamp of last storage sample for this day. */
  storageSampledAt?: string;
}

export interface UsageMeterOptions {
  now?: () => Date;
}

const EMPTY_BUCKET = (): DayBucket => ({
  graph_io: 0,
  storage_bytes: 0,
  egress_bytes: 0,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function resolveUsageTenantId(tenantId?: string | null): string {
  return tenantId ?? DEFAULT_TENANT;
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dirSize(dir: string): number {
  let total = 0;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) total += dirSize(p);
    else if (ent.isFile()) total += statSync(p).size;
  }
  return total;
}

/**
 * Sample on-disk storage for a tenant: SQLite file + optional `blobs/` dir.
 */
export function sampleTenantStorage(
  pool: TenantPool,
  tenantId?: string | null,
): number {
  let total = 0;
  const sqlitePath = pool.dbFilePath(tenantId);
  if (existsSync(sqlitePath)) {
    total += statSync(sqlitePath).size;
  }
  const blobDir = join(pool.dataPath(), 'blobs');
  if (existsSync(blobDir)) {
    total += dirSize(blobDir);
  }
  return total;
}

/**
 * Verify admin usage requests via `TURTLEDB_ADMIN_KEY`.
 * Accepts `Authorization: Bearer <key>` or `X-Turtledb-Admin-Key`.
 */
export function verifyAdminKey(req: Request): boolean {
  const expected = process.env.TURTLEDB_ADMIN_KEY;
  if (!expected) return false;

  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length) === expected;
  }

  return req.headers.get('x-turtledb-admin-key') === expected;
}

// ---------------------------------------------------------------------------
// UsageMeter
// ---------------------------------------------------------------------------

export class UsageMeter {
  private buckets = new Map<string, Map<string, DayBucket>>();
  private storageSampledAt = new Map<string, string>();
  private now: () => Date;

  constructor(opts: UsageMeterOptions = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  recordGraphIo(tenantId: string, count = 1): void {
    if (count <= 0) return;
    const bucket = this._bucket(tenantId);
    bucket.graph_io += count;
  }

  recordEgress(tenantId: string, bytes: number): void {
    if (bytes <= 0) return;
    const bucket = this._bucket(tenantId);
    bucket.egress_bytes += bytes;
  }

  /** Set storage gauge for the current day (from sampler, not incremental). */
  recordStorage(tenantId: string, bytes: number): void {
    const bucket = this._bucket(tenantId);
    bucket.storage_bytes = bytes;
    this.storageSampledAt.set(`${tenantId}:${this._today()}`, this.now().toISOString());
  }

  sampleStorage(pool: TenantPool, tenantId?: string | null): number {
    const id = resolveUsageTenantId(tenantId);
    const bytes = sampleTenantStorage(pool, id);
    this.recordStorage(id, bytes);
    return bytes;
  }

  getUsage(tenantId: string, day?: string): TenantUsageSnapshot {
    const d = day ?? this._today();
    const tenantBuckets = this.buckets.get(tenantId);
    const meters = tenantBuckets?.get(d) ?? EMPTY_BUCKET();
    const sampledAt = this.storageSampledAt.get(`${tenantId}:${d}`);

    return {
      tenantId,
      day: d,
      meters: { ...meters },
      ...(sampledAt ? { storageSampledAt: sampledAt } : {}),
    };
  }

  /** All day keys recorded for a tenant (sorted ascending). */
  listDays(tenantId: string): string[] {
    const tenantBuckets = this.buckets.get(tenantId);
    if (!tenantBuckets) return [];
    return Array.from(tenantBuckets.keys()).sort();
  }

  private _today(): string {
    return dayKey(this.now());
  }

  private _bucket(tenantId: string): DayBucket {
    const id = resolveUsageTenantId(tenantId);
    const d = this._today();
    if (!this.buckets.has(id)) {
      this.buckets.set(id, new Map());
    }
    const tenantBuckets = this.buckets.get(id)!;
    if (!tenantBuckets.has(d)) {
      tenantBuckets.set(d, EMPTY_BUCKET());
    }
    return tenantBuckets.get(d)!;
  }
}
