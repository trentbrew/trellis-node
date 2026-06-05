#!/usr/bin/env node
/**
 * Ensure Trellis VCS repo (.trellis/) exists for lane journals.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrellisVcsEngine } from 'trellis';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
const trellisDir = resolve(appRoot, '.trellis');
const opsPath = resolve(trellisDir, 'ops.json');

if (existsSync(opsPath)) {
	console.log('✓ Trellis VCS already initialized (.trellis/ops.json)');
	process.exit(0);
}

const engine = new TrellisVcsEngine({ rootPath: appRoot, agentId: 'realtime-app' });
const { opsCreated } = await engine.initRepo();
console.log(`✓ Trellis VCS initialized (${opsCreated} bootstrap op(s))`);
