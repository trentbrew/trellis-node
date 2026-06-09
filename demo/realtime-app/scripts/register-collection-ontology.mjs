#!/usr/bin/env node
/** Register CollectionMeta + CollectionRecord ontologies (idempotent). */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TenantPool } from 'trellis/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
const configPath = resolve(appRoot, '.trellis-db.json');
if (!existsSync(configPath)) {
	console.error('Missing .trellis-db.json — run pnpm trellis:init');
	process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));

const pool = new TenantPool(config.dbPath);
await pool.preload();
const kernel = pool.get(null);

const ONTOLOGIES = [
	{
		'@id': 'https://trellis.dev/ns/demo/v1/CollectionMeta',
		'@type': 'trellis:Schema',
		version: '1.0.0',
		tier: 'user',
		subClassOf: 'core:Record',
		label: 'Collection',
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
		fields: [
			{ name: 'collectionId', valueType: 'rich_text', required: true },
			{ name: 'title', valueType: 'title', required: true },
			{ name: 'body', valueType: 'rich_text' },
			{ name: 'sortOrder', valueType: 'number' },
			{ name: 'laneId', valueType: 'rich_text' }
		]
	}
];

for (const ontology of ONTOLOGIES) {
	try {
		kernel.createOntology(ontology);
		console.log(`✓ Registered ${ontology.label}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('already exists')) {
			kernel.updateOntology(ontology['@id'], { fields: ontology.fields });
			console.log(`✓ Updated ${ontology.label}`);
		} else {
			throw error;
		}
	}
}
