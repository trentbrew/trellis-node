#!/usr/bin/env node
/**
 * Verify VCS materialized overlay for an agent lane (journal-only drafts).
 *
 *   pnpm lane:check -- agent:demo
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueryEngine, parseSimple } from 'trellis/core';
import { TrellisVcsEngine } from 'trellis';
import { loadLaneMeta, laneDir, LaneOpLog } from 'trellis/vcs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
process.chdir(appRoot);

const laneArg = process.argv[2] ?? 'agent:demo';
const appLane = laneArg.startsWith('agent:') ? laneArg : `agent:${laneArg}`;

const mapPath = resolve(appRoot, '.trellis/app-lane-map.json');
if (!existsSync(mapPath)) {
	console.error(`No VCS lane mapped for ${appLane}. Mutate on that lane first.`);
	process.exit(1);
}

const vcsLaneId = JSON.parse(readFileSync(mapPath, 'utf8'))[appLane];
if (!vcsLaneId) {
	console.error(`No VCS lane mapped for ${appLane}. Mutate on that lane first.`);
	process.exit(1);
}

const RECORDS_QUERY = `SELECT ?e ?title ?laneId
WHERE {
  [?e "type" "CollectionRecord"]
  [?e "title" ?title]
}`;

function listMaterializedRecords(vcs, lane) {
	return vcs.enterLane(vcsLaneId).then(() => {
		const engine = new QueryEngine(vcs.getStore());
		const parsed = parseSimple(RECORDS_QUERY);
		const result = engine.execute(parsed);
		const items = result.bindings.map((row) => ({
			title: String(row['?title'] ?? row.title ?? ''),
			laneId: String(row['?laneId'] ?? row.laneId ?? 'main')
		}));
		return vcs.leaveLane().then(() => items.filter((item) => item.laneId === lane));
	});
}

const vcs = new TrellisVcsEngine({ rootPath: appRoot, agentId: 'lane-check' });
if (!existsSync(resolve(appRoot, '.trellis'))) {
	console.error('Missing .trellis/ — run pnpm trellis:vcs-init');
	process.exit(1);
}
vcs.open();

const meta = loadLaneMeta(resolve(appRoot, '.trellis'), vcsLaneId);
const laneLog = new LaneOpLog(laneDir(resolve(appRoot, '.trellis'), vcsLaneId));
laneLog.load();

const [materialized] = await Promise.all([listMaterializedRecords(vcs, appLane)]);

console.log(
	`Lane ${appLane} → VCS ${vcsLaneId} (${meta?.status ?? 'unknown'}, ${laneLog.count()} journal op(s))`
);
console.log(`Materialized:  ${materialized.length} collection record(s)`);

if (materialized.length === 0 && laneLog.count() === 0) {
	console.log('✓ Empty lane journal');
	process.exit(0);
}

if (materialized.length > 0) {
	console.log('✓ Materialized overlay has draft collection record(s)');
	console.log('  Titles:', materialized.map((item) => item.title).join(', '));
	process.exit(0);
}

console.error('Journal has ops but materialization returned no collection records');
process.exit(1);
