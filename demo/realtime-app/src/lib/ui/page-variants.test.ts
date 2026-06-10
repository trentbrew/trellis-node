import { describe, expect, it } from 'vitest';
import { resolveCollectionPageVariant, variantConfig } from './page-variants';

describe('variantConfig', () => {
	it('browse shows toolbar', () => {
		expect(variantConfig('browse').showToolbar).toBe(true);
	});

	it('calendar hides toolbar', () => {
		expect(variantConfig('calendar').showToolbar).toBe(false);
	});
});

describe('resolveCollectionPageVariant', () => {
	it('maps table + L2 to browse', () => {
		expect(resolveCollectionPageVariant('table', 'L2')).toBe('browse');
	});

	it('maps table + L1 to prose', () => {
		expect(resolveCollectionPageVariant('table', 'L1')).toBe('prose');
	});

	it('maps calendar to calendar variant', () => {
		expect(resolveCollectionPageVariant('calendar', 'L2')).toBe('calendar');
	});

	it('maps card-grid to grid', () => {
		expect(resolveCollectionPageVariant('card-grid', 'L2')).toBe('grid');
	});
});
