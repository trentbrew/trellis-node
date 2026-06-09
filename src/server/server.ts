/**
 * Trellis Server — HTTP + WebSocket Server
 *
 * Node-compatible server (no Express) exposing REST + realtime endpoints.
 *
 * REST:
 *   POST   /entities                   Create entity
 *   GET    /entities/:id               Read entity
 *   PUT    /entities/:id               Update entity attributes
 *   DELETE /entities/:id               Delete entity
 *   GET    /entities?type=&limit=&offset=  List entities
 *   POST   /query                      EQL-S query
 *   POST   /upload                     File upload → blob hash
 *   GET    /files/:hash                Download blob
 *   GET    /health                     Health check
 *
 * Auth:
 *   POST   /auth/login                 Email+password → JWT
 *   POST   /auth/register              Create user → JWT
 *   GET    /auth/oauth/:provider       OAuth redirect
 *   GET    /auth/oauth/:provider/callback  OAuth callback → JWT
 *
 * WebSocket:
 *   GET    /realtime                   Upgrade to WebSocket for subscriptions
 *
 * @module trellis/server
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __moduleDir =
  (import.meta as any).dir ?? dirname(fileURLToPath(import.meta.url));
import { parseSimple } from '../core/query/index.js';
import {
  entityRecordToPlain,
  hydrateBindings,
} from '../schema/entity-projection.js';
import { jsonEntityFacts } from '../core/store/eav-store.js';
import type { TrellisDbConfig } from '../client/config.js';
import type { TenantPool } from './tenancy.js';
import type { AuthConfig } from './auth.js';
import {
  resolveAuth,
  signJwt,
  buildOAuthUrl,
  exchangeOAuthCode,
  GOOGLE_PROVIDER,
  GITHUB_PROVIDER,
} from './auth.js';
import type { PermissionRegistry } from './permissions.js';
import { PermissionError } from './permissions.js';
import { SubscriptionManager } from './realtime.js';
import type { TrellisHttpServer } from './server-shared.js';
export type { TrellisHttpServer } from './server-shared.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServerConfig {
  port?: number;
  config: TrellisDbConfig;
  pool: TenantPool;
  permissions?: PermissionRegistry;
  oauthProviders?: Record<string, import('./auth.js').OAuthProvider>;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/**
 * Start the Trellis DB HTTP + WebSocket server.
 *
 * Uses Node's `node:http` + the `ws` library. Works in Node and WebContainer.
 */
export async function startServer(
  opts: ServerConfig,
): Promise<TrellisHttpServer> {
  return startServerNode(opts);
}

/**
 * Alias for `startServer` — kept for API compatibility with callers that
 * previously used the cross-runtime dispatch path.
 */
export const startServerCrossRuntime = startServer;

function buildServerContext(opts: ServerConfig) {
  const { pool, permissions, config } = opts;
  const port = opts.port ?? config.port ?? 3000;

  const authConfig: AuthConfig = {
    jwtSecret: config.jwtSecret,
    apiKey: config.apiKey,
    allowPublic: true,
  };

  const subs = new SubscriptionManager(pool, permissions ?? null);

  const handleHttp = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    const auth = await resolveAuth(
      req.headers.get('authorization'),
      authConfig,
    );
    const tenantId =
      auth.tenantId ?? url.searchParams.get('tenantId') ?? null;

    try {
      return await route(req, url, path, auth, tenantId, {
        pool,
        permissions: permissions ?? null,
        subs,
        authConfig,
        config,
        oauthProviders: opts.oauthProviders ?? {},
      });
    } catch (err) {
      if (err instanceof PermissionError) {
        return json(err.toResponse(), 403);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return json({ error: 'Internal Server Error', message: msg }, 500);
    }
  };

  return { port, authConfig, subs, handleHttp };
}

async function startServerNode(
  opts: ServerConfig,
): Promise<TrellisHttpServer> {
  const { port, subs, handleHttp } = buildServerContext(opts);
  const { startNodeServer } = await import('./node-adapter.js');

  return startNodeServer({
    port,
    fetch: handleHttp,
    websocket: {
      open(ws) {
        const id = crypto.randomUUID();
        (ws as any).__clientId = id;
        subs.addClient(
          id,
          ws as any,
          {
            userId: null,
            tenantId: null,
            roles: [],
            claims: {},
            authenticated: false,
          },
          null,
        );
      },
      async message(ws, raw) {
        const id = (ws as any).__clientId as string;
        await subs.handleMessage(
          id,
          typeof raw === 'string' ? raw : raw.toString(),
        );
      },
      close(ws) {
        const id = (ws as any).__clientId as string;
        subs.removeClient(id);
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

interface RouteCtx {
  pool: TenantPool;
  permissions: PermissionRegistry | null;
  subs: SubscriptionManager;
  authConfig: AuthConfig;
  config: TrellisDbConfig;
  oauthProviders: Record<string, import('./auth.js').OAuthProvider>;
}

async function route(
  req: Request,
  url: URL,
  path: string,
  auth: import('./auth.js').AuthContext,
  tenantId: string | null,
  ctx: RouteCtx,
): Promise<Response> {
  const method = req.method.toUpperCase();

  // ── Inspector ──────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/__trellis/inspector.js') {
    const candidates = [
      join(__moduleDir, 'db', 'inspector.js'), // chunk lives in dist/, inspector in dist/db/
      join(__moduleDir, 'inspector.js'), // chunk lives in dist/db/, inspector alongside
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        return new Response(readFileSync(p, 'utf-8'), {
          headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
        });
      }
    }
    return new Response(
      '/* Trellis DB Inspector: run `bun run build:inspector` first */',
      {
        headers: { 'Content-Type': 'application/javascript' },
      },
    );
  }

  if (method === 'GET' && path === '/__trellis/trellis.css') {
    const candidates = [
      join(__moduleDir, 'db', 'trellis.css'),
      join(__moduleDir, 'trellis.css'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        return new Response(readFileSync(p, 'utf-8'), {
          headers: { 'Content-Type': 'text/css; charset=utf-8' },
        });
      }
    }
    return new Response('/* Trellis CSS not found */', {
      headers: { 'Content-Type': 'text/css' },
    });
  }

  if (method === 'GET' && (path === '/' || path === '/inspector')) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trellis DB Inspector</title>
  <link rel="stylesheet" href="/__trellis/trellis.css">
</head>
<body>
  <script src="/__trellis/inspector.js"></script>
</body>
</html>`;
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // ── Health ────────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/health') {
    const kernel = ctx.pool.get(tenantId);
    const ops = kernel.readAllOps().length;
    return json({
      status: 'ok',
      ops,
      tenants: ctx.pool.activeTenants().length,
    });
  }

  // ── Entities ──────────────────────────────────────────────────────────────
  if (path === '/entities' || path === '/entities/') {
    if (method === 'POST') return handleCreate(req, auth, tenantId, ctx);
    if (method === 'GET') return handleList(url, auth, tenantId, ctx);
  }

  const entityMatch = path.match(/^\/entities\/([^/]+)$/);
  if (entityMatch) {
    const id = decodeURIComponent(entityMatch[1]!);
    if (method === 'GET') return handleRead(id, auth, tenantId, ctx);
    if (method === 'PUT' || method === 'PATCH')
      return handleUpdate(req, id, auth, tenantId, ctx);
    if (method === 'DELETE') return handleDelete(id, auth, tenantId, ctx);
  }

  // ── Query ─────────────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/query') {
    return handleQuery(req, auth, tenantId, ctx);
  }

  // ── Ontologies ──────────────────────────────────────────────────────────────
  if (method === 'POST' && (path === '/ontologies' || path === '/ontologies/')) {
    return handleCreateOntology(req, auth, tenantId, ctx);
  }

  // ── Files ─────────────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/upload') {
    return handleUpload(req, auth, tenantId, ctx);
  }
  const fileMatch = path.match(/^\/files\/([^/]+)$/);
  if (method === 'GET' && fileMatch) {
    return handleFileDownload(fileMatch[1]!, ctx, tenantId);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/auth/register') {
    return handleRegister(req, tenantId, ctx);
  }
  if (method === 'POST' && path === '/auth/login') {
    return handleLogin(req, tenantId, ctx);
  }
  const oauthMatch = path.match(/^\/auth\/oauth\/([^/]+)(\/callback)?$/);
  if (oauthMatch) {
    const providerName = oauthMatch[1]!;
    const isCallback = !!oauthMatch[2];
    if (isCallback)
      return handleOAuthCallback(url, providerName, tenantId, ctx);
    return handleOAuthRedirect(providerName, url, ctx);
  }

  return json({ error: 'Not Found' }, 404);
}

// ---------------------------------------------------------------------------
// Handler: Create entity
// ---------------------------------------------------------------------------

async function handleCreate(
  req: Request,
  auth: import('./auth.js').AuthContext,
  tenantId: string | null,
  ctx: RouteCtx,
): Promise<Response> {
  const body = (await req.json()) as {
    type: string;
    attributes?: Record<string, unknown>;
    links?: Array<{ attribute: string; targetEntityId: string }>;
  };

  if (!body.type) return json({ error: 'type is required' }, 400);

  ctx.permissions?.assert(auth, body.type, 'create');

  const kernel = ctx.pool.get(tenantId);
  const entityId = `${body.type.toLowerCase()}:${crypto.randomUUID()}`;
  const attrs: Record<string, import('../core/store/eav-store.js').Atom> = {
    ...(body.attributes as any),
  };

  if (auth.userId) attrs.createdBy = auth.userId;
  if (auth.tenantId) attrs.tenantId = auth.tenantId;

  const result = await kernel.createEntity(
    entityId,
    body.type,
    attrs,
    body.links,
  );
  await ctx.subs.notify(tenantId);

  return json({ id: entityId, op: result.op.hash }, 201);
}

// ---------------------------------------------------------------------------
// Handler: Read entity
// ---------------------------------------------------------------------------

async function handleRead(
  id: string,
  auth: import('./auth.js').AuthContext,
  tenantId: string | null,
  ctx: RouteCtx,
): Promise<Response> {
  const kernel = ctx.pool.get(tenantId);
  const entity = kernel.getEntity(id);
  if (!entity) return json({ error: 'Not Found' }, 404);

  ctx.permissions?.assert(auth, entity.type, 'read', entity);

  return json(entityToJson(entity));
}

// ---------------------------------------------------------------------------
// Handler: Update entity
// ---------------------------------------------------------------------------

async function handleUpdate(
  req: Request,
  id: string,
  auth: import('./auth.js').AuthContext,
  tenantId: string | null,
  ctx: RouteCtx,
): Promise<Response> {
  const kernel = ctx.pool.get(tenantId);
  const entity = kernel.getEntity(id);
  if (!entity) return json({ error: 'Not Found' }, 404);

  ctx.permissions?.assert(auth, entity.type, 'update', entity);

  const updates = (await req.json()) as Record<string, unknown>;
  await kernel.updateEntity(id, updates as any);
  await ctx.subs.notify(tenantId);

  return json({ id, updated: true });
}

// ---------------------------------------------------------------------------
// Handler: Delete entity
// ---------------------------------------------------------------------------

async function handleDelete(
  id: string,
  auth: import('./auth.js').AuthContext,
  tenantId: string | null,
  ctx: RouteCtx,
): Promise<Response> {
  const kernel = ctx.pool.get(tenantId);
  const entity = kernel.getEntity(id);
  if (!entity) return json({ error: 'Not Found' }, 404);

  ctx.permissions?.assert(auth, entity.type, 'delete', entity);

  await kernel.deleteEntity(id);
  await ctx.subs.notify(tenantId);

  return json({ id, deleted: true });
}

// ---------------------------------------------------------------------------
// Handler: List entities
// ---------------------------------------------------------------------------

async function handleList(
  url: URL,
  auth: import('./auth.js').AuthContext,
  tenantId: string | null,
  ctx: RouteCtx,
): Promise<Response> {
  const type = url.searchParams.get('type') ?? undefined;
  const limit = parseInt(url.searchParams.get('limit') ?? '100');
  const offset = parseInt(url.searchParams.get('offset') ?? '0');

  const kernel = ctx.pool.get(tenantId);
  let entities = kernel.listEntities(type);

  if (ctx.permissions && type) {
    entities = entities.filter((e) =>
      ctx.permissions!.check(auth, e.type, 'read', e),
    );
  }

  const page = entities.slice(offset, offset + limit);
  return json({
    data: page.map(entityToJson),
    total: entities.length,
    limit,
    offset,
  });
}

// ---------------------------------------------------------------------------
// Handler: Query
// ---------------------------------------------------------------------------

async function handleQuery(
  req: Request,
  auth: import('./auth.js').AuthContext,
  tenantId: string | null,
  ctx: RouteCtx,
): Promise<Response> {
  const body = (await req.json()) as { query: string };
  if (!body.query) return json({ error: 'query is required' }, 400);

  let parsed;
  try {
    parsed = parseSimple(body.query);
  } catch (err) {
    return json({ error: 'Invalid query', message: String(err) }, 400);
  }

  const kernel = ctx.pool.get(tenantId);
  const result = await kernel.query(parsed);
  const bindings = hydrateBindings(
    kernel,
    result.bindings as Record<string, unknown>[],
  );

  return json({
    bindings,
    executionTime: result.executionTime,
  });
}

async function handleCreateOntology(
  req: Request,
  auth: import('./auth.js').AuthContext,
  tenantId: string | null,
  ctx: RouteCtx,
): Promise<Response> {
  const schema = (await req.json()) as import('../core/ontology/types.js').SchemaDefinition;
  if (!schema || !schema['@id'] || !Array.isArray(schema.fields)) {
    return json({ error: 'A SchemaDefinition (with @id and fields) is required' }, 400);
  }
  if ((schema.tier ?? 'user') === 'core') {
    return json({ error: 'Core ontologies are immutable' }, 403);
  }

  const kernel = ctx.pool.get(tenantId);
  const exists = kernel
    .listOntologies()
    .some((ont) => ont['@id'] === schema['@id']);
  if (exists) {
    return json({ id: schema['@id'], registered: false, existed: true }, 200);
  }

  try {
    kernel.createOntology(schema);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists')) {
      return json({ id: schema['@id'], registered: false, existed: true }, 200);
    }
    return json({ error: 'Could not register schema', message: msg }, 409);
  }

  return json({ id: schema['@id'], registered: true }, 201);
}

// ---------------------------------------------------------------------------
// Handler: File upload
// ---------------------------------------------------------------------------

async function handleUpload(
  req: Request,
  auth: import('./auth.js').AuthContext,
  tenantId: string | null,
  ctx: RouteCtx,
): Promise<Response> {
  if (!auth.authenticated && ctx.config.apiKey) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const contentType =
    req.headers.get('content-type') ?? 'application/octet-stream';
  const buffer = new Uint8Array(await req.arrayBuffer());

  const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
  const hash = `blob:${Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;

  const kernel = ctx.pool.get(tenantId);
  const backend =
    kernel.getBackend() as import('../core/persist/sqlite-backend.js').SqliteKernelBackend;

  if (!backend.hasBlob(hash)) {
    backend.putBlob(hash, buffer);
  }

  return json({ hash, size: buffer.length, contentType }, 201);
}

// ---------------------------------------------------------------------------
// Handler: File download
// ---------------------------------------------------------------------------

async function handleFileDownload(
  hash: string,
  ctx: RouteCtx,
  tenantId: string | null,
): Promise<Response> {
  const kernel = ctx.pool.get(tenantId);
  const backend =
    kernel.getBackend() as import('../core/persist/sqlite-backend.js').SqliteKernelBackend;
  const blob = backend.getBlob(hash);
  if (!blob) return json({ error: 'Not Found' }, 404);
  const cleanBuf = blob.buffer.slice(
    blob.byteOffset,
    blob.byteOffset + blob.byteLength,
  ) as ArrayBuffer;
  return new Response(cleanBuf, {
    headers: { 'Content-Type': 'application/octet-stream' },
  });
}

// ---------------------------------------------------------------------------
// Handler: Register
// ---------------------------------------------------------------------------

async function handleRegister(
  req: Request,
  tenantId: string | null,
  ctx: RouteCtx,
): Promise<Response> {
  if (!ctx.config.jwtSecret) {
    return json({ error: 'Auth not configured (no jwtSecret)' }, 501);
  }

  const body = (await req.json()) as {
    email: string;
    password: string;
    name?: string;
  };
  if (!body.email || !body.password) {
    return json({ error: 'email and password are required' }, 400);
  }

  const kernel = ctx.pool.get(tenantId);
  const existing = kernel.listEntities('User', { email: body.email });
  if (existing.length > 0) {
    return json({ error: 'Email already registered' }, 409);
  }

  const userId = `user:${crypto.randomUUID()}`;
  const pwHash = await hashPassword(body.password);
  await kernel.createEntity(userId, 'User', {
    email: body.email,
    name: body.name ?? '',
    passwordHash: pwHash,
    role: 'user',
    ...(tenantId ? { tenantId } : {}),
  });

  const token = await signJwt(
    { sub: userId, email: body.email, roles: ['user'], tenantId },
    ctx.config.jwtSecret,
  );

  return json({ token, userId }, 201);
}

// ---------------------------------------------------------------------------
// Handler: Login
// ---------------------------------------------------------------------------

async function handleLogin(
  req: Request,
  tenantId: string | null,
  ctx: RouteCtx,
): Promise<Response> {
  if (!ctx.config.jwtSecret) {
    return json({ error: 'Auth not configured (no jwtSecret)' }, 501);
  }

  const body = (await req.json()) as { email: string; password: string };
  if (!body.email || !body.password) {
    return json({ error: 'email and password are required' }, 400);
  }

  const kernel = ctx.pool.get(tenantId);
  const users = kernel.listEntities('User', { email: body.email });
  if (users.length === 0) {
    return json({ error: 'Invalid credentials' }, 401);
  }

  const user = users[0]!;
  const pwHashFact = user.facts.find((f) => f.a === 'passwordHash');
  const roleFact = user.facts.find((f) => f.a === 'role');

  if (
    !pwHashFact ||
    !(await verifyPassword(body.password, String(pwHashFact.v)))
  ) {
    return json({ error: 'Invalid credentials' }, 401);
  }

  const role = String(roleFact?.v ?? 'user');
  const token = await signJwt(
    { sub: user.id, email: body.email, roles: [role], tenantId },
    ctx.config.jwtSecret,
  );

  return json({ token, userId: user.id });
}

// ---------------------------------------------------------------------------
// Handler: OAuth redirect
// ---------------------------------------------------------------------------

function handleOAuthRedirect(
  providerName: string,
  url: URL,
  ctx: RouteCtx,
): Response {
  const provider =
    ctx.oauthProviders[providerName] ?? getBuiltinProvider(providerName, ctx);
  if (!provider)
    return json({ error: `Unknown provider: ${providerName}` }, 400);

  const redirectUri = `${url.origin}/auth/oauth/${providerName}/callback`;
  const state = crypto.randomUUID();
  const authUrl = buildOAuthUrl(provider, redirectUri, state);

  return Response.redirect(authUrl, 302);
}

// ---------------------------------------------------------------------------
// Handler: OAuth callback
// ---------------------------------------------------------------------------

async function handleOAuthCallback(
  url: URL,
  providerName: string,
  tenantId: string | null,
  ctx: RouteCtx,
): Promise<Response> {
  if (!ctx.config.jwtSecret) {
    return json({ error: 'Auth not configured (no jwtSecret)' }, 501);
  }

  const code = url.searchParams.get('code');
  if (!code) return json({ error: 'Missing code' }, 400);

  const provider =
    ctx.oauthProviders[providerName] ?? getBuiltinProvider(providerName, ctx);
  if (!provider)
    return json({ error: `Unknown provider: ${providerName}` }, 400);

  const redirectUri = `${url.origin}/auth/oauth/${providerName}/callback`;

  let profile;
  try {
    profile = await exchangeOAuthCode(provider, code, redirectUri);
  } catch (err) {
    return json({ error: 'OAuth exchange failed', message: String(err) }, 400);
  }

  const kernel = ctx.pool.get(tenantId);
  const oauthId = `oauth:${providerName}:${profile.id}`;
  let users = kernel.listEntities('User', { oauthId });
  let userId: string;

  if (users.length === 0) {
    userId = `user:${crypto.randomUUID()}`;
    await kernel.createEntity(userId, 'User', {
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl ?? '',
      oauthId,
      oauthProvider: providerName,
      role: 'user',
      ...(tenantId ? { tenantId } : {}),
    });
  } else {
    userId = users[0]!.id;
  }

  const token = await signJwt(
    { sub: userId, email: profile.email, roles: ['user'], tenantId },
    ctx.config.jwtSecret,
  );

  return json({ token, userId });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBuiltinProvider(
  name: string,
  ctx: RouteCtx,
): import('./auth.js').OAuthProvider | null {
  if (name === 'google') {
    const cid = process.env.GOOGLE_CLIENT_ID;
    const csec = process.env.GOOGLE_CLIENT_SECRET;
    if (!cid || !csec) return null;
    return { ...GOOGLE_PROVIDER, clientId: cid, clientSecret: csec };
  }
  if (name === 'github') {
    const cid = process.env.GITHUB_CLIENT_ID;
    const csec = process.env.GITHUB_CLIENT_SECRET;
    if (!cid || !csec) return null;
    return { ...GITHUB_PROVIDER, clientId: cid, clientSecret: csec };
  }
  return null;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomUUID().replace(/-/g, '');
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMat,
    256,
  );
  const hash = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${salt}:${hash}`;
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, expectedHash] = stored.split(':');
  if (!salt || !expectedHash) return false;
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMat,
    256,
  );
  const hash = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hash === expectedHash;
}

function entityToJson(
  entity: import('../core/kernel/trellis-kernel.js').EntityRecord,
) {
  return entityRecordToPlain(entity);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
