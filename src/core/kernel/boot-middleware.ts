/**
 * Standard kernel middleware registered at boot (db serve, CLI entity ops).
 */

import type { SchemaDefinition } from '../ontology/types.js';
import type { TrellisKernel } from './trellis-kernel.js';
import { createLogicMiddleware } from './logic-middleware.js';
import { createSchemaMiddleware } from './schema-middleware.js';

/** Index schemas by @id, short name, and label for entity-type lookup. */
export function buildOntologyIndex(
  schemas: SchemaDefinition[],
): Map<string, SchemaDefinition> {
  const map = new Map<string, SchemaDefinition>();
  for (const schema of schemas) {
    map.set(schema['@id'], schema);
    const short = schema['@id'].includes(':')
      ? schema['@id'].split(':').pop()!
      : schema['@id'];
    if (short) {
      map.set(short, schema);
      map.set(short.toLowerCase(), schema);
    }
    if (schema.label) {
      map.set(schema.label, schema);
      map.set(schema.label.toLowerCase(), schema);
    }
  }
  return map;
}

/** Register standard post-query enrichment and schema validation middleware. */
export function attachStandardMiddleware(kernel: TrellisKernel): void {
  kernel.removeMiddleware('logic-computation');
  kernel.removeMiddleware('schema-validation');

  const getOntologies = () => buildOntologyIndex(kernel.listOntologies());

  kernel.addMiddleware(
    createSchemaMiddleware({
      getOntologies,
    }),
  );

  kernel.addMiddleware(
    createLogicMiddleware({
      ontologies: getOntologies(),
      getStore: () => kernel.getStore(),
      getEntityType: (entityId) => kernel.getEntity(entityId)?.type,
    }),
  );
}
