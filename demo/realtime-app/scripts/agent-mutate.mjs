#!/usr/bin/env node
/**
 * Simulate an agent (or MCP tool) mutating frameworks while the UI is open.
 *
 *   pnpm agent:add "astro"
 *   pnpm agent:add "qwik" --lane demo
 *   pnpm agent:add "renamed" --update --lane demo
 *
 * Main lane → Trellis graph HTTP (:3920).
 * Agent lanes → VCS lane journal only (requires .trellis/).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrellisVcsEngine } from 'trellis';
import { createVcsOp, LaneOpLog, laneDir, loadLaneMeta, updateLaneHead } from 'trellis/vcs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
const TRELLIS_DIR = resolve(appRoot, '.trellis');
const LANE_MAP_PATH = resolve(TRELLIS_DIR, 'app-lane-map.json');

function readConfig() {
	const path = resolve(appRoot, '.trellis-db.json');
	if (!existsSync(path)) {
		console.error('Missing .trellis-db.json — run `pnpm trellis:init` first.');
		process.exit(1);
	}
	return JSON.parse(readFileSync(path, 'utf8'));
}

function slugify(title) {
	return title
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function parseLane(argv) {
	const index = argv.indexOf('--lane');
	if (index === -1) return 'main';
	const value = argv[index + 1];
	if (!value || value.startsWith('--')) {
		console.error('Usage: --lane <name> (becomes agent:<name> unless already prefixed)');
		process.exit(1);
	}
	return value.startsWith('agent:') ? value : `agent:${value}`;
}

function readLaneMap() {
	if (!existsSync(LANE_MAP_PATH)) return {};
	return JSON.parse(readFileSync(LANE_MAP_PATH, 'utf8'));
}

function writeLaneMap(map) {
	writeFileSync(LANE_MAP_PATH, `${JSON.stringify(map, null, 2)}\n`);
}

async function api(config, method, path, body) {
	const url = `${config.url ?? `http://localhost:${config.port ?? 3920}`}${path}`;
	const res = await fetch(url, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
		},
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${data.message ?? res.statusText}`);
	}
	return data;
}

async function ensureVcsLane(appLane) {
	const map = readLaneMap();
	if (map[appLane]) return map[appLane];

	const engine = new TrellisVcsEngine({ rootPath: appRoot, agentId: 'agent-mutate' });
	if (!existsSync(TRELLIS_DIR)) {
		await engine.initRepo();
	} else {
		engine.open();
	}

	const meta = await engine.createLane({ targetBranch: engine.getCurrentBranch() });
	map[appLane] = meta.id;
	writeLaneMap(map);
	return meta.id;
}

async function appendLaneOp(vcsLaneId, kind, payload) {
	const log = new LaneOpLog(laneDir(TRELLIS_DIR, vcsLaneId));
	log.load();
	const op = await createVcsOp(kind, {
		agentId: 'agent-mutate',
		previousHash: log.getLastOp()?.hash,
		vcs: payload
	});
	log.append(op);
	updateLaneHead(TRELLIS_DIR, vcsLaneId, op.hash);
	return op.hash;
}

async function journalCreate(appLane, title) {
	const vcsLaneId = await ensureVcsLane(appLane);
	const slug = slugify(title);
	const id = `framework:${randomUUID()}`;
	await appendLaneOp(vcsLaneId, 'vcs:storeAssert', {
		facts: [
			{ e: id, a: 'type', v: 'framework' },
			{ e: id, a: 'title', v: title },
			{ e: id, a: 'slug', v: slug },
			{ e: id, a: 'laneId', v: appLane }
		],
		laneId: vcsLaneId
	});
	return id;
}

async function journalUpdate(appLane, entityId, title) {
	const vcsLaneId = readLaneMap()[appLane];
	if (!vcsLaneId) throw new Error(`No VCS lane for ${appLane}`);
	const slug = slugify(title);
	await appendLaneOp(vcsLaneId, 'vcs:storeAssert', {
		facts: [
			{ e: entityId, a: 'title', v: title },
			{ e: entityId, a: 'slug', v: slug }
		],
		laneId: vcsLaneId
	});
}

async function listMaterializedFrameworks(appLane) {
	const { QueryEngine, parseSimple } = await import('trellis/core');
	const vcsLaneId = readLaneMap()[appLane];
	if (!vcsLaneId) return [];

	const engine = new TrellisVcsEngine({ rootPath: appRoot, agentId: 'agent-mutate' });
	engine.open();
	await engine.enterLane(vcsLaneId);
	try {
		const query = `SELECT ?e ?title ?laneId WHERE { [?e "type" "framework"] [?e "title" ?title] }`;
		const result = new QueryEngine(engine.getStore()).execute(parseSimple(query));
		return result.bindings.map((row) => ({
			id: String(row['?e'] ?? ''),
			title: String(row['?title'] ?? ''),
			laneId: String(row['?laneId'] ?? appLane)
		}));
	} finally {
		await engine.leaveLane();
	}
}

const args = process.argv.slice(2);
const title = args.find((arg) => !arg.startsWith('--') && arg !== args[args.indexOf('--lane') + 1]);
const mode = args.includes('--update') ? 'update' : 'create';
const laneId = parseLane(args);

if (!title) {
	console.error('Usage: pnpm agent:add "<title>" [--lane demo] [--update]');
	process.exit(1);
}

const config = readConfig();

try {
	if (laneId !== 'main') {
		if (!existsSync(TRELLIS_DIR)) {
			console.error('Agent lanes require VCS — run `pnpm trellis:vcs-init` first.');
			process.exit(1);
		}

		if (mode === 'update') {
			const items = await listMaterializedFrameworks(laneId);
			const last = items.at(-1);
			if (!last) {
				console.error('No draft frameworks in lane journal.');
				process.exit(1);
			}
			await journalUpdate(laneId, last.id, title);
			console.log(`✓ Agent updated ${last.id} → "${title}" (journal ${laneId})`);
		} else {
			const id = await journalCreate(laneId, title);
			console.log(`✓ Agent journaled ${id} "${title}" on lane ${laneId}`);
		}
	} else if (mode === 'update') {
		const list = await api(config, 'GET', '/entities?type=framework&limit=500');
		const last = (list.data ?? [])
			.filter((item) => String(item.laneId ?? 'main') === 'main')
			.at(-1);
		if (!last) {
			console.error('No frameworks to update.');
			process.exit(1);
		}
		await api(config, 'PUT', `/entities/${encodeURIComponent(last.id)}`, {
			title,
			slug: slugify(title)
		});
		console.log(`✓ Agent updated ${last.id} → "${title}"`);
	} else {
		const { id } = await api(config, 'POST', '/entities', {
			type: 'framework',
			attributes: { title, slug: slugify(title), laneId: 'main' }
		});
		console.log(`✓ Agent created ${id} "${title}" on lane main`);
	}

	const preview =
		laneId === 'main'
			? 'http://localhost:4000'
			: `http://localhost:4000/?lane=${encodeURIComponent(laneId)}`;
	console.log(`  Preview: ${preview}`);
} catch (e) {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
}
