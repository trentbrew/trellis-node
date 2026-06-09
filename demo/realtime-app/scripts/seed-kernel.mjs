#!/usr/bin/env node
/**
 * Idempotent Collections seed via kernel (runs inside trellis-serve before HTTP starts).
 */
import { randomUUID } from 'node:crypto';

const META_TYPE = 'CollectionMeta';
const RECORD_TYPE = 'CollectionRecord';
const META_PREFIX = 'collectionMeta:';
const RECORD_PREFIX = 'collectionRecord:';

const SEED_COLLECTIONS = [
	{
		id: `${META_PREFIX}ideas`,
		title: 'Ideas',
		slug: 'ideas',
		icon: '💡',
		color: '#0f62fe',
		description: 'Rough concepts and sparks worth revisiting',
		sortOrder: 0,
		records: [
			{ title: 'Fractal shell contract', body: 'One kernel, many vantages — representation vs version.' },
			{ title: 'Collections before fractals', body: 'Ship the record type users will actually manage.' }
		]
	},
	{
		id: `${META_PREFIX}reading-list`,
		title: 'Reading list',
		slug: 'reading-list',
		icon: '📚',
		color: '#8a3ffc',
		description: 'Articles, papers, and threads to read',
		sortOrder: 1,
		records: [
			{ title: 'Local-first software', body: 'Martin Kleppmann — sync without owning user state.' },
			{ title: 'Semantic web revisited', body: 'What stuck from RDF-era lessons for graph kernels.' }
		]
	},
	{
		id: `${META_PREFIX}ship-log`,
		title: 'Ship log',
		slug: 'ship-log',
		icon: '🚀',
		color: '#198038',
		description: 'Milestones and demo wedges shipped',
		sortOrder: 2,
		records: [{ title: 'Typed SDK explorer', body: 'Graph nav + chat on entitiesStore + mutations.' }]
	}
];

function factValue(entity, attribute) {
	return entity.facts.find((fact) => fact.a === attribute)?.v;
}

export async function seedCollectionsKernel(kernel) {
	const existingMeta = kernel.listEntities(META_TYPE);
	const slugs = new Set(
		existingMeta.map((entity) => String(factValue(entity, 'slug') ?? '')).filter(Boolean)
	);

	let metaCreated = 0;
	let recordsCreated = 0;

	for (const collection of SEED_COLLECTIONS) {
		if (!slugs.has(collection.slug)) {
			await kernel.createEntity(collection.id, META_TYPE, {
				title: collection.title,
				slug: collection.slug,
				icon: collection.icon,
				color: collection.color,
				description: collection.description,
				sortOrder: collection.sortOrder
			});
			metaCreated++;
			slugs.add(collection.slug);
		}

		const existingRecords = kernel.listEntities(RECORD_TYPE);
		const titlesForCollection = new Set(
			existingRecords
				.filter((entity) => factValue(entity, 'collectionId') === collection.id)
				.map((entity) => String(factValue(entity, 'title') ?? ''))
		);

		for (let i = 0; i < collection.records.length; i++) {
			const row = collection.records[i];
			if (titlesForCollection.has(row.title)) continue;
			await kernel.createEntity(`${RECORD_PREFIX}${randomUUID()}`, RECORD_TYPE, {
				collectionId: collection.id,
				title: row.title,
				body: row.body,
				sortOrder: i,
				laneId: 'main'
			});
			recordsCreated++;
		}
	}

	return { metaCreated, recordsCreated };
}

/** @deprecated Use seedCollectionsKernel */
export const seedCustomEntitiesKernel = seedCollectionsKernel;

/** @deprecated Tags removed from collections demo */
export async function seedTagsKernel() {
	return 0;
}
