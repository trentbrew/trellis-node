#!/usr/bin/env node
/**
 * Inside WebContainer: init trellis DB, start sidecar + Vite (foreground).
 */
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const trellisBin = join(root, 'vendor/trellis/bin/trellis.mjs');

function run(cmd, args, opts = {}) {
	return spawn(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
}

if (!existsSync(join(root, '.trellis-db.json'))) {
	const init = spawnSync(
		process.execPath,
		[trellisBin, 'db', 'init', '--path', '.trellis-db', '--port', '3920'],
		{ cwd: root, stdio: 'inherit' }
	);
	if (init.status !== 0) process.exit(init.status ?? 1);
	spawnSync(process.execPath, [join(root, 'scripts/trellis-seed.mjs')], {
		cwd: root,
		stdio: 'inherit'
	});
}

if (!existsSync(join(root, '.trellis'))) {
	spawnSync(process.execPath, [join(root, 'scripts/trellis-vcs-init.mjs')], {
		cwd: root,
		stdio: 'inherit'
	});
}

const sidecar = run(process.execPath, [join(root, 'scripts/trellis-serve.mjs')], {
	env: { ...process.env, TRELLIS_BACKEND: 'sqljs', TRELLIS_PORT: '3920' }
});

const vite = run(process.execPath, [
	join(root, 'node_modules/vite/bin/vite.js'),
	'dev',
	'--host',
	'0.0.0.0',
	'--port',
	'4000'
]);

function shutdown() {
	sidecar.kill('SIGTERM');
	vite.kill('SIGTERM');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

vite.on('exit', (code) => {
	shutdown();
	process.exit(code ?? 0);
});
