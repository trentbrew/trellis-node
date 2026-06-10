/**
 * Trellis Client — browser SDK
 *
 * Remote-only runtime for browser bundles. It intentionally excludes local
 * embedded-kernel mode, filesystem config reads, and server tenancy imports.
 *
 * @module trellis/client
 */

import type { SchemaDefinition } from '../core/ontology/types.js';
import type { ResolveSpec } from '../schema/resolve.js';
import type {
  AuthResult,
  EntityData,
  ListResult,
  QueryResult,
  Subscription,
  SubscriptionCallback,
  TrellisDbLocalOptions,
  TrellisDbOptions,
  TrellisDbRemoteOptions,
  UploadResult,
} from './sdk.js';

export type {
  AuthResult,
  EntityData,
  ListResult,
  QueryResult,
  Subscription,
  SubscriptionCallback,
  TrellisDbLocalOptions,
  TrellisDbOptions,
  TrellisDbRemoteOptions,
  UploadResult,
} from './sdk.js';

export interface SubscribeOptions {
  /** Entity type name (e.g. `NavSection`) for server `resolve`. */
  entityType?: string;
  resolve?: ResolveSpec;
}

function isRemote(opts: TrellisDbOptions): opts is TrellisDbRemoteOptions {
  return 'url' in opts;
}

function browserOnlyRemoteError(feature: string): Error {
  return new Error(
    `${feature} is not available in browser bundles. ` +
      'Use remote mode with `new TrellisDb({ url })`, or import `trellis/client` in Node.',
  );
}

// ---------------------------------------------------------------------------
// TrellisDb
// ---------------------------------------------------------------------------

export class TrellisDb {
  private opts: TrellisDbRemoteOptions;
  private _ws: WebSocket | null = null;
  /** In-flight connect — concurrent subscribe() shares one socket open. */
  private _wsPromise: Promise<WebSocket> | null = null;
  private _subCallbacks: Map<string, SubscriptionCallback<any>> = new Map();

  constructor(opts: TrellisDbOptions) {
    if (!isRemote(opts)) {
      throw browserOnlyRemoteError('TrellisDb local mode');
    }
    this.opts = opts;
  }

  /**
   * Browser bundles cannot read `.trellis-db.json`.
   */
  static async fromConfig(_dir = '.'): Promise<TrellisDb> {
    throw browserOnlyRemoteError('TrellisDb.fromConfig()');
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
    const res = await this._fetch('POST', '/entities', {
      type,
      attributes,
      links,
    });
    return (res as { id: string }).id;
  }

  /**
   * Read an entity by ID.
   * Returns null if not found.
   */
  async read<T extends EntityData = EntityData>(id: string): Promise<T | null> {
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

  /**
   * Update an entity's attributes (partial update).
   */
  async update(id: string, attributes: Record<string, unknown>): Promise<void> {
    await this._fetch(
      'PUT',
      `/entities/${encodeURIComponent(id)}`,
      attributes,
    );
  }

  /**
   * Delete an entity by ID.
   */
  async delete(id: string): Promise<void> {
    await this._fetch('DELETE', `/entities/${encodeURIComponent(id)}`);
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
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.offset) params.set('offset', String(opts.offset));
    const qs = params.toString() ? `?${params}` : '';
    return (await this._fetch('GET', `/entities${qs}`)) as ListResult<T>;
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /**
   * Run an EQL-S query string.
   */
  async query(eql: string): Promise<QueryResult> {
    return (await this._fetch('POST', '/query', {
      query: eql,
    })) as QueryResult;
  }

  // -------------------------------------------------------------------------
  // Schema registration
  // -------------------------------------------------------------------------

  /**
   * Register a user/system-tier ontology schema with a remote Trellis server.
   */
  async registerType(
    schema: SchemaDefinition | { definition: SchemaDefinition },
  ): Promise<void> {
    const def = '@id' in schema ? schema : schema.definition;
    try {
      await this._fetch('POST', '/ontologies', def);
    } catch (err) {
      // Idempotent re-registration (demo hot reload, StrictMode double-mount).
      if (err instanceof FetchError && err.status === 409) return;
      throw err;
    }
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

  /**
   * Download a file by its blob hash.
   */
  async getFile(hash: string): Promise<Uint8Array | null> {
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

  // -------------------------------------------------------------------------
  // Auth helpers
  // -------------------------------------------------------------------------

  async register(
    email: string,
    password: string,
    name?: string,
  ): Promise<AuthResult> {
    return (await this._fetch('POST', '/auth/register', {
      email,
      password,
      name,
    })) as AuthResult;
  }

  async login(email: string, password: string): Promise<AuthResult> {
    return (await this._fetch('POST', '/auth/login', {
      email,
      password,
    })) as AuthResult;
  }

  /**
   * Set the active API key / JWT token for subsequent requests.
   */
  setToken(token: string): void {
    this.opts.apiKey = token;
  }

  // -------------------------------------------------------------------------
  // Realtime
  // -------------------------------------------------------------------------

  /**
   * Subscribe to a live EQL-S query.
   * Callback is fired immediately with the initial result, then on every update.
   */
  subscribe<T = EntityData>(
    eql: string,
    callback: SubscriptionCallback<T>,
    opts?: SubscribeOptions,
  ): Subscription<T> {
    const subId = `sub_${crypto.randomUUID()}`;
    this._subCallbacks.set(subId, callback as SubscriptionCallback<any>);
    this._ensureWs().then((ws) => {
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          id: subId,
          query: eql,
          ...(opts?.entityType ? { entityType: opts.entityType } : {}),
          ...(opts?.resolve ? { resolve: opts.resolve } : {}),
        }),
      );
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
   * Close open client resources.
   */
  close(): void {
    this.disconnect();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async _fetch(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.opts.url}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
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

    const wsUrl =
      this.opts.url.replace(
        /^https?/,
        this.opts.url.startsWith('https') ? 'wss' : 'ws',
      ) + '/realtime';

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
            const meta =
              msg.resolved === true ? { resolved: true as const } : undefined;
            this._subCallbacks.get(msg.id)!(msg.result, msg.diff, meta);
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
