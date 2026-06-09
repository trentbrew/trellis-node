import { env } from '$env/dynamic/public';
import type { TrellisDb } from 'trellis/client/sdk';
import { NavItem, NavSection } from '$lib/schemas/nav';

/**
 * Browser → same-origin (Vite proxies /entities, /query, /ontologies, /realtime
 * to the sidecar). Override with PUBLIC_TRELLIS_URL when deployed.
 */
export function trellisClientUrl(): string {
	if (env.PUBLIC_TRELLIS_URL) return env.PUBLIC_TRELLIS_URL;
	if (typeof window !== 'undefined') return '';
	return 'http://localhost:3920';
}

export function byOrder<T extends { order: number }>(a: T, b: T) {
	return a.order - b.order;
}

/**
 * Ensure nav types are registered (idempotent). Graph data is seeded once on the
 * sidecar in trellis-serve — never seed from the browser (N tabs = N races).
 */
export async function bootstrapGraphNav(client: TrellisDb): Promise<void> {
	for (const type of [NavSection, NavItem]) {
		await client.registerType(type);
	}
}
