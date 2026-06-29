/**
 * Trellis Realtime — Relay Hub (server side)
 *
 * The server counterpart to {@link WebSocketRelayTransport}: a dumb broadcast
 * mesh that fans every inbound frame out to all *other* connected peers, with
 * optional in-memory replay ({@link RelayPersistence}) so a late joiner catches
 * up on presence / chat tail / text state.
 *
 * This is intentionally NOT {@link RealtimeRoom}. `RealtimeRoom` is a *client*
 * abstraction — one peer's view of a room (its own presence + observed peers).
 * The relay holds no presence of its own; it only moves bytes between peers and
 * remembers enough to replay. Keep the two roles distinct: clients run
 * `RealtimeRoom`, the server runs a relay.
 *
 * Room-scoped: peers are fanned out (and replayed) only to others in the *same*
 * room. The room is taken from the upgrade path — `${path}/{room}` — matching
 * {@link DurableObjectRelayTransport}'s `${url}/{room}` convention (and the
 * reference Durable Object worker, which maps one object per room). A bare
 * connection to `path` lands in the `'default'` room. This makes the bundled
 * relay a faithful local stand-in for the hosted DO: distinct rooms stay
 * isolated, so `joinPresence({ relayUrl })` Just Works against it.
 *
 * Node-only (uses `node:http` + the optional `ws` package). Exposed through
 * `trellis/server`, never `trellis/realtime` (which is browser-bundled).
 *
 *   import { createServer } from 'node:http';
 *   import { attachRealtimeRelay } from 'trellis/server';
 *
 *   const server = createServer(handler);
 *   await attachRealtimeRelay(server, { path: '/rt' });
 *   server.listen(8231);
 *   // client: joinPresence({ relayUrl: 'ws://localhost:8231/rt', room: 'doc:42' })
 *   //   → connects to ws://localhost:8231/rt/doc:42
 *
 * @module trellis/server
 */

import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { RelayPersistence } from '../realtime/relay-persistence.js';
import type { RealtimeMessage } from '../realtime/types.js';

/** Minimal structural view of a `ws` socket (avoids a hard `ws` type dep). */
interface RelaySocket {
  readyState: number;
  readonly OPEN: number;
  send(data: string): void;
  close(): void;
  on(event: 'message', cb: (data: unknown, isBinary: boolean) => void): void;
  on(event: 'close', cb: () => void): void;
}

export interface RealtimeRelayOptions {
  /**
   * Base WebSocket upgrade path this relay claims. Default `/rt`. The relay
   * accepts `path` (→ room `'default'`) and `${path}/{room}` (→ that room);
   * other upgrade paths are left untouched so it can coexist with path-scoped
   * WebSocket handlers.
   */
  path?: string;
  /**
   * Per-room replay store factory for late joiners. A fresh store is created
   * the first time a room is seen. Pass `false` to disable replay entirely
   * (pure fan-out). Default: `() => new RelayPersistence()`.
   */
  persistence?: false | (() => RelayPersistence);
  /**
   * Grace window (ms) before replay is delivered to a new connection when no
   * `hello` frame arrives first (UI mounting subscribers can race the socket).
   * Default 250.
   */
  replayGraceMs?: number;
  /** Injectable `ws` WebSocketServer ctor for tests. */
  WebSocketServerImpl?: unknown;
}

export interface RealtimeRelay {
  /** Connected peers — across all rooms, or in `room` when given. */
  clientCount(room?: string): number;
  /** Currently active room ids (rooms drop when their last peer leaves). */
  rooms(): string[];
  /** The replay store for `room`, or `null` when replay is disabled. */
  persistenceFor(room: string): RelayPersistence | null;
  /** Close every peer socket and tear down the WS server. */
  close(): Promise<void>;
}

const REPLAY_GRACE_MS = 250;
const DEFAULT_ROOM = 'default';

/** Browser clients probe `/health` from another origin during local dev. */
const RELAY_HEALTH_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
} as const;

/**
 * Map an upgrade path to its room, or `null` if this relay shouldn't claim it.
 * `path` → `'default'`; `${path}/{room}` → decoded `{room}`.
 */
function roomFromPath(reqPath: string, basePath: string): string | null {
  const normalized = reqPath.replace(/\/+$/, '') || '/';
  const base = basePath.replace(/\/+$/, '') || '/';
  if (normalized === base) return DEFAULT_ROOM;
  const prefix = base === '/' ? '/' : `${base}/`;
  if (!reqPath.startsWith(prefix)) return null;
  const rest = reqPath.slice(prefix.length).split('?')[0].replace(/\/+$/, '');
  return rest ? decodeURIComponent(rest) : DEFAULT_ROOM;
}

/**
 * Mount a realtime relay on an existing HTTP server. Only handles upgrades on
 * `opts.path`; other upgrade paths are left untouched, so this can coexist with
 * other WebSocket handlers (e.g. the graph-subscription socket) **provided
 * those handlers are themselves path-scoped**.
 */
export async function attachRealtimeRelay(
  server: HttpServer,
  opts: RealtimeRelayOptions = {},
): Promise<RealtimeRelay> {
  const path = opts.path ?? '/rt';
  const graceMs = opts.replayGraceMs ?? REPLAY_GRACE_MS;
  const makePersistence =
    opts.persistence === false
      ? null
      : (opts.persistence ?? (() => new RelayPersistence()));

  const Wss = (opts.WebSocketServerImpl ??
    (await import('ws')).WebSocketServer) as new (o: {
    noServer: boolean;
  }) => {
    handleUpgrade(
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      cb: (ws: RelaySocket) => void,
    ): void;
    emit(event: 'connection', ws: RelaySocket, req: IncomingMessage): void;
    on(
      event: 'connection',
      cb: (ws: RelaySocket, req: IncomingMessage) => void,
    ): void;
    close(cb?: () => void): void;
  };

  const wss = new Wss({ noServer: true });

  interface RoomState {
    clients: Set<RelaySocket>;
    persistence: RelayPersistence | null;
  }
  const rooms = new Map<string, RoomState>();
  // Bridges handleUpgrade → connection so the handler knows the room.
  const pendingRoom = new WeakMap<RelaySocket, string>();

  const roomState = (room: string): RoomState => {
    let st = rooms.get(room);
    if (!st) {
      st = { clients: new Set(), persistence: makePersistence?.() ?? null };
      rooms.set(room, st);
    }
    return st;
  };

  const sendReplay = (ws: RelaySocket, st: RoomState): void => {
    if (!st.persistence) return;
    const messages = st.persistence.buildReplay();
    if (messages.length === 0) return;
    const frame: RealtimeMessage = { v: 1, t: 'replay', from: 'relay', messages };
    ws.send(JSON.stringify(frame));
  };

  wss.on('connection', (ws: RelaySocket) => {
    const room = pendingRoom.get(ws) ?? DEFAULT_ROOM;
    pendingRoom.delete(ws);
    const st = roomState(room);
    st.clients.add(ws);

    const replaySent = { value: false };
    const deliverReplay = () => {
      if (replaySent.value) return;
      replaySent.value = true;
      sendReplay(ws, st);
    };

    // Fallback for when the socket opens before the UI mounts subscribers.
    const graceTimer =
      graceMs > 0 ? setTimeout(deliverReplay, graceMs) : null;
    graceTimer?.unref?.();

    ws.on('message', (data: unknown, isBinary: boolean) => {
      const raw = isBinary ? data : String(data);
      let message: RealtimeMessage | undefined;
      try {
        message = JSON.parse(String(raw)) as RealtimeMessage;
      } catch {
        return;
      }
      if (message?.v === 1) {
        if (message.t === 'hello') deliverReplay();
        st.persistence?.record(message);
      }
      for (const peer of st.clients) {
        if (peer === ws || peer.readyState !== peer.OPEN) continue;
        peer.send(String(raw));
      }
    });

    ws.on('close', () => {
      if (graceTimer) clearTimeout(graceTimer);
      st.clients.delete(ws);
      // Drop empty rooms so replay state resets and memory is reclaimed.
      if (st.clients.size === 0) rooms.delete(room);
    });
  });

  const onUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const reqPath = (req.url ?? '').split('?')[0];
    const room = roomFromPath(reqPath, path);
    if (room === null) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      pendingRoom.set(ws, room);
      wss.emit('connection', ws, req);
    });
  };

  server.on('upgrade', onUpgrade);

  return {
    clientCount: (room?: string) => {
      if (room !== undefined) return rooms.get(room)?.clients.size ?? 0;
      let total = 0;
      for (const st of rooms.values()) total += st.clients.size;
      return total;
    },
    rooms: () => [...rooms.keys()],
    persistenceFor: (room: string) => rooms.get(room)?.persistence ?? null,
    close: () =>
      new Promise<void>((resolve) => {
        server.off('upgrade', onUpgrade);
        for (const st of rooms.values()) {
          for (const ws of st.clients) {
            try {
              ws.close();
            } catch {
              /* ignore */
            }
          }
          st.clients.clear();
        }
        rooms.clear();
        wss.close(() => resolve());
      }),
  };
}

export interface StandaloneRealtimeRelayOptions extends RealtimeRelayOptions {
  /** Port to bind. Default 8231. Use 0 for an OS-assigned ephemeral port. */
  port?: number;
  /** Host to bind. Default `0.0.0.0`. */
  hostname?: string;
}

export interface StandaloneRealtimeRelay extends RealtimeRelay {
  /** The bound port (resolved, so `port: 0` reports the real ephemeral port). */
  port: number;
  /** The underlying HTTP server (health check on `/`, 404 otherwise). */
  server: HttpServer;
}

/**
 * Spin up a standalone relay hub on its own HTTP server. The HTTP surface is a
 * health endpoint only (`200` on `/`, `404` elsewhere); the relay lives on the
 * WebSocket upgrade path. For embedding in an existing app server, use
 * {@link attachRealtimeRelay} instead.
 *
 *   const relay = await createRealtimeRelay({ port: 8231 });
 *   // ws://localhost:8231/rt        → room 'default'
 *   // ws://localhost:8231/rt/doc:42 → room 'doc:42' (isolated fan-out)
 *   await relay.close();
 */
export async function createRealtimeRelay(
  opts: StandaloneRealtimeRelayOptions = {},
): Promise<StandaloneRealtimeRelay> {
  const { createServer } = await import('node:http');
  const path = opts.path ?? '/rt';
  const port = opts.port ?? 8231;
  const hostname = opts.hostname ?? '0.0.0.0';

  const server = createServer((req, res) => {
    const reqPath = (req.url ?? '/').split('?')[0];
    if (reqPath === '/' || reqPath === '/health') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, RELAY_HEALTH_CORS);
        res.end();
        return;
      }
      if (req.method === 'GET') {
        res.writeHead(200, {
          'content-type': 'application/json',
          ...RELAY_HEALTH_CORS,
        });
        res.end(JSON.stringify({ ok: true, relay: path }));
        return;
      }
    }
    res.writeHead(404).end('not found');
  });

  const relay = await attachRealtimeRelay(server, opts);

  await new Promise<void>((resolve) => server.listen(port, hostname, resolve));
  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;

  return {
    ...relay,
    port: boundPort,
    server,
    close: async () => {
      await relay.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
