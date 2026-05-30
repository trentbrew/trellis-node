/**
 * WebContainer/Node smoke test.
 *
 * Verifies that the built `dist/` runs end-to-end under Node (no Bun):
 *   1. Loads dist modules without `bun:sqlite` errors
 *   2. Boots a TenantPool with the sql.js WASM backend (via preload)
 *   3. Starts the cross-runtime server (node:http + ws)
 *   4. Roundtrips a /health request
 *   5. Shuts down cleanly
 *
 * Run with: node examples/webcontainer-smoke.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  TenantPool,
  startServerCrossRuntime,
} from '../dist/server/index.js';

const dataDir = mkdtempSync(join(tmpdir(), 'trellis-smoke-'));
let server;
let exitCode = 0;

const log = (step, msg) =>
  console.log(`[${step.toString().padStart(2, '0')}] ${msg}`);

try {
  log(1, `tmp dir: ${dataDir}`);

  log(2, 'constructing TenantPool');
  const pool = new TenantPool(dataDir);

  log(3, 'preloading default tenant (sql.js WASM)');
  const kernel = await pool.preload();
  if (!kernel) throw new Error('preload returned null');

  log(4, 'starting cross-runtime server on ephemeral port');
  server = await startServerCrossRuntime({
    port: 0,
    config: { mode: 'local', dbPath: dataDir, apiKey: 'smoke-key' },
    pool,
  });
  // server.hostname may be a wildcard (e.g. "::"); use loopback for the client.
  const clientHost = '127.0.0.1';
  log(4, `  → listening, port ${server.port} (client URL: http://${clientHost}:${server.port})`);

  log(5, 'GET /health');
  const res = await fetch(`http://${clientHost}:${server.port}/health`);
  if (!res.ok) throw new Error(`health check failed: ${res.status}`);
  const body = await res.json();
  log(5, `  → ${JSON.stringify(body)}`);
  if (body.status !== 'ok') throw new Error(`unexpected health body: ${JSON.stringify(body)}`);

  log(6, 'stopping server');
  await server.stop();
  server = null;

  log(7, 'closing pool');
  pool.closeAll();

  console.log('\n✓ smoke test passed');
} catch (err) {
  console.error('\n✗ smoke test FAILED:', err?.message ?? err);
  console.error(err?.stack ?? '');
  exitCode = 1;
} finally {
  try {
    if (server) await server.stop();
  } catch {}
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {}
  process.exit(exitCode);
}
