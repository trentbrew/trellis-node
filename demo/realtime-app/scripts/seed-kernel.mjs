#!/usr/bin/env node
/**
 * Idempotent framework seed via kernel (runs inside trellis-serve before HTTP starts).
 */
import { randomUUID } from 'node:crypto';

const SEED_TITLES = ['svelte', 'sveltekit', 'solid', 'react', 'vue'];
const SEED_TAGS = ['meta', 'ui', 'ssr'];

function slugify(title) {
	return title
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function factValue(entity, attribute) {
	return entity.facts.find((fact) => fact.a === attribute)?.v;
}

export async function seedFrameworksKernel(kernel) {
	const existing = kernel.listEntities('framework');
	const mainSlugs = new Set(
		existing
			.filter((entity) => {
				const lane = factValue(entity, 'laneId');
				return lane == null || lane === '' || lane === 'main';
			})
			.map((entity) =>
				String(factValue(entity, 'slug') ?? slugify(String(factValue(entity, 'title') ?? '')))
			)
	);

	let created = 0;
	for (let i = 0; i < SEED_TITLES.length; i++) {
		const title = SEED_TITLES[i];
		const slug = slugify(title);
		if (mainSlugs.has(slug)) continue;

		await kernel.createEntity(`framework:${randomUUID()}`, 'framework', {
			title,
			slug,
			sortOrder: i,
			laneId: 'main'
		});
		created++;
	}

	return created;
}

export async function seedTagsKernel(kernel) {
	const existing = kernel.listEntities('tag');
	const names = new Set(
		existing.map((entity) => String(factValue(entity, 'name') ?? '')).filter(Boolean)
	);

	let created = 0;
	for (const name of SEED_TAGS) {
		if (names.has(name)) continue;
		await kernel.createEntity(`tag:${randomUUID()}`, 'tag', { name });
		created++;
	}

	return created;
}
