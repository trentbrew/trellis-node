#!/usr/bin/env node
/**
 * Dev server for the WebContainer test page.
 *
 * Sets the COOP/COEP headers required by WebContainers and serves:
 *   GET /                  → index.html
 *   GET /dist/*            → trellis dist/ files
 *   GET /api/dist-pack     → all dist files as one JSON bundle (faster mount)
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRELLIS_ROOT = path.join(__dirname, '../..');
const DIST_DIR = path.join(TRELLIS_ROOT, 'dist');

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

// Recursively collect all files under dir, returning { relativePath → utf8 content }
function packDir(dir, base = dir) {
  const result = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      Object.assign(result, packDir(full, base));
    } else {
      // Only JS/map files — skip .d.ts/.html in dist for the pack
      const ext = path.extname(entry.name).toLowerCase();
      if (['.js', '.map'].includes(ext)) {
        result[rel] = fs.readFileSync(full, 'utf8');
      }
    }
  }
  return result;
}

const server = http.createServer((req, res) => {
  // WebContainer requires these two headers.
  // credentialless is less strict than require-corp and allows CDN resources.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // ── Index ─────────────────────────────────────────────────────────────────
  if (pathname === '/' || pathname === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }

  // ── dist-pack: all dist JS files in one JSON response ─────────────────────
  if (pathname === '/api/dist-pack') {
    if (!fs.existsSync(DIST_DIR)) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'dist/ not found — run: npm run build' }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(packDir(DIST_DIR)));
    return;
  }

  // ── Individual dist files ─────────────────────────────────────────────────
  if (pathname.startsWith('/dist/')) {
    const rel = pathname.slice('/dist/'.length);
    const filePath = path.resolve(DIST_DIR, rel);
    if (!filePath.startsWith(DIST_DIR)) { res.statusCode = 403; res.end(); return; }
    if (!fs.existsSync(filePath)) { res.statusCode = 404; res.end('Not found'); return; }
    res.setHeader('Content-Type', mime(filePath));
    res.end(fs.readFileSync(filePath));
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

const PORT = Number(process.env.PORT ?? 4321);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Trellis WebContainer test`);
  console.log(`  → http://localhost:${PORT}\n`);
});
