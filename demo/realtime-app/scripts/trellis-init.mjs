#!/usr/bin/env node
/**
 * Initialize .trellis-db.json if missing (port 3920, local sql.js-friendly sidecar).
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '..');
const trellisBin = join(appRoot, '../../bin/trellis.mjs');
const configPath = join(appRoot, '.trellis-db.json');

if (existsSync(configPath)) {
	console.log('Trellis DB already initialized (.trellis-db.json)');
	process.exit(0);
}

const result = spawnSync(
	process.execPath,
	[trellisBin, 'db', 'init', '--path', '.trellis-db', '--port', '3920'],
	{ cwd: appRoot, stdio: 'inherit' }
);

if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

const vcs = spawnSync(process.execPath, [join(__dirname, 'trellis-vcs-init.mjs')], {
	cwd: appRoot,
	stdio: 'inherit'
});
if ((vcs.status ?? 1) !== 0) process.exit(vcs.status ?? 1);

const seed = spawnSync(process.execPath, [join(__dirname, 'trellis-seed.mjs')], {
	cwd: appRoot,
	stdio: 'inherit'
});

process.exit(seed.status ?? 1);
