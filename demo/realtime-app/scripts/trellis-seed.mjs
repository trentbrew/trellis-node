#!/usr/bin/env node
/**
 * Seed demo frameworks once (idempotent by slug). Run after trellis:init.
 *
 *   pnpm trellis:seed
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');

const SEED_TITLES = ['svelte', 'sveltekit', 'solid', 'react', 'vue'];

function readConfig() {
	const path = resolve(appRoot, '.trellis-db.json');
	if (!existsSync(path)) {
		console.error('Missing .trellis-db.json — run `pnpm trellis:init` first.');
		process.exit(1);
	}
	return JSON.parse(readFileSync(path, 'utf8'));
}

function slugify(title) {
	return title
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
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
const list = await api(config, 'GET', '/entities?type=framework&limit=500');
const slugs = new Set(
	(list.data ?? []).map((e) => String(e.slug ?? slugify(String(e.title ?? ''))))
);

let created = 0;
for (let i = 0; i < SEED_TITLES.length; i++) {
	const title = SEED_TITLES[i];
	const slug = slugify(title);
	if (slugs.has(slug)) continue;
	await api(config, 'POST', '/entities', {
		type: 'framework',
		attributes: { title, slug, sortOrder: i, laneId: 'main' }
	});
	created++;
}

console.log(created ? `✓ Seeded ${created} framework(s)` : '✓ Seed data already present');
