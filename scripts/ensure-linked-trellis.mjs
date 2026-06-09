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

/** @param {string} dir */
function listDistFiles(dir) {
	if (!existsSync(dir)) return '';
	const out = [];
	/** @param {string} base @param {string} rel */
	function walk(base, rel) {
		for (const ent of readdirSync(join(base, rel), { withFileTypes: true })) {
			const path = rel ? `${rel}/${ent.name}` : ent.name;
			if (ent.isDirectory()) walk(base, path);
			else out.push(path);
		}
	}
	walk(dir, '');
	return out.sort().join('\n');
}

/** Entry index alone is not enough — esbuild chunk hashes drift while index stays copied. */
function distMatchesSource(distDir) {
	if (distDir === sourceDist) return true;
	if (!existsSync(distEntry)) return false;
	const indexPath = join(distDir, 'client/index.js');
	if (!existsSync(indexPath)) return false;
	if (!readFileSync(indexPath).equals(readFileSync(distEntry))) return false;
	return listDistFiles(distDir) === listDistFiles(sourceDist);
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

/** @param {string} root @returns {string[]} */
function linkedTrellisPackageDirs(root) {
	const dirs = [];
	const direct = join(root, 'node_modules/trellis');
	if (existsSync(join(direct, 'package.json'))) dirs.push(direct);

	const pnpmRoot = join(root, 'node_modules/.pnpm');
	if (!existsSync(pnpmRoot)) return dirs;

	for (const entry of readdirSync(pnpmRoot)) {
		if (!entry.startsWith('trellis@')) continue;
		const pkg = join(pnpmRoot, entry, 'node_modules/trellis');
		if (existsSync(join(pkg, 'package.json')) && !dirs.includes(pkg)) dirs.push(pkg);
	}
	return dirs;
}

function syncLinkedPackageJsonFor(appDir) {
	const sourcePkg = join(trellisRoot, 'package.json');
	if (!existsSync(sourcePkg)) return;
	const source = readFileSync(sourcePkg);

	for (const pkgDir of linkedTrellisPackageDirs(appDir)) {
		const target = join(pkgDir, 'package.json');
		if (!existsSync(target)) continue;
		if (readFileSync(target).equals(source)) continue;
		console.log(`Syncing trellis package.json → ${target}`);
		cpSync(sourcePkg, target);
	}
}

function syncLinkedPackageJson() {
	syncLinkedPackageJsonFor(appRoot);
	if (appRoot !== trellisRoot) syncLinkedPackageJsonFor(trellisRoot);
}

function syncLinkedDistFor(appDir) {
	for (const pkgDir of linkedTrellisPackageDirs(appDir)) {
		const target = join(pkgDir, 'dist');
		if (distMatchesSource(target)) continue;
		console.log(`Syncing trellis dist → ${target}`);
		rmSync(target, { recursive: true, force: true });
		cpSync(sourceDist, target, { recursive: true });
	}
}

function syncLinkedDist() {
	syncLinkedDistFor(appRoot);
	// Monorepo demos may resolve trellis via the repo-root pnpm store.
	if (appRoot !== trellisRoot) syncLinkedDistFor(trellisRoot);
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
