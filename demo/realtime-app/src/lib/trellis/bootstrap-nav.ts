import { env } from '$env/dynamic/public';
import type { TrellisDb } from 'trellis/client/sdk';
import { NavItem, NavSection } from '$lib/schemas/nav';

/** Browser → sidecar (:3920). Override with PUBLIC_TRELLIS_URL when deployed. */
export function trellisClientUrl(): string {
	return env.PUBLIC_TRELLIS_URL ?? 'http://localhost:3920';
}

export function byOrder<T extends { order: number }>(a: T, b: T) {
	return a.order - b.order;
}

const DEMO_ROUTES: Array<{ label: string; href: string; order: number }> = [
	{ label: 'Frameworks', href: '/', order: 0 },
	{ label: 'Fractal', href: '/fractal', order: 1 },
	{ label: 'Cursors', href: '/presence', order: 2 },
	{ label: 'Chat', href: '/chat', order: 3 },
	{ label: 'Editor', href: '/editor', order: 4 }
];

/** Register nav types and seed demo links. Idempotent. */
export async function bootstrapGraphNav(client: TrellisDb): Promise<void> {
	for (const type of [NavSection, NavItem]) {
		await client.registerType(type);
	}

	const items = await client.query('find ?e where type = "NavItem"');
	if (items.bindings.length > 0) return;

	const sections = await client.query('find ?e where type = "NavSection"');
	let sectionId: string;

	if (sections.bindings.length === 0) {
		sectionId = await client.create('NavSection', {
			label: 'Explore',
			order: 0,
			collapsed: false
		});
	} else {
		sectionId = sections.bindings[0]!.e;
	}

	for (const route of DEMO_ROUTES) {
		await client.create('NavItem', {
			label: route.label,
			order: route.order,
			section: sectionId,
			href: route.href
		});
	}
}
