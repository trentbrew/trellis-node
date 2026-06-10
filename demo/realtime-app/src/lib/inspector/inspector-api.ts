const ATTR_SKIP = new Set(['id', 'type']);

export type TrellisEntity = Record<string, unknown> & { id?: string; type?: string };

export function entityAttrs(entity: TrellisEntity): [string, unknown][] {
	return Object.entries(entity).filter(([key]) => !ATTR_SKIP.has(key));
}

export function entityTypeCounts(entities: TrellisEntity[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const entity of entities) {
		const type = String(entity.type ?? 'unknown');
		counts[type] = (counts[type] ?? 0) + 1;
	}
	return counts;
}

export async function fetchEntities(
	baseUrl: string,
	limit = 200
): Promise<{ data: TrellisEntity[]; total?: number }> {
	const res = await fetch(`${baseUrl}/entities?limit=${limit}`);
	if (!res.ok) throw new Error(`entities ${res.status}`);
	const json = (await res.json()) as { data?: TrellisEntity[]; total?: number };
	return { data: json.data ?? [], total: json.total };
}

export async function runQuery(baseUrl: string, query: string): Promise<unknown> {
	const res = await fetch(`${baseUrl}/query`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query })
	});
	const json = (await res.json()) as { error?: string };
	if (json.error) throw new Error(json.error);
	return json;
}

export async function fetchHealth(baseUrl: string): Promise<unknown> {
	const res = await fetch(`${baseUrl}/health`);
	if (!res.ok) throw new Error(`health ${res.status}`);
	return res.json();
}

export const QUERY_EXAMPLES = [
	'find Note',
	'find Note where pinned = "true"',
	'find CollectionRecord limit 5'
] as const;
