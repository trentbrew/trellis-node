import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { QueryEngine, parseSimple } from 'trellis/core';
import { TrellisVcsEngine } from 'trellis';
import {
	createVcsOp,
	LaneOpLog,
	laneDir,
	loadLaneMeta,
	updateLaneHead,
	type LaneMeta,
	type VcsOp,
	type VcsOpKind
} from 'trellis/vcs';
import {
	FRAMEWORKS_QUERY,
	fromGraphRow,
	slugify,
	sortFrameworks,
	type Framework
} from '$lib/schemas/framework';
import {
	groupTagsByFramework,
	TAG_ASSIGNMENTS_QUERY,
	TAG_ASSIGNMENT_TYPE,
	type FrameworkTag
} from '$lib/schemas/tagged';
import { entityLaneId, filterByLane, isAgentLane, MAIN_LANE, type LaneId } from '$lib/trellis/lane';

export type MaterializedFramework = Framework & {
	tags: FrameworkTag[];
	tagCount: number;
};

const PROJECT_ROOT = resolve('.');
const TRELLIS_DIR = resolve(PROJECT_ROOT, '.trellis');
const INTEGRATION_OPS_PATH = resolve(TRELLIS_DIR, 'ops.json');
const LANE_MAP_PATH = resolve(TRELLIS_DIR, 'app-lane-map.json');

type LaneMap = Record<string, string>;

let engine: TrellisVcsEngine | null = null;
let engineReady: Promise<TrellisVcsEngine> | null = null;

function readLaneMap(): LaneMap {
	if (!existsSync(LANE_MAP_PATH)) return {};
	return JSON.parse(readFileSync(LANE_MAP_PATH, 'utf8')) as LaneMap;
}

function writeLaneMap(map: LaneMap): void {
	if (!existsSync(TRELLIS_DIR)) mkdirSync(TRELLIS_DIR, { recursive: true });
	writeFileSync(LANE_MAP_PATH, `${JSON.stringify(map, null, 2)}\n`);
}

export function vcsConfigured(): boolean {
	return existsSync(INTEGRATION_OPS_PATH);
}

/** Agent lanes write only to VCS journals when `.trellis/` exists. */
export function usesJournalLane(lane: LaneId): boolean {
	return isAgentLane(lane) && vcsConfigured();
}

export function listMappedAppLanes(): LaneId[] {
	return Object.keys(readLaneMap()) as LaneId[];
}

export function createDraftFrameworkId(): string {
	return `framework:${randomUUID()}`;
}

export function laneJournalOpsPath(vcsLaneId: string): string {
	return `${laneDir(TRELLIS_DIR, vcsLaneId)}/ops.json`;
}

async function getEngine(): Promise<TrellisVcsEngine> {
	if (engine) return engine;
	if (!engineReady) {
		engineReady = (async () => {
			const instance = new TrellisVcsEngine({
				rootPath: PROJECT_ROOT,
				agentId: 'realtime-app'
			});

			if (!existsSync(TRELLIS_DIR)) {
				await instance.initRepo();
			} else {
				instance.open();
			}

			engine = instance;
			return instance;
		})().catch((error) => {
			engineReady = null;
			throw error;
		});
	}
	return engineReady;
}

export function resolveVcsLaneId(appLaneId: LaneId): string | null {
	if (appLaneId === MAIN_LANE) return null;
	return readLaneMap()[appLaneId] ?? null;
}

export async function ensureVcsLane(appLaneId: LaneId): Promise<string | null> {
	if (appLaneId === MAIN_LANE) return null;

	const existing = resolveVcsLaneId(appLaneId);
	if (existing) return existing;

	const vcs = await getEngine();
	const meta = await vcs.createLane({ targetBranch: vcs.getCurrentBranch() });
	const map = readLaneMap();
	map[appLaneId] = meta.id;
	writeLaneMap(map);
	return meta.id;
}

async function appendLaneOp(
	vcsLaneId: string,
	kind: VcsOpKind,
	payload: VcsOp['vcs']
): Promise<void> {
	const log = new LaneOpLog(laneDir(TRELLIS_DIR, vcsLaneId));
	log.load();
	const op = await createVcsOp(kind, {
		agentId: 'realtime-app',
		previousHash: log.getLastOp()?.hash,
		vcs: payload ?? {}
	});
	log.append(op);
	updateLaneHead(TRELLIS_DIR, vcsLaneId, op.hash);
}

export async function journalFrameworkCreate(
	appLaneId: LaneId,
	entityId: string,
	attributes: Record<string, unknown>
): Promise<void> {
	const vcsLaneId = await ensureVcsLane(appLaneId);
	if (!vcsLaneId) return;

	const facts = [
		{ e: entityId, a: 'type', v: 'framework' },
		...Object.entries(attributes).map(([a, v]) => ({ e: entityId, a, v }))
	];

	await appendLaneOp(vcsLaneId, 'vcs:storeAssert', { facts, laneId: vcsLaneId } as VcsOp['vcs']);
}

export async function journalFrameworkUpdate(
	appLaneId: LaneId,
	entityId: string,
	attributes: Record<string, unknown>
): Promise<void> {
	const vcsLaneId = resolveVcsLaneId(appLaneId);
	if (!vcsLaneId) return;

	const facts = Object.entries(attributes).map(([a, v]) => ({ e: entityId, a, v }));
	await appendLaneOp(vcsLaneId, 'vcs:storeAssert', { facts, laneId: vcsLaneId } as VcsOp['vcs']);
}

export async function journalTagLink(
	appLaneId: LaneId,
	frameworkId: string,
	tagId: string,
	op: 'add' | 'remove'
): Promise<void> {
	const vcsLaneId = resolveVcsLaneId(appLaneId) ?? (await ensureVcsLane(appLaneId));
	if (!vcsLaneId) return;

	const assignmentId = tagAssignmentJournalId(frameworkId, tagId);
	const facts = [
		{ e: assignmentId, a: 'type', v: TAG_ASSIGNMENT_TYPE },
		{ e: assignmentId, a: 'frameworkId', v: frameworkId },
		{ e: assignmentId, a: 'tagId', v: tagId }
	];

	await appendLaneOp(vcsLaneId, op === 'add' ? 'vcs:storeAssert' : 'vcs:storeRetract', {
		facts,
		laneId: vcsLaneId
	});
}

function tagAssignmentJournalId(frameworkId: string, tagId: string): string {
	const hash = createHash('sha256').update(`${frameworkId}\0${tagId}`).digest('hex').slice(0, 32);
	return `framework-tag:${hash}`;
}

export async function journalFrameworkDelete(appLaneId: LaneId, entityId: string): Promise<void> {
	const vcsLaneId = resolveVcsLaneId(appLaneId);
	if (!vcsLaneId) return;

	await appendLaneOp(vcsLaneId, 'vcs:storeRetract', {
		facts: [{ e: entityId, a: 'type', v: 'framework' }],
		laneId: vcsLaneId
	});
}

export async function promoteVcsLane(appLaneId: LaneId): Promise<void> {
	const vcsLaneId = resolveVcsLaneId(appLaneId);
	if (!vcsLaneId) return;

	const vcs = await getEngine();
	await vcs.promoteLane(vcsLaneId);

	const map = readLaneMap();
	delete map[appLaneId];
	writeLaneMap(map);
}

export async function dropVcsLane(appLaneId: LaneId): Promise<void> {
	const vcsLaneId = resolveVcsLaneId(appLaneId);
	if (!vcsLaneId) return;

	const vcs = await getEngine();
	await vcs.dropLane(vcsLaneId);

	const map = readLaneMap();
	delete map[appLaneId];
	writeLaneMap(map);
}

export type VcsLaneStatus = {
	appLane: LaneId;
	vcsLaneId: string;
	status: LaneMeta['status'];
	headOpHash?: string;
	laneOpCount: number;
};

export async function getVcsLaneStatus(appLaneId: LaneId): Promise<VcsLaneStatus | null> {
	const vcsLaneId = resolveVcsLaneId(appLaneId);
	if (!vcsLaneId) return null;

	const meta = loadLaneMeta(TRELLIS_DIR, vcsLaneId);
	if (!meta) return null;

	const vcs = await getEngine();
	return {
		appLane: appLaneId,
		vcsLaneId,
		status: meta.status,
		headOpHash: meta.headOpHash,
		laneOpCount: vcs.getLaneOpCount(vcsLaneId)
	};
}

/** Materialized lane overlay — integration replay + lane journal via TrellisVcsEngine. */
export async function materializeLaneFrameworks(appLaneId: LaneId): Promise<Framework[]> {
	const view = await materializeLaneView(appLaneId);
	return view.map(({ tags: _tags, ...framework }) => framework);
}

/** Frameworks + tag assignment entities from the materialized lane store. */
export async function materializeLaneView(appLaneId: LaneId): Promise<MaterializedFramework[]> {
	const vcsLaneId = resolveVcsLaneId(appLaneId);
	if (!vcsLaneId) return [];

	const vcs = await getEngine();
	await vcs.enterLane(vcsLaneId);

	try {
		const store = vcs.getStore();
		const queryEngine = new QueryEngine(store);

		const frameworkResult = queryEngine.execute(parseSimple(FRAMEWORKS_QUERY));
		const items = sortFrameworks(
			frameworkResult.bindings.map((row) => fromGraphRow(row)).filter((item) => item.id)
		);
		const filtered = filterByLane(items, appLaneId);

		const tagResult = queryEngine.execute(parseSimple(TAG_ASSIGNMENTS_QUERY));
		const tagMap = groupTagsByFramework(tagResult.bindings);

		return filtered.map((item) => {
			const tags = tagMap.get(item.id) ?? [];
			return { ...item, tags, tagCount: tags.length };
		});
	} finally {
		await vcs.leaveLane();
	}
}

export type LaneJournalSubscription = { unsubscribe(): void };

/** Watch lane journal file + poll head hash for `query.live` on agent lanes. */
export function subscribeLaneJournal(
	appLaneId: LaneId,
	onUpdate: (frameworks: MaterializedFramework[]) => void
): LaneJournalSubscription {
	let watcher: FSWatcher | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let lastHead = '';
	let closed = false;

	const emit = async () => {
		if (closed) return;
		const items = await materializeLaneView(appLaneId);
		onUpdate(items);
	};

	const attach = () => {
		const vcsLaneId = resolveVcsLaneId(appLaneId);
		if (!vcsLaneId) return;

		const opsPath = laneJournalOpsPath(vcsLaneId);
		if (existsSync(opsPath)) {
			watcher?.close();
			watcher = watch(opsPath, () => {
				void emit();
			});
		}

		const meta = loadLaneMeta(TRELLIS_DIR, vcsLaneId);
		lastHead = meta?.headOpHash ?? lastHead;
	};

	void emit();
	attach();

	pollTimer = setInterval(() => {
		const vcsLaneId = resolveVcsLaneId(appLaneId);
		if (!vcsLaneId) {
			attach();
			return;
		}
		const meta = loadLaneMeta(TRELLIS_DIR, vcsLaneId);
		const head = meta?.headOpHash ?? '';
		if (head !== lastHead) {
			lastHead = head;
			void emit();
		}
	}, 1500);

	return {
		unsubscribe() {
			closed = true;
			watcher?.close();
			if (pollTimer) clearInterval(pollTimer);
		}
	};
}

export function frameworkJournalAttributes(framework: Framework): Record<string, unknown> {
	return {
		title: framework.title,
		slug: framework.slug ?? slugify(framework.title),
		sortOrder: framework.sortOrder,
		laneId: entityLaneId(framework)
	};
}

export async function ensureVcsRepo(): Promise<void> {
	await getEngine();
}
