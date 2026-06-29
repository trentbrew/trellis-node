/**
 * Trellis DB — Sprites Deployment
 *
 * Deploys a Trellis DB server to a Sprites cloud environment.
 *
 * Sprites is a cloud VM platform. Each Sprite gets a persistent URL from
 * `sprite url` (typically `https://<name>-<org>.sprites.app`).
 *
 * Deployment steps:
 *   1. Bundle the server entrypoint with Bun
 *   2. Create or wake the target Sprite via `sprite exec`
 *   3. Upload the bundle + SQLite file (if seeding)
 *   4. Install Bun and register the server via `sprite-env services` (port 8080)
 *   5. Write the resulting URL + API key back to .trellis-db.json
 *
 * Prerequisites:
 *   - `sprite` CLI installed and authenticated (https://docs.sprites.dev)
 *   - SPRITES_API_KEY env var (or passed directly)
 *
 * @module trellis/server
 */

import { execFile } from 'child_process';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { updateConfig } from '../client/config.js';
import {
  buildDeployUrl,
  SPRITE_PUBLIC_HTTP_PORT,
  validateDeployName,
} from './deploy-meta.js';
import {
  assertSpriteCli,
  ensureSprite,
  ensureSpritePublicAccess,
  resolveSpritePublicUrl,
  runSpriteCopy,
  runSpriteExec,
  SPRITE_ENSURE_BUN_SH,
} from './sprites.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployOptions {
  /** Sprite name (becomes the subdomain: <name>.sprites.app). */
  name: string;
  /** Path to the local .trellis-db directory to deploy. */
  dbPath?: string;
  /** API key for the deployed server. Auto-generated if not provided. */
  apiKey?: string;
  /** JWT secret for the deployed server. Auto-generated if not provided. */
  jwtSecret?: string;
  /** Port to run on inside the Sprite (default: 3000). */
  port?: number;
  /** Directory where .trellis-db.json lives. Default: cwd. */
  configDir?: string;
  /** Progress callback. */
  onProgress?: (msg: string) => void;
  /**
   * Skip Sprite provisioning — validate name and write `.trellis-db.json` only.
   * For local dry-runs and CI (`trellis deploy --stub`).
   */
  stub?: boolean;
}

export interface DeployResult {
  url: string;
  name: string;
  apiKey: string;
}

// ---------------------------------------------------------------------------
// Main deploy function
// ---------------------------------------------------------------------------

export async function deploy(opts: DeployOptions): Promise<DeployResult> {
  const { configDir = '.', onProgress = () => {} } = opts;
  // Sprites public URL routes to 8080 by default — not the generic CLI default (3000).
  const listenPort = opts.port ?? SPRITE_PUBLIC_HTTP_PORT;

  const name = validateDeployName(opts.name);
  const apiKey = opts.apiKey ?? generateSecret('spk_');
  const jwtSecret = opts.jwtSecret ?? generateSecret('jws_');

  if (opts.stub) {
    const url = buildDeployUrl(name);
    onProgress('Stub deploy — skipping Sprites provisioning');
    onProgress('Writing .trellis-db.json...');
    writeRemoteDeployConfig({ name, url, apiKey, configDir });
    return { url, name, apiKey };
  }

  // ── Step 1: Check `sprite` CLI is available ───────────────────────────────
  onProgress('Checking Sprites CLI...');
  await assertSpriteCli();

  // ── Step 2: Write server entrypoint ──────────────────────────────────────
  onProgress('Writing server entrypoint...');
  const tmpDir = resolve(configDir, '.trellis-deploy');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const entrypoint = join(tmpDir, 'server-entry.ts');
  writeFileSync(
    entrypoint,
    generateServerEntrypoint({ port: listenPort, apiKey, jwtSecret }),
  );

  // ── Step 3: Bundle with Bun ───────────────────────────────────────────────
  onProgress('Bundling server with Bun...');
  const bundlePath = join(tmpDir, 'server.js');
  await runBun([
    'build',
    entrypoint,
    '--outfile',
    bundlePath,
    '--target',
    'bun',
    '--format',
    'esm',
  ]);

  // ── Step 4: Ensure Sprite exists + public URL ─────────────────────────────
  onProgress(`Ensuring Sprite: ${name}...`);
  await ensureSprite(name);
  onProgress('Configuring public URL...');
  await ensureSpritePublicAccess(name);
  const url = await resolveSpritePublicUrl(name);

  // ── Step 5: Upload bundle to Sprite ─────────────────────────────────────
  onProgress(`Uploading to Sprite: ${name}...`);
  await runSpriteExec(name, 'mkdir -p /home/sprite/trellis-db');
  await runSpriteCopy(bundlePath, name, '/home/sprite/trellis-db/server.js');

  // ── Step 6: Install Bun on the Sprite (if needed) ─────────────────────────
  onProgress('Ensuring Bun is installed...');
  const bunPath = await runSpriteExec(name, SPRITE_ENSURE_BUN_SH);
  if (!bunPath.includes('bun')) {
    throw new Error(`Bun install failed on sprite ${name}: ${bunPath || '(no output)'}`);
  }

  // ── Step 7: Register Trellis DB as a Sprite service (survives hibernation) ─
  onProgress('Starting server (sprite-env service)...');
  const bun = bunPath.trim().split('\n').pop()!.trim();
  await runSpriteExec(
    name,
    `
export PATH="$HOME/.bun/bin:$PATH"
ENV="/.sprite/bin/sprite-env"
BUN="${bun}"
$ENV services delete trellis-db 2>/dev/null || true
$ENV services create trellis-db \\
  --cmd "$BUN" \\
  --args run,server.js \\
  --dir /home/sprite/trellis-db \\
  --http-port ${listenPort} \\
  --no-stream
`.trim(),
  );

  onProgress('Waiting for health check...');
  await waitForDeployHealth(url, 60_000);

  // ── Step 8: Write local remote config ─────────────────────────────────────
  onProgress('Writing .trellis-db.json...');
  writeRemoteDeployConfig({ name, url, apiKey, configDir });

  return { url, name, apiKey };
}

function writeRemoteDeployConfig(opts: {
  name: string;
  url: string;
  apiKey: string;
  configDir: string;
}): void {
  updateConfig(
    {
      mode: 'remote',
      url: opts.url,
      apiKey: opts.apiKey,
      spriteName: opts.name,
      deployedAt: new Date().toISOString(),
    },
    opts.configDir,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForDeployHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `${url.replace(/\/$/, '')}/health`;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl);
      lastStatus = res.status;
      if (res.ok) return;
    } catch {
      /* sprite may still be waking */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    `Deploy health check timed out (${healthUrl}${lastStatus ? `, last status ${lastStatus}` : ''})`,
  );
}

function generateSecret(prefix: string): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${prefix}${b64}`;
}

async function runBun(args: string[]): Promise<void> {
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync('bun', args);
  } catch (err: any) {
    throw new Error(
      `bun ${args[0]} failed (exit ${err.code ?? '?'}): ${err.stderr ?? err.message}`,
    );
  }
}

function resolveTrellisImports(): { server: string; client: string } {
  const root = process.env.TRELLIS_NODE_ROOT?.trim();
  if (root) {
    return {
      server: join(root, 'dist/server/index.js').replace(/\\/g, '/'),
      client: join(root, 'dist/client/index.js').replace(/\\/g, '/'),
    };
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const packageRoots = [resolve(here, '..'), resolve(here, '..', '..')];
  for (const packageRoot of packageRoots) {
    const server = join(packageRoot, 'dist/server/index.js');
    const client = join(packageRoot, 'dist/client/index.js');
    if (existsSync(server) && existsSync(client)) {
      return {
        server: server.replace(/\\/g, '/'),
        client: client.replace(/\\/g, '/'),
      };
    }
  }
  return { server: 'trellis/server', client: 'trellis/client' };
}

/**
 * Generate a self-contained server entrypoint script that starts the
 * Trellis DB HTTP server with the given config baked in.
 */
function generateServerEntrypoint(opts: {
  port: number;
  apiKey: string;
  jwtSecret: string;
}): string {
  const { server, client } = resolveTrellisImports();
  return `
import { TenantPool, startServer } from '${server}';
import { readConfig, defaultLocalConfig, writeConfig } from '${client}';
import { join } from 'path';
import { existsSync } from 'fs';

const dbPath = '/home/sprite/trellis-db/data';
const configDir = '/home/sprite/trellis-db';

writeConfig(defaultLocalConfig(dbPath, {
  apiKey: '${opts.apiKey}',
  jwtSecret: '${opts.jwtSecret}',
  port: ${opts.port},
}), configDir);

const config = readConfig(configDir)!;
// Sprites VMs lack better-sqlite3 native bindings — use WASM sql.js backend.
const pool = new TenantPool(dbPath, { backend: { backend: 'sqljs' } });
await pool.preload();

await startServer({ port: ${opts.port}, config, pool, presenceRelay: true });

console.log('Trellis DB running on port ${opts.port}');
console.log(\`Listening on port ${opts.port}\`);
`;
}
