/**
 * Node.js HTTP + WebSocket adapter for the Trellis server.
 *
 * Runs the same request handler as the Bun.serve path, but via Node's
 * `node:http` module and the `ws` library. Used when the host runtime is
 * Node (or WebContainer) rather than Bun.
 *
 * Optional dependency: `ws`. Install only if you intend to run Trellis
 * outside of Bun.
 *
 * @module trellis/server
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { Server as NodeHttpServer } from 'http';

import type { TrellisHttpServer } from './server-shared.js';

export interface NodeAdapterOptions {
  port: number;
  hostname?: string;
  /**
   * Fetch-style request handler. Receives a standard `Request`, returns a
   * standard `Response`. The HTTP routing module already produces these.
   */
  fetch: (req: Request) => Promise<Response>;
  /** Hooks invoked for each WebSocket lifecycle event. */
  websocket: {
    open: (ws: WsLike) => void | Promise<void>;
    message: (ws: WsLike, data: string | Buffer) => void | Promise<void>;
    close: (ws: WsLike) => void;
  };
}

/**
 * Minimal interface satisfied by both Bun's WebSocket and the `ws` library's
 * WebSocket. The subscription manager only uses `readyState` and `send`.
 */
export interface WsLike {
  readyState: number;
  send(data: string): void;
}

export async function startNodeServer(
  opts: NodeAdapterOptions,
): Promise<TrellisHttpServer> {
  const http = await import('http');

  const httpServer = http.createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const fetchReq = await toFetchRequest(req);
        const fetchRes = await opts.fetch(fetchReq);
        await writeFetchResponse(res, fetchRes);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Internal Server Error', message: msg }));
      }
    },
  );

  let wss: any = null;
  try {
    const { WebSocketServer } = await import('ws');
    wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req: IncomingMessage, socket: any, head: any) => {
      wss.handleUpgrade(req, socket, head, (ws: any) => {
        wss.emit('connection', ws, req);
      });
    });

    wss.on('connection', (ws: any) => {
      Promise.resolve(opts.websocket.open(ws)).catch(() => {});
      ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        const data = Array.isArray(raw)
          ? Buffer.concat(raw).toString()
          : raw instanceof ArrayBuffer
            ? Buffer.from(raw).toString()
            : raw.toString();
        Promise.resolve(opts.websocket.message(ws, data)).catch(() => {});
      });
      ws.on('close', () => opts.websocket.close(ws));
    });
  } catch {
    // HTTP-only fallback (e.g. WebContainer graph UI — no WebSocket needed).
    httpServer.on('upgrade', (_req, socket) => {
      socket.destroy();
    });
  }

  await new Promise<void>((resolve) =>
    httpServer.listen(opts.port, opts.hostname, resolve),
  );

  // After listen() resolves, read the actually-bound address — handles the
  // common "port 0" case where the OS picks an ephemeral port.
  const addr = httpServer.address();
  const boundPort =
    typeof addr === 'object' && addr ? addr.port : opts.port;
  const boundHost =
    typeof addr === 'object' && addr ? addr.address : opts.hostname;

  return wrapNodeServer(httpServer, wss, boundPort, boundHost);
}

async function toFetchRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? 'localhost';
  const protocol = (req as any).socket?.encrypted ? 'https' : 'http';
  const url = `${protocol}://${host}${req.url ?? '/'}`;
  const method = req.method ?? 'GET';

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value != null) {
      headers.set(key, value);
    }
  }

  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body = hasBody
    ? new Uint8Array(await readBody(req))
    : undefined;
  return new Request(url, { method, headers, body });
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function writeFetchResponse(
  res: ServerResponse,
  fetchRes: Response,
): Promise<void> {
  res.statusCode = fetchRes.status;
  fetchRes.headers.forEach((value, key) => res.setHeader(key, value));
  if (!fetchRes.body) {
    res.end();
    return;
  }
  const reader = fetchRes.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

function wrapNodeServer(
  httpServer: NodeHttpServer,
  wss: any,
  port: number,
  hostname?: string,
): TrellisHttpServer {
  return {
    port,
    hostname: hostname ?? 'localhost',
    stop(closeActiveConnections?: boolean): Promise<void> {
      return new Promise((resolve, reject) => {
        const closeHttp = () => {
          httpServer.close((err?: Error) => (err ? reject(err) : resolve()));
        };
        if (!wss) {
          closeHttp();
          return;
        }
        if (closeActiveConnections) {
          for (const client of wss.clients) client.terminate();
        }
        wss.close(() => closeHttp());
      });
    },
  };
}
