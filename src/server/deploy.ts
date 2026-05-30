/**
 * Trellis DB — Sprites Deployment
 *
 * Deploys a Trellis DB server to a Sprites cloud environment.
 *
 * Sprites is a cloud VM platform. Each Sprite gets a persistent URL:
 *   https://<name>.sprites.app
 *
 * Deployment steps:
 *   1. Bundle the server entrypoint with Bun
 *   2. Create or wake the target Sprite via `sprite exec`
 *   3. Upload the bundle + SQLite file (if seeding)
 *   4. Install dependencies and start the server as a detached session
 *   5. Write the resulting URL + API key back to .trellis-db.json
 *
 * Prerequisites:
 *   - `sprite` CLI installed and authenticated (https://docs.sprites.dev)
 *   - SPRITES_API_KEY env var (or passed directly)
 *
 * @module trellis/server
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { updateConfig } from '../client/config.js';
import { assertSpriteCli, runSpriteCmd, runSpriteCopy } from './sprites.js';

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
  const { name, port = 3000, configDir = '.', onProgress = () => {} } = opts;

  const apiKey = opts.apiKey ?? generateSecret('spk_');
  const jwtSecret = opts.jwtSecret ?? generateSecret('jws_');
  const url = `https://${name}.sprites.app`;

  // ── Step 1: Check `sprite` CLI is available ───────────────────────────────
  onProgress('Checking Sprites CLI...');
  await runSpriteCmd(['--version']).catch(() => {
    throw new Error(
      '`sprite` CLI not found. Install it from https://docs.sprites.dev and authenticate.',
    );
  });

  // ── Step 2: Write server entrypoint ──────────────────────────────────────
  onProgress('Writing server entrypoint...');
  const tmpDir = resolve(configDir, '.trellis-deploy');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const entrypoint = join(tmpDir, 'server-entry.ts');
  writeFileSync(
    entrypoint,
    generateServerEntrypoint({ port, apiKey, jwtSecret }),
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

  // ── Step 4: Upload bundle to Sprite ──────────────────────────────────────
  onProgress(`Uploading to Sprite: ${name}...`);
  await runSpriteCmd([
    'exec',
    '--sprite',
    name,
    'mkdir',
    '-p',
    '/home/sprite/trellis-db',
  ]);

  await runSpriteCopy(bundlePath, name, '/home/sprite/trellis-db/server.js');

  // ── Step 5: Install Bun on the Sprite (if needed) ────────────────────────
  onProgress('Ensuring Bun is installed...');
  await runSpriteCmd([
    'exec',
    '--sprite',
    name,
    'bash',
    '-c',
    'which bun || curl -fsSL https://bun.sh/install | bash',
  ]).catch(() => {});

  // ── Step 6: Kill any existing server session ──────────────────────────────
  onProgress('Starting server...');
  await runSpriteCmd([
    'exec',
    '--sprite',
    name,
    'bash',
    '-c',
    "sprite sessions list 2>/dev/null | grep trellis-db | awk '{print $1}' | xargs -r sprite sessions kill",
  ]).catch(() => {});

  // ── Step 7: Start as a detached session ──────────────────────────────────
  await runSpriteCmd([
    'exec',
    '--sprite',
    name,
    '-tty',
    '--detach',
    '--session-name',
    'trellis-db',
    'bash',
    '-c',
    `cd /home/sprite/trellis-db && ~/.bun/bin/bun run server.js`,
  ]);

  // ── Step 8: Write config ──────────────────────────────────────────────────
  onProgress('Writing .trellis-db.json...');
  updateConfig(
    {
      mode: 'remote',
      url,
      apiKey,
      spriteName: name,
      deployedAt: new Date().toISOString(),
    },
    configDir,
  );

  return { url, name, apiKey };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync('bun', args);
  } catch (err: any) {
    throw new Error(
      `bun ${args[0]} failed (exit ${err.code ?? '?'}): ${err.stderr ?? err.message}`,
    );
  }
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
  return `
import { TenantPool, startServer } from 'trellis/server';
import { readConfig, defaultLocalConfig, writeConfig } from 'trellis/client';
import { join } from 'path';
import { existsSync } from 'fs';

const dbPath = '/home/sprite/trellis-db/data';
const configDir = '/home/sprite/trellis-db';

if (!existsSync(join(configDir, '.trellis-db.json'))) {
  writeConfig(defaultLocalConfig(dbPath, {
    apiKey: '${opts.apiKey}',
    jwtSecret: '${opts.jwtSecret}',
    port: ${opts.port},
  }), configDir);
}

const config = readConfig(configDir)!;
const pool = new TenantPool(dbPath);

const server = startServer({ port: ${opts.port}, config, pool });

console.log('Trellis DB running on port ${opts.port}');
console.log('URL: https://\${process.env.SPRITE_NAME ?? 'localhost'}.sprites.app');
`;
}
