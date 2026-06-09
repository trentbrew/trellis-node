#!/usr/bin/env node
/**
 * Ensure trellis-node is built and linked demo copies match (dist + package.json).
 *
 * Usage (from any linked demo):
 *   node ../../scripts/ensure-linked-trellis.mjs
 *   node scripts/ensure-linked-trellis.mjs /path/to/demo-app
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(process.argv[2] ?? process.cwd());
const trellisRoot = join(__dirname, '..');
const sourceDist = join(trellisRoot, 'dist');
const distEntry = join(sourceDist, 'client/index.js');

/** @param {string} distDir */
function distMatchesSource(distDir) {
	const indexPath = join(distDir, 'client/index.js');
	if (!existsSync(indexPath) || !existsSync(distEntry)) {
		return false;
	}
	return readFileSync(indexPath).equals(readFileSync(distEntry));
}

function buildTrellis() {
	console.log('Building trellis-node…');
	const result = spawnSync('npm', ['run', 'build'], {
		cwd: trellisRoot,
		stdio: 'inherit'
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

/** @returns {string[]} */
function linkedTrellisPackageDirs() {
	const dirs = [];
	const direct = join(appRoot, 'node_modules/trellis');
	if (existsSync(join(direct, 'package.json'))) dirs.push(direct);

	const pnpmRoot = join(appRoot, 'node_modules/.pnpm');
	if (!existsSync(pnpmRoot)) return dirs;

	for (const entry of readdirSync(pnpmRoot)) {
		if (!entry.startsWith('trellis@')) continue;
		const pkg = join(pnpmRoot, entry, 'node_modules/trellis');
		if (existsSync(join(pkg, 'package.json')) && !dirs.includes(pkg)) dirs.push(pkg);
	}
	return dirs;
}

function syncLinkedPackageJson() {
	const sourcePkg = join(trellisRoot, 'package.json');
	if (!existsSync(sourcePkg)) return;
	const source = readFileSync(sourcePkg);

	for (const pkgDir of linkedTrellisPackageDirs()) {
		const target = join(pkgDir, 'package.json');
		if (!existsSync(target)) continue;
		if (readFileSync(target).equals(source)) continue;
		console.log(`Syncing trellis package.json → ${target}`);
		cpSync(sourcePkg, target);
	}
}

function syncLinkedDist() {
	for (const pkgDir of linkedTrellisPackageDirs()) {
		const target = join(pkgDir, 'dist');
		if (target === sourceDist || distMatchesSource(target)) continue;
		console.log(`Syncing trellis dist → ${target}`);
		rmSync(target, { recursive: true, force: true });
		cpSync(sourceDist, target, { recursive: true });
	}
}

if (!existsSync(distEntry)) {
	buildTrellis();
}

syncLinkedPackageJson();
syncLinkedDist();

if (!existsSync(distEntry)) {
	console.error('trellis-node dist is still incomplete after build');
	process.exit(1);
}
