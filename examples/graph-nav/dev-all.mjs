#!/usr/bin/env node
/**
 * Start Trellis entity server + Vite without a concurrently dependency.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

if (!existsSync(viteBin)) {
	console.error('Missing vite — run: pnpm install');
	process.exit(1);
}

/** @param {string} cmd @param {string[]} args */
function run(cmd, args) {
	return spawn(cmd, args, {
		cwd: root,
		stdio: 'inherit',
		env: process.env,
	});
}

const children = [run('node', ['server.mjs']), run(process.execPath, [viteBin])];

let exiting = false;

/** @param {number} code */
function shutdown(code = 0) {
	if (exiting) return;
	exiting = true;
	for (const child of children) child.kill('SIGTERM');
	setTimeout(() => process.exit(code), 100);
}

for (const child of children) {
	child.on('exit', (code) => {
		if (exiting) return;
		shutdown(code ?? 1);
	});
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
