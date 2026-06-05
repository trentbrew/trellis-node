#!/usr/bin/env node
/**
 * Ensure trellis-node is built before linking from source, and that linked
 * `node_modules/trellis/dist` matches (pnpm copies file: deps; a partial rebuild
 * can leave index.js pointing at chunks that were deleted).
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '..');
const trellisRoot = join(appRoot, '../..');
const sourceDist = join(trellisRoot, 'dist');
const distEntry = join(sourceDist, 'client/index.js');

/** @param {string} distDir */
function distMatchesSource(distDir) {
	const indexPath = join(distDir, 'client/index.js');
	if (!existsSync(indexPath) || !existsSync(distEntry)) {
		return false;
	}
	return readFileSync(indexPath) === readFileSync(distEntry);
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
function linkedTrellisDistDirs() {
	const dirs = [];
	const direct = join(appRoot, 'node_modules/trellis/dist');
	if (existsSync(direct)) dirs.push(direct);

	const pnpmRoot = join(appRoot, 'node_modules/.pnpm');
	if (!existsSync(pnpmRoot)) return dirs;

	for (const entry of readdirSync(pnpmRoot)) {
		if (!entry.startsWith('trellis@file')) continue;
		const dist = join(pnpmRoot, entry, 'node_modules/trellis/dist');
		if (existsSync(dist) && !dirs.includes(dist)) dirs.push(dist);
	}
	return dirs;
}

function syncLinkedDist() {
	for (const target of linkedTrellisDistDirs()) {
		if (target === sourceDist || distMatchesSource(target)) continue;
		console.log(`Syncing trellis dist → ${target}`);
		rmSync(target, { recursive: true, force: true });
		cpSync(sourceDist, target, { recursive: true });
	}
}

if (!existsSync(distEntry)) {
	buildTrellis();
}

syncLinkedDist();

if (!existsSync(distEntry)) {
	console.error('trellis-node dist is still incomplete after build');
	process.exit(1);
}
