#!/usr/bin/env node
/**
 * Start trellis-node graph sidecar with async backend preload (Node + WC compatible).
 */
import { readConfig } from 'trellis/client';
import { TenantPool, startServerCrossRuntime } from 'trellis/server';
import { attachStandardMiddleware } from 'trellis/core';
import { seedFrameworksKernel, seedTagsKernel } from './seed-kernel.mjs';
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

const FRAMEWORK_ONTOLOGY = {
	'@id': 'https://trellis.dev/ns/framework/v1/Framework',
	'@type': 'trellis:Schema',
	version: '1.0.0',
	tier: 'user',
	subClassOf: 'core:Record',
	label: 'Framework',
	labelPlural: 'Frameworks',
	fields: [
		{ name: 'title', valueType: 'title', required: true },
		{ name: 'slug', valueType: 'rich_text' },
		{ name: 'sortOrder', valueType: 'number' },
		{
			name: 'laneId',
			valueType: 'rich_text',
			description: 'Mutation lane — main or agent:<id> draft stream'
		},
		{
			name: 'titleLength',
			valueType: 'formula',
			formula: '$len($title)',
			computed: true,
			description: 'Kernel-computed title length (TRL-20 demo)'
		},
		{
			name: 'tagCount',
			valueType: 'rollup',
			rollup: {
				relationProperty: 'tags',
				targetProperty: 'id',
				aggregation: 'count',
				joinEntity: { type: 'frameworkTag', foreignKey: 'frameworkId' }
			},
			computed: true,
			description: 'Kernel rollup over frameworkTag join-entities (TRL-21)'
		}
	]
};

try {
	kernel.createOntology(FRAMEWORK_ONTOLOGY);
	console.log('✓ Framework ontology registered');
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes('already exists')) {
		kernel.updateOntology(FRAMEWORK_ONTOLOGY['@id'], {
			fields: FRAMEWORK_ONTOLOGY.fields
		});
		console.log('✓ Framework ontology updated (formula fields)');
	} else {
		throw error;
	}
}

attachStandardMiddleware(kernel);

const seeded = await seedFrameworksKernel(kernel);
if (seeded > 0) {
	console.log(`✓ Seeded ${seeded} framework(s)`);
}

const tagsSeeded = await seedTagsKernel(kernel);
if (tagsSeeded > 0) {
	console.log(`✓ Seeded ${tagsSeeded} tag(s)`);
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
console.log(`  Frameworks app → http://localhost:4000 (not this port)`);
if (config.apiKey) {
	console.log(`  API key: ${config.apiKey}`);
}
