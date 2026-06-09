#!/usr/bin/env node
/**
 * Start trellis-node graph sidecar with async backend preload (Node + WC compatible).
 */
import { readConfig } from 'trellis/client';
import { TenantPool, startServerCrossRuntime } from 'trellis/server';
import { attachStandardMiddleware } from 'trellis/core';
import { seedCollectionsKernel } from './seed-kernel.mjs';
import { seedNavKernel } from './seed-nav-kernel.mjs';

const port = Number(process.env.TRELLIS_PORT ?? 3920);
const config = readConfig('.');

if (!config?.dbPath) {
	console.error('No .trellis-db.json — run: pnpm trellis:init');
	process.exit(1);
}

const backendOpts =
	process.env.TRELLIS_BACKEND === 'sqljs'
		? { backend: 'sqljs' }
		: process.env.TRELLIS_BACKEND === 'better-sqlite'
			? { backend: 'better-sqlite' }
			: undefined;

const pool = new TenantPool(config.dbPath, backendOpts ? { backend: backendOpts } : undefined);

console.log('Preloading Trellis kernel…');

await pool.preload();

const kernel = pool.get(null);

const COLLECTION_ONTOLOGIES = [
	{
		'@id': 'https://trellis.dev/ns/demo/v1/CollectionMeta',
		'@type': 'trellis:Schema',
		version: '1.0.0',
		tier: 'user',
		subClassOf: 'core:Record',
		label: 'Collection',
		labelPlural: 'Collections',
		fields: [
			{ name: 'title', valueType: 'title', required: true },
			{ name: 'slug', valueType: 'rich_text', required: true },
			{ name: 'icon', valueType: 'rich_text' },
			{ name: 'color', valueType: 'rich_text' },
			{ name: 'description', valueType: 'rich_text' },
			{ name: 'sortOrder', valueType: 'number' }
		]
	},
	{
		'@id': 'https://trellis.dev/ns/demo/v1/CollectionRecord',
		'@type': 'trellis:Schema',
		version: '1.0.0',
		tier: 'user',
		subClassOf: 'core:Record',
		label: 'CollectionRecord',
		labelPlural: 'CollectionRecords',
		fields: [
			{ name: 'collectionId', valueType: 'rich_text', required: true },
			{ name: 'title', valueType: 'title', required: true },
			{ name: 'body', valueType: 'rich_text' },
			{ name: 'sortOrder', valueType: 'number' },
			{
				name: 'laneId',
				valueType: 'rich_text',
				description: 'Mutation lane — main or agent:<id> draft stream'
			}
		]
	}
];

for (const ontology of COLLECTION_ONTOLOGIES) {
	try {
		kernel.createOntology(ontology);
		console.log(`✓ ${ontology.label} ontology registered`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('already exists')) {
			kernel.updateOntology(ontology['@id'], { fields: ontology.fields });
			console.log(`✓ ${ontology.label} ontology updated`);
		} else {
			throw error;
		}
	}
}

attachStandardMiddleware(kernel);

const seeded = await seedCollectionsKernel(kernel);
if (seeded.metaCreated > 0) {
	console.log(`✓ Seeded ${seeded.metaCreated} collection(s)`);
}
if (seeded.recordsCreated > 0) {
	console.log(`✓ Seeded ${seeded.recordsCreated} collection record(s)`);
}

const navSeed = await seedNavKernel(kernel);
if (navSeed.deduped > 0) {
	console.log(`✓ Deduped ${navSeed.deduped} duplicate nav item(s)`);
}
if (navSeed.created > 0) {
	console.log(`✓ Seeded ${navSeed.created} nav item(s)`);
}

await startServerCrossRuntime({ port, config, pool });

console.log(`✓ Trellis DB → http://localhost:${port} (API + inspector)`);
console.log(`  Realtime explorer → http://localhost:4000 (not this port)`);
if (config.apiKey) {
	console.log(`  API key: ${config.apiKey}`);
}
