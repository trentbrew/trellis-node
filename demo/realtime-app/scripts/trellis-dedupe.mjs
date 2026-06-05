#!/usr/bin/env node
/**
 * Remove duplicate framework entities (keeps oldest per slug).
 *
 *   pnpm trellis:dedupe
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');

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
	if (method === 'DELETE' && res.status === 204) return;
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.message ?? res.statusText}`);
	return data;
}

const config = readConfig();
const list = await api(config, 'GET', '/entities?type=framework&limit=500');
const entities = list.data ?? [];

const bySlug = new Map();
for (const entity of entities) {
	const slug = String(entity.slug ?? slugify(String(entity.title ?? entity.id)));
	const group = bySlug.get(slug) ?? [];
	group.push(entity);
	bySlug.set(slug, group);
}

let removed = 0;
for (const [, group] of bySlug) {
	if (group.length <= 1) continue;
	group.sort((a, b) => String(a.createdAt ?? a.id).localeCompare(String(b.createdAt ?? b.id)));
	for (const duplicate of group.slice(1)) {
		await api(config, 'DELETE', `/entities/${encodeURIComponent(duplicate.id)}`);
		removed++;
	}
}

console.log(removed ? `✓ Removed ${removed} duplicate framework(s)` : '✓ No duplicates found');
