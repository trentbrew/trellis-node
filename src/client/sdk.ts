/**
 * Trellis Client — TypeScript SDK
 *
 * Isomorphic client that works in two modes:
 *
 *   Local  — embeds TrellisKernel directly (Node/Bun only, zero network)
 *   Remote — calls the Trellis Server HTTP API (works anywhere, including browsers)
 *
 * Usage:
 *   // Local (embeds SQLite kernel)
 *   const db = new TrellisClient({ path: './.trellis-db' });
 *
 *   // Remote (hits HTTP server or Sprites deployment)
 *   const db = new TrellisClient({ url: 'https://myapp.sprites.app', apiKey: '...' });
 *
 *   // Auto (reads .trellis-db.json from cwd)
 *   const db = await TrellisClient.fromConfig();
 *
 * @module trellis/client
 */

import type { SchemaDefinition } from '../core/ontology/types.js';
import type { TenantPool } from '../server/tenancy.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface EntityData {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface ListResult<T = EntityData> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface QueryResult {
  bindings: Record<string, unknown>[];
  executionTime: number;
}

export interface UploadResult {
  hash: string;
  size: number;
  contentType: string;
}

export interface AuthResult {
  token: string;
  userId: string;
}

// Realtime subscription handle
export interface Subscription<T = EntityData> {
  unsubscribe(): void;
}

export type SubscriptionCallback<T = EntityData> = (
  result: T[],
  diff: { added: T[]; updated: T[]; removed: T[] },
) => void;

// ---------------------------------------------------------------------------
// SDK options
// ---------------------------------------------------------------------------

export interface TrellisDbLocalOptions {
  /** Path to the SQLite database directory. */
  path: string;
  /** Agent ID for attributing ops. Default: 'sdk'. */
  agentId?: string;
  /** Tenant ID (multi-tenant mode). */
  tenantId?: string;
}

export interface TrellisDbRemoteOptions {
  /** Base URL of the Trellis DB server. */
  url: string;
  /** API key or JWT for authentication. */
  apiKey?: string;
  /** Tenant ID (passed as query param if not in JWT). */
  tenantId?: string;
}

export type TrellisDbOptions = TrellisDbLocalOptions | TrellisDbRemoteOptions;

function isRemote(opts: TrellisDbOptions): opts is TrellisDbRemoteOptions {
  return 'url' in opts;
}

// ---------------------------------------------------------------------------
// TrellisDb
// ---------------------------------------------------------------------------

export class TrellisDb {
  private opts: TrellisDbOptions;
  private _pool: TenantPool | null = null;
  private _poolPromise: Promise<TenantPool> | null = null;
  private _ws: WebSocket | null = null;
  /** In-flight connect — concurrent subscribe() shares one socket open. */
  private _wsPromise: Promise<WebSocket> | null = null;
  private _subCallbacks: Map<string, SubscriptionCallback<any>> = new Map();

  constructor(opts: TrellisDbOptions) {
    this.opts = opts;
  }

  /**
   * Create a TrellisDb instance from `.trellis-db.json` in the given directory.
   */
  static async fromConfig(dir = '.'): Promise<TrellisDb> {
    const { readConfig } = await import('./config.js');
    const config = readConfig(dir);
    if (!config)
      throw new Error(
        'No .trellis-db.json found. Run `trellis db init` first.',
      );

    if (config.mode === 'remote' && config.url) {
      return new TrellisDb({ url: config.url, apiKey: config.apiKey });
    }
    if (config.dbPath) {
      return new TrellisDb({ path: config.dbPath });
    }
    throw new Error('Invalid .trellis-db.json: missing url or dbPath.');
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  /**
   * Create a new entity.
   * Returns the generated entity ID.
   */
  async create(
    type: string,
    attributes: Record<string, unknown> = {},
    links?: Array<{ attribute: string; targetEntityId: string }>,
  ): Promise<string> {
    if (isRemote(this.opts)) {
      const res = await this._fetch('POST', '/entities', {
        type,
        attributes,
        links,
      });
      return (res as { id: string }).id;
    }

    const pool = await this._getPool();
    const tenantId = (this.opts as TrellisDbLocalOptions).tenantId ?? null;
    const kernel = pool.get(tenantId);
    const entityId = `${type.toLowerCase()}:${crypto.randomUUID()}`;
    await kernel.createEntity(entityId, type, attributes as any, links);
    return entityId;
  }

  /**
   * Read an entity by ID.
   * Returns null if not found.
   */
  async read<T extends EntityData = EntityData>(id: string): Promise<T | null> {
    if (isRemote(this.opts)) {
      try {
        return (await this._fetch(
          'GET',
          `/entities/${encodeURIComponent(id)}`,
        )) as T;
      } catch (err: any) {
        if (err?.status === 404) return null;
        throw err;
      }
    }

    const pool = await this._getPool();
    const tenantId = (this.opts as TrellisDbLocalOptions).tenantId ?? null;
    const kernel = pool.get(tenantId);
    const entity = kernel.getEntity(id);
    if (!entity) return null;
    return entityToPlain(entity) as T;
  }

  /**
   * Update an entity's attributes (partial update).
   */
  async update(id: string, attributes: Record<string, unknown>): Promise<void> {
    if (isRemote(this.opts)) {
      await this._fetch(
        'PUT',
        `/entities/${encodeURIComponent(id)}`,
        attributes,
      );
      return;
    }

    const pool = await this._getPool();
    const tenantId = (this.opts as TrellisDbLocalOptions).tenantId ?? null;
    const kernel = pool.get(tenantId);
    await kernel.updateEntity(id, attributes as any);
  }

  /**
   * Delete an entity by ID.
   */
  async delete(id: string): Promise<void> {
    if (isRemote(this.opts)) {
      await this._fetch('DELETE', `/entities/${encodeURIComponent(id)}`);
      return;
    }

    const pool = await this._getPool();
    const tenantId = (this.opts as TrellisDbLocalOptions).tenantId ?? null;
    const kernel = pool.get(tenantId);
    await kernel.deleteEntity(id);
  }

  /**
   * List entities of a given type.
   */
  async list<T extends EntityData = EntityData>(
    type?: string,
    opts: {
      limit?: number;
      offset?: number;
      filters?: Record<string, unknown>;
    } = {},
  ): Promise<ListResult<T>> {
    if (isRemote(this.opts)) {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.offset) params.set('offset', String(opts.offset));
      const qs = params.toString() ? `?${params}` : '';
      return (await this._fetch('GET', `/entities${qs}`)) as ListResult<T>;
    }

    const pool = await this._getPool();
    const tenantId = (this.opts as TrellisDbLocalOptions).tenantId ?? null;
    const kernel = pool.get(tenantId);
    const entities = kernel.listEntities(type, opts.filters as any);
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;
    const page = entities.slice(offset, offset + limit);
    return {
      data: page.map(entityToPlain) as T[],
      total: entities.length,
      limit,
      offset,
    };
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /**
   * Run an EQL-S query string.
   */
  async query(eql: string): Promise<QueryResult> {
    if (isRemote(this.opts)) {
      return (await this._fetch('POST', '/query', {
        query: eql,
      })) as QueryResult;
    }

    const { parseSimple } = await import('../core/query/index.js');
    const pool = await this._getPool();
    const tenantId = (this.opts as TrellisDbLocalOptions).tenantId ?? null;
    const kernel = pool.get(tenantId);
    const parsed = parseSimple(eql);
    return kernel.query(parsed);
  }

  // -------------------------------------------------------------------------
  // Schema registration
  // -------------------------------------------------------------------------

  /**
   * Register a user/system-tier ontology schema with the kernel.
   *
   * Accepts a {@link SchemaDefinition} or anything carrying one (e.g. a
   * `defineType` handle: `client.registerType(NavItem)`). Local mode calls
   * `kernel.createOntology` directly; remote mode POSTs to `/ontologies`.
   */
  async registerType(
    schema: SchemaDefinition | { definition: SchemaDefinition },
  ): Promise<void> {
    const def = '@id' in schema ? schema : schema.definition;

    if (isRemote(this.opts)) {
      try {
        await this._fetch('POST', '/ontologies', def);
      } catch (err) {
        // Idempotent re-registration (demo hot reload, StrictMode double-mount).
        if (err instanceof FetchError && err.status === 409) return;
        throw err;
      }
      return;
    }

    const pool = await this._getPool();
    const tenantId = (this.opts as TrellisDbLocalOptions).tenantId ?? null;
    const kernel = pool.get(tenantId);
    kernel.createOntology(def);
  }

  // -------------------------------------------------------------------------
  // File upload
  // -------------------------------------------------------------------------

  /**
   * Upload a file to the blob store.
   * Returns a content-addressed hash.
   */
  async upload(
    data: Uint8Array | ArrayBuffer,
    contentType = 'application/octet-stream',
  ): Promise<UploadResult> {
    const raw = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const cleanBuf: ArrayBuffer = raw.buffer.slice(
      raw.byteOffset,
      raw.byteOffset + raw.byteLength,
    ) as ArrayBuffer;
    const buffer = new Uint8Array(cleanBuf);

    if (isRemote(this.opts)) {
      const res = await fetch(`${this.opts.url}/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          ...(this.opts.apiKey
            ? { Authorization: `Bearer ${this.opts.apiKey}` }
            : {}),
        },
        body: cleanBuf,
      });
      if (!res.ok) throw new FetchError(res.status, await res.text());
      return (await res.json()) as UploadResult;
    }

    const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
    const hash = `blob:${Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;
    const pool = await this._getPool();
    const tenantId = (this.opts as TrellisDbLocalOptions).tenantId ?? null;
    const kernel = pool.get(tenantId);
    const backend =
      kernel.getBackend() as import('../core/persist/sqlite-backend.js').SqliteKernelBackend;
    if (!backend.hasBlob(hash)) backend.putBlob(hash, buffer);
    return { hash, size: buffer.length, contentType };
  }

  /**
   * Download a file by its blob hash.
   */
  async getFile(hash: string): Promise<Uint8Array | null> {
    if (isRemote(this.opts)) {
      const res = await fetch(
        `${this.opts.url}/files/${encodeURIComponent(hash)}`,
        {
          headers: this.opts.apiKey
            ? { Authorization: `Bearer ${this.opts.apiKey}` }
            : {},
        },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new FetchError(res.status, await res.text());
      return new Uint8Array(await res.arrayBuffer());
    }

    const pool = await this._getPool();
    const tenantId = (this.opts as TrellisDbLocalOptions).tenantId ?? null;
    const kernel = pool.get(tenantId);
    const backend =
      kernel.getBackend() as import('../core/persist/sqlite-backend.js').SqliteKernelBackend;
    return backend.getBlob(hash) ?? null;
  }

  // -------------------------------------------------------------------------
  // Auth helpers
  // -------------------------------------------------------------------------

  async register(
    email: string,
    password: string,
    name?: string,
  ): Promise<AuthResult> {
    if (!isRemote(this.opts))
      throw new Error('register() requires remote mode');
    return (await this._fetch('POST', '/auth/register', {
      email,
      password,
      name,
    })) as AuthResult;
  }

  async login(email: string, password: string): Promise<AuthResult> {
    if (!isRemote(this.opts)) throw new Error('login() requires remote mode');
    return (await this._fetch('POST', '/auth/login', {
      email,
      password,
    })) as AuthResult;
  }

  /**
   * Set the active API key / JWT token for subsequent requests.
   */
  setToken(token: string): void {
    if (!isRemote(this.opts)) return;
    (this.opts as TrellisDbRemoteOptions).apiKey = token;
  }

  // -------------------------------------------------------------------------
  // Realtime
  // -------------------------------------------------------------------------

  /**
   * Subscribe to a live EQL-S query.
   * Callback is fired immediately with the initial result, then on every update.
   *
   * Requires remote mode (WebSocket to server).
   */
  subscribe<T = EntityData>(
    eql: string,
    callback: SubscriptionCallback<T>,
  ): Subscription<T> {
    if (!isRemote(this.opts)) {
      throw new Error(
        'subscribe() requires remote mode (connect to a running server)',
      );
    }

    const subId = `sub_${crypto.randomUUID()}`;
    this._subCallbacks.set(subId, callback as SubscriptionCallback<any>);
    this._ensureWs().then((ws) => {
      ws.send(JSON.stringify({ type: 'subscribe', id: subId, query: eql }));
    });

    return {
      unsubscribe: () => {
        this._subCallbacks.delete(subId);
        this._ws?.send(JSON.stringify({ type: 'unsubscribe', id: subId }));
      },
    };
  }

  /**
   * Close the WebSocket connection.
   */
  disconnect(): void {
    const ws = this._ws;
    this._ws = null;
    this._wsPromise = null;
    ws?.close();
  }

  /**
   * Close local kernel pool connections.
   */
  close(): void {
    this._pool?.closeAll();
    this._pool = null;
    this._poolPromise = null;
    this.disconnect();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async _getPool(): Promise<TenantPool> {
    if (this._pool) return this._pool;
    if (!this._poolPromise) {
      this._poolPromise = import('../server/tenancy.js').then(({ TenantPool }) => {
        const path = (this.opts as TrellisDbLocalOptions).path;
        this._pool = new TenantPool(path);
        return this._pool;
      });
    }
    return this._poolPromise;
  }

  private async _fetch(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const opts = this.opts as TrellisDbRemoteOptions;
    const url = `${opts.url}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok)
      throw new FetchError(
        res.status,
        (data as any)?.message ?? res.statusText,
        data,
      );
    return data;
  }

  private _ensureWs(): Promise<WebSocket> {
    if (this._ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this._ws);
    }

    if (this._wsPromise) {
      return this._wsPromise;
    }

    const opts = this.opts as TrellisDbRemoteOptions;
    const wsUrl =
      opts.url.replace(/^https?/, opts.url.startsWith('https') ? 'wss' : 'ws') +
      '/realtime';

    this._wsPromise = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        this._ws = ws;
        resolve(ws);
      };

      ws.onerror = (e) => {
        reject(e instanceof Error ? e : new Error('WebSocket error'));
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          if (msg.type === 'data' && this._subCallbacks.has(msg.id)) {
            this._subCallbacks.get(msg.id)!(msg.result, msg.diff);
          }
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        // Only drop the active ref if this socket is still the one we track.
        if (this._ws === ws) {
          this._ws = null;
        }
      };
    }).finally(() => {
      this._wsPromise = null;
    });

    return this._wsPromise;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entityToPlain(
  entity: import('../core/kernel/trellis-kernel.js').EntityRecord,
): EntityData {
  const obj: EntityData = { id: entity.id, type: entity.type };
  for (const f of entity.facts) {
    if (f.a !== 'type') obj[f.a] = f.v;
  }
  return obj;
}

export class FetchError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(`HTTP ${status}: ${message}`);
    this.name = 'FetchError';
  }
}
