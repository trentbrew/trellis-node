#!/usr/bin/env node
/**
 * Register framework ontology on the Trellis kernel (idempotent).
 */
import { readConfig } from 'trellis/client';
import { TenantPool } from 'trellis/server';
import { attachStandardMiddleware } from 'trellis/core';

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
await pool.preload();

const kernel = pool.get(null);

try {
	kernel.createOntology(FRAMEWORK_ONTOLOGY);
	console.log('✓ Registered framework ontology');
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes('already exists')) {
		kernel.updateOntology(FRAMEWORK_ONTOLOGY['@id'], {
			fields: FRAMEWORK_ONTOLOGY.fields
		});
		console.log('✓ Framework ontology updated (formula fields)');
	} else {
		console.error(message);
		process.exit(1);
	}
}

attachStandardMiddleware(kernel);
pool.closeAll();
