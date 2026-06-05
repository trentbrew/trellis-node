#!/usr/bin/env node
/**
 * Dev server for the Trellis WebContainer sandbox.
 *
 * Sets COOP/COEP headers required by WebContainers and serves:
 *   GET /                  → index.html
 *   GET /dist/*            → trellis dist/ files
 *   GET /api/bootstrap     → dist pack + bin/trellis.mjs for WC mount
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRELLIS_ROOT = path.join(__dirname, '../..');
const DIST_DIR = path.join(TRELLIS_ROOT, 'dist');
const BIN_PATH = path.join(TRELLIS_ROOT, 'bin/trellis.mjs');

const MIME = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

function mime(p) {
  return MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream';
}

/** Recursively collect dist JS/map files → { relativePath → utf8 content } */
function packDir(dir, base = dir) {
  const result = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      Object.assign(result, packDir(full, base));
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (['.js', '.map'].includes(ext)) {
        result[rel] = fs.readFileSync(full, 'utf8');
      }
    }
  }
  return result;
}

const PACKAGE_JSON = {
  name: 'trellis-wc-sandbox',
  version: '0.0.0',
  private: true,
  type: 'module',
  bin: { trellis: './bin/trellis.mjs' },
  dependencies: {
    'sql.js': '^1.14.1',
    commander: '^13.1.0',
    chalk: '^5.4.1',
    '@inquirer/prompts': '^8.2.2',
    zod: '3',
    ws: '^8.20.1',
  },
};

/** Forwarded trellis ui base URL inside WebContainer (set by the page). */
let wcGraphBase = null;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function proxyGraphApi(res) {
  if (!wcGraphBase) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'WebContainer graph server not registered yet' }));
    return;
  }
  const target = `${wcGraphBase.replace(/\/$/, '')}/api/graph`;
  try {
    const upstream = await fetch(target);
    const body = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(body);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'Graph proxy failed',
      message: err?.message ?? String(err),
      target,
    }));
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/' || pathname === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }

  if (pathname === '/api/bootstrap') {
    if (!fs.existsSync(DIST_DIR)) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'dist/ not found — run: npm run build' }));
      return;
    }
    if (!fs.existsSync(BIN_PATH)) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'bin/trellis.mjs not found' }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        packageJson: PACKAGE_JSON,
        binTrellis: fs.readFileSync(BIN_PATH, 'utf8'),
        dist: packDir(DIST_DIR),
        clientHtml: (() => {
          const p = path.join(DIST_DIR, 'ui/client.html');
          return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
        })(),
        version: JSON.parse(
          fs.readFileSync(path.join(TRELLIS_ROOT, 'package.json'), 'utf8'),
        ).version,
      }),
    );
    return;
  }

  // Register WebContainer-forwarded trellis ui URL (avoids browser CORS).
  if (pathname === '/api/wc-target' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (!body.base || typeof body.base !== 'string') {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'body.base required' }));
        return;
      }
      wcGraphBase = body.base;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, base: wcGraphBase }));
    } catch (err) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err?.message ?? 'invalid json' }));
    }
    return;
  }

  // Same-origin graph poll — proxied to trellis ui inside WebContainer.
  if (pathname === '/api/graph' && req.method === 'GET') {
    await proxyGraphApi(res);
    return;
  }

  // Legacy alias
  if (pathname === '/api/dist-pack') {
    req.url = '/api/bootstrap';
    server.emit('request', req, res);
    return;
  }

  if (pathname.startsWith('/dist/')) {
    const rel = pathname.slice('/dist/'.length);
    const filePath = path.resolve(DIST_DIR, rel);
    if (!filePath.startsWith(DIST_DIR)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type', mime(filePath));
    res.end(fs.readFileSync(filePath));
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

const PORT = Number(process.env.PORT ?? 4321);
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Kill the old server:  lsof -ti :${PORT} | xargs kill -9`);
    console.error(`  Or use another port:   PORT=4322 npm run test:wc\n`);
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Trellis WebContainer sandbox`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  Requires: npm run build\n`);
});
