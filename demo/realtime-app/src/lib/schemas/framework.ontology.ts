import { FRAMEWORK_CONTEXT } from './framework';

export const FRAMEWORK_ONTOLOGY_ID = `${FRAMEWORK_CONTEXT}/Framework`;

/** Matches trellis SchemaDefinition — registered at sidecar startup. */
export const frameworkOntology = {
	'@id': FRAMEWORK_ONTOLOGY_ID,
	'@type': 'trellis:Schema',
	version: '1.0.0',
	tier: 'user',
	subClassOf: 'core:Record',
	label: 'Framework',
	labelPlural: 'Frameworks',
	fields: [
		{ name: 'title', valueType: 'title', required: true },
		{ name: 'slug', valueType: 'rich_text' },
		{ name: 'sortOrder', valueType: 'number' },
		{
			name: 'laneId',
			valueType: 'rich_text',
			description: 'Mutation lane — main or agent:<id> draft stream'
		},
		{
			name: 'titleLength',
			valueType: 'formula',
			formula: '$len($title)',
			computed: true,
			description: 'Kernel-computed title length (TRL-20 demo)'
		},
		{
			name: 'tagCount',
			valueType: 'rollup',
			rollup: {
				relationProperty: 'tags',
				targetProperty: 'id',
				aggregation: 'count',
				joinEntity: { type: 'frameworkTag', foreignKey: 'frameworkId' }
			},
			computed: true,
			description: 'Kernel rollup over frameworkTag join-entities (TRL-21)'
		}
	]
};
