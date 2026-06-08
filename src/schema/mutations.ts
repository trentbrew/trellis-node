/**
 * Framework-agnostic, schema-typed mutations. The React `useMutation`, Vue
 * `useMutation`, and Svelte mutation helper all delegate here so create/update
 * payloads are checked against the schema in exactly one place.
 *
 * @module trellis/schema
 */
import type { TrellisDb } from '../client/sdk.js';
import type { AnyType, InferType } from './define.js';

export interface EntityMutations<E> {
  /** Create an entity of this type. Returns the new id. */
  create(attrs: Omit<E, 'id' | 'type'>): Promise<string>;
  /** Patch an entity's attributes. */
  update(id: string, attrs: Partial<Omit<E, 'id' | 'type'>>): Promise<void>;
  /** Delete an entity by id. */
  remove(id: string): Promise<void>;
}

/** Bind create/update/remove for a schema to a client. */
export function entityMutations<S extends AnyType>(
  client: TrellisDb,
  schema: S,
): EntityMutations<InferType<S>> {
  return {
    create: (attrs) =>
      client.create(schema.type, attrs as Record<string, unknown>),
    update: (id, attrs) =>
      client.update(id, attrs as Record<string, unknown>),
    remove: (id) => client.delete(id),
  };
}
