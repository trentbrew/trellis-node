/**
 * Server-side relation resolution — kernel-backed read/query adapter.
 *
 * Used by the realtime subscription engine (TRL-6) so `resolve` expansion runs
 * on the server before push, avoiding client N+1 reads.
 *
 * @module trellis/schema
 */
import { z } from 'zod';
import { parseSimple } from '../core/query/index.js';
import type { TrellisKernel } from '../core/kernel/trellis-kernel.js';
import type { SchemaDefinition } from '../core/ontology/types.js';
import type { EntityData, QueryResult } from '../client/sdk.js';
import type { RelationResolveClient } from './resolve.js';
import {
  rel,
  type AnyType,
  type ComputedMap,
  type RelationMap,
} from './define.js';
import { entitiesQuery } from './eql.js';
import { entityRecordToPlain, hydrateBindings } from './entity-projection.js';
import { resolveRelations, type ResolveSpec } from './resolve.js';

/** Short name from `trellis:NavSection` → `NavSection`. */
export function ontologyTypeName(id: string): string {
  return id.includes(':') ? id.split(':').pop()! : id;
}

/** Find a registered ontology schema by entity `type` fact value. */
export function findOntologyByTypeName(
  kernel: TrellisKernel,
  typeName: string,
): SchemaDefinition | undefined {
  return kernel.listOntologies().find((s) => {
    const short = ontologyTypeName(s['@id']);
    return (
      short === typeName ||
      short.toLowerCase() === typeName.toLowerCase() ||
      s.label === typeName
    );
  });
}

/** Build a minimal {@link AnyType} handle from a kernel ontology (for server resolve). */
export function schemaHandleFromOntology(
  def: SchemaDefinition,
  typeName?: string,
): AnyType {
  const name = typeName ?? ontologyTypeName(def['@id']);
  const relations: RelationMap = {};
  for (const field of def.fields) {
    if (field.valueType === 'relation' && field.relation?.targetSchema) {
      const target = ontologyTypeName(field.relation.targetSchema);
      relations[field.name] = rel(
        target,
        field.relation.cardinality ?? 'one',
      );
    }
  }
  return {
    type: name,
    zod: z.object({}),
    relations,
    computed: {} as ComputedMap,
    definition: def,
    toOntologySchema: () => {
      throw new Error('schemaHandleFromOntology: legacy adapter not available');
    },
  } as AnyType;
}

/** Lookup table for relation targets registered in the kernel. */
export function createSchemaLookup(
  kernel: TrellisKernel,
): (typeName: string) => AnyType | null {
  const cache = new Map<string, AnyType>();
  return (typeName: string) => {
    if (cache.has(typeName)) return cache.get(typeName)!;
    const def = findOntologyByTypeName(kernel, typeName);
    if (!def) return null;
    const handle = schemaHandleFromOntology(def, typeName);
    cache.set(typeName, handle);
    return handle;
  };
}

/** {@link TrellisDb} surface backed by an in-process kernel (server resolve path). */
export function createKernelResolveClient(
  kernel: TrellisKernel,
): RelationResolveClient {
  return {
    read: async (id: string) => {
      const entity = kernel.getEntity(id);
      return entity ? entityRecordToPlain(entity) : null;
    },
    query: async (q: string) => {
      const parsed = parseSimple(q);
      const qr = await kernel.query(parsed);
      return {
        bindings: hydrateBindings(
          kernel,
          qr.bindings as Record<string, unknown>[],
        ),
        executionTime: qr.executionTime,
      };
    },
  };
}

/**
 * Hydrate query bindings and optionally expand relations before wire push.
 */
export async function hydrateAndResolve(
  kernel: TrellisKernel,
  bindings: Record<string, unknown>[],
  entityType?: string,
  resolve?: ResolveSpec,
): Promise<EntityData[]> {
  let entities = hydrateBindings(kernel, bindings);
  if (!entityType || !resolve || Object.keys(resolve).length === 0) {
    return entities;
  }

  const def = findOntologyByTypeName(kernel, entityType);
  if (!def) return entities;

  const schema = schemaHandleFromOntology(def, entityType);
  const client = createKernelResolveClient(kernel);
  const lookup = createSchemaLookup(kernel);

  return resolveRelations(client, schema, entities, resolve, {
    schemaLookup: lookup,
  });
}
