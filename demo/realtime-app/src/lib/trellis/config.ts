import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '$env/dynamic/private';

const PROJECT_ROOT = resolve('.');

export type TrellisDbConfig = {
	mode?: string;
	url?: string;
	apiKey?: string;
	port?: number;
	dbPath?: string;
};

export function readTrellisConfig(): TrellisDbConfig | null {
	const path = resolve(PROJECT_ROOT, '.trellis-db.json');
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, 'utf8')) as TrellisDbConfig;
}

export function getTrellisUrl(): string {
	return env.TRELLIS_URL ?? `http://localhost:${readTrellisConfig()?.port ?? 3920}`;
}

export function getTrellisApiKey(): string | undefined {
	return env.TRELLIS_API_KEY || readTrellisConfig()?.apiKey || undefined;
}

export function trellisConfigured(): boolean {
	return Boolean(env.TRELLIS_URL || existsSync(resolve(PROJECT_ROOT, '.trellis-db.json')));
}
