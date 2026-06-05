#!/usr/bin/env node
/**
 * Sync the Svelte realtime explorer from the sandbox into demo/realtime-app.
 *
 *   node scripts/sync-realtime-app.mjs
 *   REALTIME_APP_SRC=/path/to/realtime-app node scripts/sync-realtime-app.mjs
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SRC = path.resolve(
  ROOT,
  '../../turtle/projects/sandbox/svelte-remote-functions/realtime-app',
);
const SRC = path.resolve(process.env.REALTIME_APP_SRC ?? DEFAULT_SRC);
const DEST = path.join(ROOT, 'demo/realtime-app');

if (!existsSync(SRC)) {
  console.error(`Source not found: ${SRC}`);
  console.error('Set REALTIME_APP_SRC or clone the sandbox realtime-app first.');
  process.exit(1);
}

const excludes = [
  'node_modules',
  '.git',
  '.svelte-kit',
  'test-results',
  '.vercel',
  '.playwright-mcp',
];

const args = ['-a', '--delete', ...excludes.flatMap((e) => ['--exclude', e]), `${SRC}/`, `${DEST}/`];

console.log(`Syncing realtime-app\n  from ${SRC}\n  to   ${DEST}`);
const r = spawnSync('rsync', args, { stdio: 'inherit' });
if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);

// Fix trellis package link for in-repo layout
const pkgPath = path.join(DEST, 'package.json');
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.dependencies?.trellis?.startsWith('file:')) {
    pkg.dependencies.trellis = 'file:../..';
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, '\t')}\n`);
  }
}

console.log('Done. Run: cd demo/realtime-app && pnpm install && pnpm dev:all');
