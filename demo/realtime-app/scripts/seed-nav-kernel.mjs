#!/usr/bin/env node
/**
 * Idempotent graph-nav seed via kernel (runs once in trellis-serve).
 * Matches demo/realtime-app/src/lib/schemas/nav.ts.
 */
import { randomUUID } from 'node:crypto';

const DEMO_ROUTES = [
	{ label: 'Collections', href: '/', order: 0 },
	{ label: 'Fractal', href: '/fractal', order: 1 },
	{ label: 'Cursors', href: '/presence', order: 2 },
	{ label: 'Chat', href: '/chat', order: 3 },
	{ label: 'Editor', href: '/editor', order: 4 }
];

const NAV_ITEM_ONTOLOGY = {
	'@id': 'trellis:NavItem',
	'@type': 'trellis:Schema',
	version: '1.0.0',
	tier: 'user',
	label: 'NavItem',
	fields: [
		{ name: 'label', valueType: 'title', required: true },
		{ name: 'href', valueType: 'rich_text', required: false },
		{ name: 'order', valueType: 'number', required: true },
		{
			name: 'section',
			valueType: 'relation',
			required: false,
			relation: { targetSchema: 'NavSection', cardinality: 'one' }
		}
	]
};

const NAV_SECTION_ONTOLOGY = {
	'@id': 'trellis:NavSection',
	'@type': 'trellis:Schema',
	version: '1.0.0',
	tier: 'user',
	label: 'NavSection',
	fields: [
		{ name: 'label', valueType: 'title', required: true },
		{ name: 'order', valueType: 'number', required: true },
		{ name: 'collapsed', valueType: 'checkbox', required: true },
		{
			name: 'items',
			valueType: 'relation',
			required: false,
			relation: { targetSchema: 'NavItem', cardinality: 'many' }
		}
	]
};

function factValue(entity, attribute) {
	return entity.facts.find((fact) => fact.a === attribute)?.v;
}

function registerNavOntologies(kernel) {
	for (const schema of [NAV_SECTION_ONTOLOGY, NAV_ITEM_ONTOLOGY]) {
		const exists = kernel
			.listOntologies()
			.some((ont) => ont['@id'] === schema['@id']);
		if (exists) continue;
		try {
			kernel.createOntology(schema);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!message.includes('already exists')) throw error;
		}
	}
}

/** Keep the oldest NavItem per href — repairs multi-tab bootstrap races. */
export async function dedupeNavItemsKernel(kernel) {
	const items = kernel.listEntities('NavItem');
	const byHref = new Map();

	for (const entity of items) {
		const href = String(factValue(entity, 'href') ?? '');
		const bucket = byHref.get(href) ?? [];
		bucket.push(entity);
		byHref.set(href, bucket);
	}

	let removed = 0;
	for (const entities of byHref.values()) {
		if (entities.length <= 1) continue;
		const [, ...dupes] = entities;
		for (const entity of dupes) {
			await kernel.deleteEntity(entity.id);
			removed++;
		}
	}
	return removed;
}

export async function seedNavKernel(kernel) {
	registerNavOntologies(kernel);
	const deduped = await dedupeNavItemsKernel(kernel);

	const items = kernel.listEntities('NavItem');
	const hrefs = new Set(
		items
			.map((entity) => String(factValue(entity, 'href') ?? ''))
			.filter((href) => href.length > 0)
	);

	if (DEMO_ROUTES.every((route) => hrefs.has(route.href))) {
		return { created: 0, deduped };
	}

	const sections = kernel.listEntities('NavSection');
	let sectionId;

	if (sections.length === 0) {
		sectionId = `nav-section:${randomUUID()}`;
		await kernel.createEntity(sectionId, 'NavSection', {
			label: 'Explore',
			order: 0,
			collapsed: false
		});
	} else {
		const explore =
			sections.find((s) => factValue(s, 'label') === 'Explore') ?? sections[0];
		sectionId = explore.id;
	}

	for (const entity of items) {
		const href = String(factValue(entity, 'href') ?? '');
		if (href === '/') {
			const label = String(factValue(entity, 'label') ?? '');
			if (label !== 'Collections') {
				await kernel.updateEntity(entity.id, { label: 'Collections' });
			}
		}
	}

	let created = 0;
	for (const route of DEMO_ROUTES) {
		if (hrefs.has(route.href)) continue;
		await kernel.createEntity(`nav-item:${randomUUID()}`, 'NavItem', {
			label: route.label,
			order: route.order,
			section: sectionId,
			href: route.href
		});
		hrefs.add(route.href);
		created++;
	}

	return { created, deduped };
}
