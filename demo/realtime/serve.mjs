// Static files + WebSocket relay (with in-memory persistence) for realtime demos.
// Usage: node demo/realtime/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { RelayPersistence } from '../../dist/realtime/relay-persistence.js';

const root = process.cwd();
const port = Number(process.argv[2] ?? 8231);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
};

/** @type {Set<import('ws').WebSocket>} */
const relayClients = new Set();
const persistence = new RelayPersistence();

const wss = new WebSocketServer({ noServer: true });

function sendReplay(ws) {
  const messages = persistence.buildReplay();
  if (messages.length === 0) return;
  ws.send(
    JSON.stringify({
      v: 1,
      t: 'replay',
      from: 'relay',
      messages,
    }),
  );
}

function deliverReplay(ws, replaySent) {
  if (replaySent.value) return;
  replaySent.value = true;
  sendReplay(ws);
}

wss.on('connection', (ws) => {
  relayClients.add(ws);
  const replaySent = { value: false };

  // Fallback when hello races the UI mounting subscribers.
  setTimeout(() => deliverReplay(ws, replaySent), 250);

  ws.on('message', (data, isBinary) => {
    const payload = isBinary ? data : String(data);
    let message;
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }
    if (message?.v === 1) {
      if (message.t === 'hello') deliverReplay(ws, replaySent);
      persistence.record(message);
    }
    for (const peer of relayClients) {
      if (peer === ws || peer.readyState !== peer.OPEN) continue;
      peer.send(payload);
    }
  });

  ws.on('close', () => {
    relayClients.delete(ws);
  });
});

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (path === '/') path = '/demo/realtime/index.html';
    const filePath = normalize(join(root, path));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': TYPES[extname(filePath)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.on('upgrade', (req, socket, head) => {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/rt' || path === '/rt/') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
    return;
  }
  socket.destroy();
});

server.listen(port, () => {
  console.log(`serving ${root} at http://localhost:${port}/`);
  console.log(
    `relay  ws://localhost:${port}/rt  (cross-browser; in-memory persistence)`,
  );
});
