import { describe, expect, it } from 'vitest';
import { ENTITY_CLASS_INSETS, resolveInsetTemplate } from './entity-class-insets';

describe('resolveInsetTemplate', () => {
	it('returns null without entityClass or dialogShell', () => {
		expect(resolveInsetTemplate({})).toBeNull();
	});

	it.each(ENTITY_CLASS_INSETS)('resolves $entityClass to $id', (spec) => {
		const result = resolveInsetTemplate({ entityClass: spec.entityClass });
		expect(result).toEqual(spec);
	});

	it('resolves dialogShell override by legacy shell name', () => {
		expect(resolveInsetTemplate({ dialogShell: 'ActorDialogShell' })?.id).toBe('actor-inset');
		expect(resolveInsetTemplate({ dialogShell: 'DocumentDialogShell' })?.id).toBe('document-inset');
	});

	it('resolves dialogShell override by bare entity class string', () => {
		expect(resolveInsetTemplate({ dialogShell: 'temporal' })?.id).toBe('temporal-inset');
		expect(resolveInsetTemplate({ dialogShell: 'container' })?.id).toBe('container-inset');
	});

	it('prefers dialogShell override over entityClass when both provided', () => {
		const result = resolveInsetTemplate({
			entityClass: 'document',
			dialogShell: 'TemporalDialogShell'
		});
		expect(result?.id).toBe('temporal-inset');
	});
});
