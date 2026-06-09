#!/usr/bin/env node
/**
 * Seed demo collections once (idempotent). Run after trellis:init.
 *
 *   pnpm trellis:seed
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');

const SEED_COLLECTIONS = [
	{
		id: 'collectionMeta:ideas',
		title: 'Ideas',
		slug: 'ideas',
		icon: '💡',
		color: '#0f62fe',
		description: 'Rough concepts and sparks worth revisiting',
		sortOrder: 0
	}
];

function readConfig() {
	const path = resolve(appRoot, '.trellis-db.json');
	if (!existsSync(path)) {
		console.error('Missing .trellis-db.json — run `pnpm trellis:init` first.');
		process.exit(1);
	}
	return JSON.parse(readFileSync(path, 'utf8'));
}

async function api(config, method, path, body) {
	const url = `${config.url ?? `http://localhost:${config.port ?? 3920}`}${path}`;
	const res = await fetch(url, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
		},
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.message ?? res.statusText}`);
	return data;
}

const config = readConfig();
const metaList = await api(config, 'GET', '/entities?type=CollectionMeta&limit=500');
const slugs = new Set((metaList.data ?? []).map((e) => String(e.slug ?? '')));

let created = 0;
for (const collection of SEED_COLLECTIONS) {
	if (slugs.has(collection.slug)) continue;
	await api(config, 'POST', '/entities', {
		id: collection.id,
		type: 'CollectionMeta',
		attributes: {
			title: collection.title,
			slug: collection.slug,
			icon: collection.icon,
			color: collection.color,
			description: collection.description,
			sortOrder: collection.sortOrder
		}
	});
	created++;
}

if (created === 0) {
	console.log('✓ Collection seed data already present');
} else {
	console.log(`✓ Seeded ${created} collection(s)`);
}
