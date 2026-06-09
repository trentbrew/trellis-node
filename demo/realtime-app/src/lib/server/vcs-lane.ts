import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { randomUUID } from 'node:crypto';
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
	COLLECTION_RECORDS_QUERY,
	fromRecordRow,
	recordIdPrefix,
	sortRecords,
	type CollectionRecord
} from '$lib/schemas/collection';
import { entityLaneId, filterByLane, isAgentLane, MAIN_LANE, type LaneId } from '$lib/trellis/lane';

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

export function createDraftRecordId(): string {
	return `${recordIdPrefix()}${randomUUID()}`;
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

export async function journalRecordCreate(
	appLaneId: LaneId,
	recordId: string,
	attributes: Record<string, unknown>
): Promise<void> {
	const vcsLaneId = await ensureVcsLane(appLaneId);
	if (!vcsLaneId) return;

	const facts = [
		{ e: recordId, a: 'type', v: 'CollectionRecord' },
		...Object.entries(attributes).map(([a, v]) => ({ e: recordId, a, v }))
	];

	await appendLaneOp(vcsLaneId, 'vcs:storeAssert', { facts, laneId: vcsLaneId } as VcsOp['vcs']);
}

export async function journalRecordUpdate(
	appLaneId: LaneId,
	recordId: string,
	attributes: Record<string, unknown>
): Promise<void> {
	const vcsLaneId = resolveVcsLaneId(appLaneId);
	if (!vcsLaneId) return;

	const facts = Object.entries(attributes).map(([a, v]) => ({ e: recordId, a, v }));
	await appendLaneOp(vcsLaneId, 'vcs:storeAssert', { facts, laneId: vcsLaneId } as VcsOp['vcs']);
}

export async function journalRecordDelete(appLaneId: LaneId, recordId: string): Promise<void> {
	const vcsLaneId = resolveVcsLaneId(appLaneId);
	if (!vcsLaneId) return;

	await appendLaneOp(vcsLaneId, 'vcs:storeRetract', {
		facts: [{ e: recordId, a: 'type', v: 'CollectionRecord' }],
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

export async function materializeLaneView(appLaneId: LaneId): Promise<CollectionRecord[]> {
	const vcsLaneId = resolveVcsLaneId(appLaneId);
	if (!vcsLaneId) return [];

	const vcs = await getEngine();
	await vcs.enterLane(vcsLaneId);

	try {
		const store = vcs.getStore();
		const queryEngine = new QueryEngine(store);
		const result = queryEngine.execute(parseSimple(COLLECTION_RECORDS_QUERY));
		const items = sortRecords(
			result.bindings.map((row) => fromRecordRow(row)).filter((item) => item.id)
		);
		return filterByLane(items, appLaneId);
	} finally {
		await vcs.leaveLane();
	}
}

export type LaneJournalSubscription = { unsubscribe(): void };

/** Watch lane journal file + poll head hash for `query.live` on agent lanes. */
export function subscribeLaneJournal(
	appLaneId: LaneId,
	onUpdate: (items: CollectionRecord[]) => void
): LaneJournalSubscription {
	let watcher: FSWatcher | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let lastHead = '';
	let closed = false;

	const emit = async () => {
		if (closed) return;
		onUpdate(await materializeLaneView(appLaneId));
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

export function recordJournalAttributes(record: CollectionRecord): Record<string, unknown> {
	return {
		collectionId: record.collectionId,
		title: record.title,
		body: record.body,
		sortOrder: record.sortOrder,
		laneId: entityLaneId(record)
	};
}

export async function ensureVcsRepo(): Promise<void> {
	await getEngine();
}
