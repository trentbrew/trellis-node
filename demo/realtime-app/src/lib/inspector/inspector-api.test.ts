import { describe, expect, it, vi, afterEach } from 'vitest';
import {
	entityAttrs,
	entityTypeCounts,
	fetchEntities,
	fetchHealth,
	runQuery
} from './inspector-api';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('entityAttrs', () => {
	it('skips id and type', () => {
		expect(entityAttrs({ id: '1', type: 'Note', title: 'Hi' })).toEqual([['title', 'Hi']]);
	});
});

describe('entityTypeCounts', () => {
	it('counts by type', () => {
		expect(
			entityTypeCounts([
				{ type: 'A', id: '1' },
				{ type: 'B', id: '2' },
				{ type: 'A', id: '3' }
			])
		).toEqual({ A: 2, B: 1 });
	});
});

describe('fetchEntities', () => {
	it('parses entity list', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ data: [{ id: '1', type: 'Note' }], total: 1 })
			})
		);
		const result = await fetchEntities('http://localhost:3920');
		expect(result.data).toHaveLength(1);
		expect(result.total).toBe(1);
	});
});

describe('runQuery', () => {
	it('throws on error field', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				json: async () => ({ error: 'bad query' })
			})
		);
		await expect(runQuery('http://localhost:3920', 'find')).rejects.toThrow('bad query');
	});
});

describe('fetchHealth', () => {
	it('returns health json', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ ok: true })
			})
		);
		await expect(fetchHealth('http://localhost:3920')).resolves.toEqual({ ok: true });
	});
});
