/** Mirrors `trellis/core` ontology `EntityClass` (not yet in published dist exports). */
export type EntityClass = 'temporal' | 'document' | 'actor' | 'container';

/**
 * L3 operator inset templates — entity-class keyed detail surfaces (ADR 0012).
 * Replaces trellis-client's four permanent dialog shells with anchored inset binding.
 */
export type InsetTemplateId =
	| 'temporal-inset'
	| 'document-inset'
	| 'actor-inset'
	| 'container-inset';

export type InsetTemplateSpec = {
	id: InsetTemplateId;
	label: string;
	entityClass: EntityClass;
	/** Legacy dialog shell name from ENTITY_CLASSES (trellis-client). */
	defaultDialogShell: string;
	/** Anchored when selection is set; ambient mount has no template. */
	mount: 'anchored';
	/** Seed vantage territory when opening from collection row (fractal wedge). */
	defaultVantage: number;
};

export const ENTITY_CLASS_INSETS: InsetTemplateSpec[] = [
	{
		id: 'temporal-inset',
		label: 'Temporal',
		entityClass: 'temporal',
		defaultDialogShell: 'TemporalDialogShell',
		mount: 'anchored',
		defaultVantage: 5
	},
	{
		id: 'document-inset',
		label: 'Document',
		entityClass: 'document',
		defaultDialogShell: 'DocumentDialogShell',
		mount: 'anchored',
		defaultVantage: 8
	},
	{
		id: 'actor-inset',
		label: 'Actor',
		entityClass: 'actor',
		defaultDialogShell: 'ActorDialogShell',
		mount: 'anchored',
		defaultVantage: 10
	},
	{
		id: 'container-inset',
		label: 'Container',
		entityClass: 'container',
		defaultDialogShell: 'ContainerDialogShell',
		mount: 'anchored',
		defaultVantage: 8
	}
];

const BY_CLASS = new Map<EntityClass, InsetTemplateSpec>(
	ENTITY_CLASS_INSETS.map((spec) => [spec.entityClass, spec])
);

const BY_DIALOG_SHELL = new Map<string, InsetTemplateSpec>(
	ENTITY_CLASS_INSETS.flatMap((spec) => [
		[spec.defaultDialogShell, spec],
		[spec.entityClass, spec]
	])
);

export type ResolveInsetTemplateInput = {
	entityClass?: EntityClass;
	dialogShell?: string;
};

/**
 * Resolve anchored L3 inset template from selection context.
 * Returns null when no entity class — caller renders ambient graph tools (ADR 0012).
 */
export function resolveInsetTemplate(input: ResolveInsetTemplateInput): InsetTemplateSpec | null {
	if (input.dialogShell) {
		const byShell = BY_DIALOG_SHELL.get(input.dialogShell);
		if (byShell) return byShell;
	}

	if (!input.entityClass) return null;

	return BY_CLASS.get(input.entityClass) ?? null;
}
