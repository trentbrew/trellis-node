#!/usr/bin/env node
/**
 * Pack realtime-app source files for WebContainer bootstrap (excludes heavy dirs).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const appRoot = join(__dirname, '..');

const SKIP_DIRS = new Set([
	'node_modules',
	'.svelte-kit',
	'.vercel',
	'build',
	'.git',
	'test-results',
	'wc'
]);

const SKIP_FILES = new Set(['.env']);

function packDir(dir, base = appRoot) {
	const out = {};
	for (const name of readdirSync(dir)) {
		if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
		const full = join(dir, name);
		const rel = relative(base, full).replace(/\\/g, '/');
		const stat = statSync(full);
		if (stat.isDirectory()) {
			Object.assign(out, packDir(full, base));
		} else if (stat.isFile() && stat.size < 512_000) {
			out[rel] = readFileSync(full, 'utf8');
		}
	}
	return out;
}

/** @param {import('node:http').ServerResponse} res */
export function sendAppPack(res) {
	const vendorPkg = resolve(appRoot, '../../package.json');
	const trellisVersion = existsSync(vendorPkg)
		? JSON.parse(readFileSync(vendorPkg, 'utf8')).version
		: '0.0.0';

	const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
	// Inside WC, trellis is vendored under vendor/trellis — not a file: link.
	pkg.dependencies = {
		...pkg.dependencies,
		trellis: 'file:./vendor/trellis',
		ws: '^8.20.1'
	};
	delete pkg.dependencies.valibot;
	pkg.scripts = {
		...pkg.scripts,
		'wc:start': 'node scripts/wc-start.mjs'
	};

	res.setHeader('Content-Type', 'application/json');
	res.end(
		JSON.stringify({
			files: {
				...packDir(appRoot),
				'package.json': JSON.stringify(pkg, null, 2) + '\n'
			},
			trellisVersion
		})
	);
}
