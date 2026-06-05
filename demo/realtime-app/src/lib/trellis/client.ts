import { TrellisDb } from 'trellis/client';
import { getTrellisApiKey, getTrellisUrl } from './config';

let db: TrellisDb | null = null;

export function getTrellis(): TrellisDb {
	if (!db) {
		db = new TrellisDb({
			url: getTrellisUrl(),
			apiKey: getTrellisApiKey()
		});
	}
	return db;
}

export async function pingTrellis(): Promise<boolean> {
	try {
		const res = await fetch(`${getTrellisUrl()}/health`);
		return res.ok;
	} catch {
		return false;
	}
}
