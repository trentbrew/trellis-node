#!/usr/bin/env node
/**
 * Sync all trellis.computer embed demos (state, chat-graph, query, realtime bundle).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const scripts = [
  'sync-state-demo-docs.mjs',
  'sync-realtime-docs.mjs',
  'sync-chat-graph-docs.mjs',
  'sync-query-demo-docs.mjs',
];

for (const script of scripts) {
  console.log(`\n── ${script} ──`);
  execSync(`node scripts/${script}`, { cwd: ROOT, stdio: 'inherit' });
}

console.log('\nAll docs demos synced.');
