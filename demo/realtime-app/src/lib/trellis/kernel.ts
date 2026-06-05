import { TenantPool } from 'trellis/server';
import { readTrellisConfig } from './config';

let pool: TenantPool | null = null;
let preload: Promise<void> | null = null;

async function getPool(): Promise<TenantPool> {
	const config = readTrellisConfig();
	if (!config?.dbPath) {
		throw new Error('Trellis not configured — run `pnpm trellis:init`');
	}

	if (!pool) {
		pool = new TenantPool(config.dbPath);
		preload = pool.preload().then(() => undefined);
	}

	await preload;
	return pool;
}

/** Direct kernel access for graph link mutations (same SQLite as sidecar, WAL mode). */
export async function mutateLink(
	op: 'add' | 'remove',
	sourceId: string,
	attribute: string,
	targetId: string
): Promise<void> {
	const kernel = (await getPool()).get(null);
	if (op === 'add') {
		await kernel.addLink(sourceId, attribute, targetId);
		return;
	}
	await kernel.removeLink(sourceId, attribute, targetId);
}
