#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const shared = resolve(appRoot, '../../scripts/ensure-linked-trellis.mjs');
const result = spawnSync('node', [shared, appRoot], { stdio: 'inherit' });
process.exit(result.status ?? 1);
