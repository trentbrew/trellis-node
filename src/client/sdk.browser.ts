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

/** Works on HTTP LAN dev (e.g. iPad at 192.168.x.x) where randomUUID is gated. */
function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

declare global {
  interface Window {
    /** Set by host app when WKWebView drops fetch POST bodies (XHR fallback). */
    __TRELLIS_USE_XHR__?: boolean;
    /** Host patched fetch via Tauri plugin-http — always use fetch, never XHR. */
    __TRELLIS_NATIVE_HTTP__?: boolean;
  }
}

/**
 * iOS / Tauri WKWebView on HTTP LAN drops `fetch()` POST bodies.
 * Skip when host installed native HTTP (see chat-demo ios-transport.ts).
 */
function needsXhrForBody(): boolean {
  if (typeof globalThis.window !== 'undefined' && window.__TRELLIS_NATIVE_HTTP__) {
    return false;
  }
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  // Tauri default WKWebView UA: WebKit + Gecko, no Safari/Version/Chrome token.
  if (
    /AppleWebKit/i.test(ua) &&
    /KHTML, like Gecko\)/i.test(ua) &&
    !/Safari\/|Chrome\/|Chromium\/|Edg\/|Version\//i.test(ua)
  ) {
    return true;
  }
  return false;
}

function xhrRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () =>
      reject(new Error(`XHR network error on ${method} ${url}`));
    xhr.send(body);
  });
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
    const label =
      def?.label ??
      (def?.['@id'] ? String(def['@id']).replace(/^trellis:/, '') : 'unknown');
    if (!def?.['@id']) {
      throw new Error(`registerType(${label}): schema is missing a definition with @id`);
    }
    try {
      await this._fetch('POST', '/ontologies', def);
    } catch (err) {
      // Idempotent re-registration (demo hot reload, StrictMode double-mount).
      if (err instanceof FetchError && err.status === 409) return;
      if (err instanceof FetchError) {
        const serverMsg =
          typeof (err.body as Record<string, unknown> | undefined)?.message ===
          'string'
            ? String((err.body as Record<string, unknown>).message)
            : err.message;
        throw new FetchError(err.status, serverMsg, err.body, {
          ...err.context,
          operation: `registerType(${label})`,
        });
      }
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
    const subId = `sub_${randomId()}`;
    this._subCallbacks.set(subId, callback as SubscriptionCallback<any>);
    this._ensureWs().then((ws) => {
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          id: subId,
          query: eql,
          ...(this.opts.tenantId ? { tenantId: this.opts.tenantId } : {}),
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

  /**
   * Tenant isolation, not authorization: when `tenantId` is supplied out-of-band
   * (not bound to the JWT), the server trusts the query param. Safe for ephemeral
   * showcase rooms with unguessable ids; real multi-tenant auth must bind the
   * tenant to the auth token instead. Skipped when the JWT already carries it.
   */
  private _applyTenant(path: string): string {
    const tenantId = this.opts.tenantId;
    if (!tenantId) return path;
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}tenantId=${encodeURIComponent(tenantId)}`;
  }

  private async _fetch(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.opts.url}${this._applyTenant(path)}`;
    let jsonBody: string | undefined;
    if (body !== undefined) {
      jsonBody = JSON.stringify(body);
      if (jsonBody === undefined) {
        throw new Error(`Request body is not JSON-serializable (${method} ${path})`);
      }
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
    };
    const transport =
      jsonBody !== undefined && needsXhrForBody() ? 'xhr' : 'fetch';
    headers['X-Trellis-Transport'] = transport;
    const bodyBytes = jsonBody ? new TextEncoder().encode(jsonBody).byteLength : 0;

    let status: number;
    let text: string;
    if (transport === 'xhr' && jsonBody !== undefined) {
      ({ status, text } = await xhrRequest(method, url, headers, jsonBody));
    } else {
      const res = await fetch(url, {
        method,
        headers,
        body: jsonBody as BodyInit | undefined,
      });
      status = res.status;
      text = await res.text();
    }

    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    if (status < 200 || status >= 300) {
      const server = data as Record<string, unknown> | null;
      const message =
        (typeof server?.message === 'string' && server.message) ||
        (typeof server?.error === 'string' && server.error) ||
        'request failed';
      const err = new FetchError(status, message, data, {
        method,
        path,
        url,
        requestBodyBytes: bodyBytes,
        responseBytes: text.length,
        transport,
      });
      console.error('[trellis]', err.toString());
      throw err;
    }
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

export interface FetchErrorContext {
  method?: string;
  path?: string;
  url?: string;
  operation?: string;
  requestBodyBytes?: number;
  responseBytes?: number;
  transport?: 'fetch' | 'xhr';
}

export class FetchError extends Error {
  public readonly context: FetchErrorContext;

  constructor(
    public status: number,
    message: string,
    public body?: unknown,
    context: FetchErrorContext = {},
  ) {
    super(FetchError.format(status, message, context));
    this.name = 'FetchError';
    this.context = context;
  }

  static format(
    status: number,
    message: string,
    ctx: FetchErrorContext,
  ): string {
    const parts = [`HTTP ${status}`];
    if (ctx.operation) parts.push(ctx.operation);
    if (ctx.method && ctx.path) parts.push(`${ctx.method} ${ctx.path}`);
    parts.push(message);
    if (ctx.requestBodyBytes !== undefined) {
      parts.push(`sent ${ctx.requestBodyBytes}B`);
    }
    if (ctx.responseBytes !== undefined) {
      parts.push(`response ${ctx.responseBytes}B`);
    }
    if (ctx.transport) parts.push(ctx.transport);
    return parts.join(' · ');
  }

  toString(): string {
    const extra: string[] = [];
    if (this.body && typeof this.body === 'object') {
      const b = this.body as Record<string, unknown>;
      if (typeof b.path === 'string') extra.push(`server ${b.method} ${b.path}`);
      if (typeof b.bodyBytes === 'number') extra.push(`server saw ${b.bodyBytes}B`);
    }
    return extra.length ? `${this.message} (${extra.join(', ')})` : this.message;
  }
}
