/**
 * Reference Durable Object relay — the concrete paid-tier target for
 * {@link DurableObjectRelayTransport}.
 *
 * This is the *server* the browser transport connects to. It implements the
 * exact same contract as `createRealtimeRelay` (dumb fan-out + disposable
 * replay via the substrate's `RelayPersistence`), but as a Cloudflare Durable
 * Object so each room is a single-writer-serialized object at the edge — which
 * matches Trellis's per-graph causality assumption (see ECOSYSTEM.md §4.4).
 *
 * Deliberately NOT a PartyKit project: the telos says build against DO
 * primitives directly rather than bet on a wrapper. PartyKit would be a thin
 * shim over this same shape if you want its DX.
 *
 * This file is a deploy reference, not part of the npm build (it lives under
 * `demo/`, outside the package `src/`). Deploy with `wrangler`:
 *
 *   # wrangler.toml
 *   name = "trellis-relay"
 *   main = "worker.ts"
 *   compatibility_date = "2024-09-23"
 *   [[durable_objects.bindings]]
 *   name = "RELAY_ROOM"
 *   class_name = "RealtimeRelayRoom"
 *   [[migrations]]
 *   tag = "v1"
 *   new_classes = ["RealtimeRelayRoom"]
 *
 * Client: new DurableObjectRelayTransport({ id, url: 'wss://trellis-relay.…workers.dev', room })
 */

// Production: `import type { RealtimeMessage } from 'trellis/realtime'` and
// `import { RelayPersistence } from 'trellis/realtime'`. Inlined-by-reference
// here so the file reads standalone; the runtime types come from
// `@cloudflare/workers-types`.
import { RelayPersistence } from 'trellis/realtime';
import type { RealtimeMessage } from 'trellis/realtime';

// Minimal structural CF runtime types (use @cloudflare/workers-types in a real
// project; declared locally so this reference compiles without that dep).
interface CfWebSocket {
  accept(): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message' | 'close', cb: (event: any) => void): void;
  readyState: number;
}
interface DurableObjectState {
  acceptWebSocket?(ws: CfWebSocket): void;
}
interface Env {
  RELAY_ROOM: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(req: Request): Promise<Response> };
  };
}
declare const WebSocketPair: {
  new (): { 0: CfWebSocket; 1: CfWebSocket };
};

const WS_OPEN = 1;

/** One Durable Object instance == one room. */
export class RealtimeRelayRoom {
  private sockets = new Set<CfWebSocket>();
  private persistence = new RelayPersistence();

  constructor(_state: DurableObjectState, _env: Env) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.sockets.add(server);

    let replaySent = false;
    const deliverReplay = () => {
      if (replaySent) return;
      replaySent = true;
      const messages = this.persistence.buildReplay();
      if (messages.length === 0) return;
      const frame: RealtimeMessage = { v: 1, t: 'replay', from: 'relay', messages };
      server.send(JSON.stringify(frame));
    };
    // Grace fallback when the socket opens before the client sends `hello`.
    setTimeout(deliverReplay, 250);

    server.addEventListener('message', (event: { data: string }) => {
      let message: RealtimeMessage;
      try {
        message = JSON.parse(String(event.data)) as RealtimeMessage;
      } catch {
        return;
      }
      if (message?.v === 1) {
        if (message.t === 'hello') deliverReplay();
        this.persistence.record(message);
      }
      const raw = String(event.data);
      for (const peer of this.sockets) {
        if (peer === server || peer.readyState !== WS_OPEN) continue;
        peer.send(raw);
      }
    });

    server.addEventListener('close', () => {
      this.sockets.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client } as ResponseInit & {
      webSocket: CfWebSocket;
    });
  }
}

export default {
  /** Route `wss://host/{room}` to the Durable Object for that room. */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const room = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'default';
    const id = env.RELAY_ROOM.idFromName(room);
    return env.RELAY_ROOM.get(id).fetch(request);
  },
};
