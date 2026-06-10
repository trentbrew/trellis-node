/**
 * Trellis Server — Realtime Subscription Engine
 *
 * InstantDB-style reactive queries over WebSocket.
 *
 * Clients subscribe to an EQL-S query string. When any op lands that touches
 * an entity type in that query's result set, the server re-runs the query
 * and pushes the full updated result (plus a diff) to subscribed clients.
 *
 * Protocol (JSON over WebSocket):
 *
 *   Client → Server:
 *     { type: "subscribe", id: "sub_1", query: "find Post where ...",
 *       entityType?: "Post", resolve?: { author: true }, tenantId?: "t1" }
 *     { type: "unsubscribe", id: "sub_1" }
 *     { type: "ping" }
 *
 *   Server → Client:
 *     { type: "subscribed",  id: "sub_1" }
 *     { type: "data",        id: "sub_1", result: [...], diff: { added, updated, removed },
 *       resolved?: true }
 *     { type: "error",       id: "sub_1", message: "..." }
 *     { type: "pong" }
 *
 * @module trellis/server
 */

import { parseSimple } from '../core/query/index.js';
import { hydrateAndResolve } from '../schema/kernel-resolve.js';
import type { ResolveSpec } from '../schema/resolve.js';
import type { TenantPool } from './tenancy.js';
import { DEFAULT_TENANT } from './tenancy.js';
import type { UsageMeter } from './usage-meter.js';
import { resolveUsageTenantId } from './usage-meter.js';
import type { AuthContext } from './auth.js';
import type { PermissionRegistry } from './permissions.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Subscription {
  id: string;
  query: string;
  tenantId: string | null;
  auth: AuthContext;
  lastResult: Record<string, unknown>[];
  /** Entity type name — enables server-side `resolve` expansion. */
  entityType?: string;
  resolve?: ResolveSpec;
}

export interface WsClient {
  id: string;
  ws: { send(data: string): void; readyState: number };
  subscriptions: Map<string, Subscription>;
  auth: AuthContext;
  tenantId: string | null;
}

export type RealtimeMessage =
  | {
      type: 'subscribe';
      id: string;
      query: string;
      tenantId?: string;
      entityType?: string;
      resolve?: ResolveSpec;
    }
  | { type: 'unsubscribe'; id: string }
  | { type: 'ping' };

// ---------------------------------------------------------------------------
// SubscriptionManager
// ---------------------------------------------------------------------------

/**
 * Manages WebSocket clients and their query subscriptions.
 * Call `notify(tenantId)` after any mutation to fan out updates.
 */
export class SubscriptionManager {
  private clients: Map<string, WsClient> = new Map();
  private pool: TenantPool;
  private permissions: PermissionRegistry | null;
  private meter: UsageMeter | null;

  constructor(
    pool: TenantPool,
    permissions: PermissionRegistry | null = null,
    meter: UsageMeter | null = null,
  ) {
    this.pool = pool;
    this.permissions = permissions;
    this.meter = meter;
  }

  // -------------------------------------------------------------------------
  // Client lifecycle
  // -------------------------------------------------------------------------

  addClient(
    clientId: string,
    ws: WsClient['ws'],
    auth: AuthContext,
    tenantId: string | null,
  ): void {
    this.clients.set(clientId, {
      id: clientId,
      ws,
      subscriptions: new Map(),
      auth,
      tenantId,
    });
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  async handleMessage(clientId: string, raw: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    let msg: RealtimeMessage;
    try {
      msg = JSON.parse(raw) as RealtimeMessage;
    } catch {
      this._send(client, { type: 'error', id: '', message: 'Invalid JSON' });
      return;
    }

    if (msg.type === 'ping') {
      this._send(client, { type: 'pong' });
      return;
    }

    if (msg.type === 'subscribe') {
      await this._handleSubscribe(client, msg.id, msg.query, {
        tenantId: msg.tenantId,
        entityType: msg.entityType,
        resolve: msg.resolve,
      });
      return;
    }

    if (msg.type === 'unsubscribe') {
      client.subscriptions.delete(msg.id);
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Notify — called after every mutation
  // -------------------------------------------------------------------------

  /**
   * Re-evaluate all subscriptions for a given tenant and push diffs.
   * Called after every write op lands.
   */
  async notify(tenantId: string | null): Promise<void> {
    const tid = tenantId ?? null;
    const dead: string[] = [];

    for (const [clientId, client] of this.clients) {
      if (client.ws.readyState !== 1 /* OPEN */) {
        dead.push(clientId);
        continue;
      }

      if (client.tenantId !== tid) continue;

      for (const [subId, sub] of client.subscriptions) {
        if (sub.tenantId !== tid) continue;
        await this._pushUpdate(client, sub);
      }
    }

    for (const id of dead) this.clients.delete(id);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async _handleSubscribe(
    client: WsClient,
    subId: string,
    queryStr: string,
    opts: {
      tenantId?: string;
      entityType?: string;
      resolve?: ResolveSpec;
    } = {},
  ): Promise<void> {
    const tid = opts.tenantId ?? client.tenantId ?? null;

    let parsedQuery;
    try {
      parsedQuery = parseSimple(queryStr);
    } catch (err: unknown) {
      this._send(client, {
        type: 'error',
        id: subId,
        message: `Invalid query: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const kernel = await this.pool.preload(tid);
    let result: Record<string, unknown>[];
    try {
      const qr = await kernel.query(parsedQuery);
      this._recordGraphIo(tid);
      result = await hydrateAndResolve(
        kernel,
        qr.bindings as Record<string, unknown>[],
        opts.entityType,
        opts.resolve,
      );
    } catch (err: unknown) {
      this._send(client, {
        type: 'error',
        id: subId,
        message: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const resolved =
      Boolean(opts.entityType) &&
      Boolean(opts.resolve && Object.keys(opts.resolve).length > 0);

    const sub: Subscription = {
      id: subId,
      query: queryStr,
      tenantId: tid,
      auth: client.auth,
      lastResult: result,
      entityType: opts.entityType,
      resolve: opts.resolve,
    };
    client.subscriptions.set(subId, sub);

    this._send(client, { type: 'subscribed', id: subId });
    this._send(client, {
      type: 'data',
      id: subId,
      result,
      diff: { added: result, updated: [], removed: [] },
      ...(resolved ? { resolved: true } : {}),
    });
  }

  private async _pushUpdate(
    client: WsClient,
    sub: Subscription,
  ): Promise<void> {
    const kernel = await this.pool.preload(sub.tenantId);

    let newResult: Record<string, unknown>[];
    try {
      const parsed = parseSimple(sub.query);
      const qr = await kernel.query(parsed);
      this._recordGraphIo(sub.tenantId);
      newResult = await hydrateAndResolve(
        kernel,
        qr.bindings as Record<string, unknown>[],
        sub.entityType,
        sub.resolve,
      );
    } catch {
      return;
    }

    const diff = computeDiff(sub.lastResult, newResult);
    if (
      diff.added.length === 0 &&
      diff.updated.length === 0 &&
      diff.removed.length === 0
    ) {
      return;
    }

    sub.lastResult = newResult;
    const resolved =
      Boolean(sub.entityType) &&
      Boolean(sub.resolve && Object.keys(sub.resolve).length > 0);
    this._send(client, {
      type: 'data',
      id: sub.id,
      result: newResult,
      diff,
      ...(resolved ? { resolved: true } : {}),
    });
  }

  private _recordGraphIo(tenantId: string | null): void {
    this.meter?.recordGraphIo(resolveUsageTenantId(tenantId));
  }

  private _send(client: WsClient, payload: Record<string, unknown>): void {
    const data = JSON.stringify(payload);
    if (this.meter) {
      const tid = resolveUsageTenantId(client.tenantId ?? DEFAULT_TENANT);
      this.meter.recordEgress(tid, new TextEncoder().encode(data).length);
    }
    try {
      client.ws.send(data);
    } catch {
      // Client disconnected
    }
  }
}

// ---------------------------------------------------------------------------
// Diff helper
// ---------------------------------------------------------------------------

function entityId(row: Record<string, unknown>): string {
  return String(row['?e'] ?? row.id ?? row.e ?? JSON.stringify(row));
}

function computeDiff(
  prev: Record<string, unknown>[],
  next: Record<string, unknown>[],
): {
  added: Record<string, unknown>[];
  updated: Record<string, unknown>[];
  removed: Record<string, unknown>[];
} {
  const prevMap = new Map(prev.map((r) => [entityId(r), r]));
  const nextMap = new Map(next.map((r) => [entityId(r), r]));

  const added: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const removed: Record<string, unknown>[] = [];

  for (const [id, row] of nextMap) {
    if (!prevMap.has(id)) {
      added.push(row);
    } else if (JSON.stringify(prevMap.get(id)) !== JSON.stringify(row)) {
      updated.push(row);
    }
  }

  for (const [id, row] of prevMap) {
    if (!nextMap.has(id)) removed.push(row);
  }

  return { added, updated, removed };
}
