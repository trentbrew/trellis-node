/**
 * Trellis React — schema-typed, live entity hooks.
 *
 * A parallel surface to `trellis/react`'s string-keyed hooks: these are typed by
 * a {@link AnyType} from `trellis/schema` and back reads with the Signal-first
 * {@link liveEntities} primitive (live subscription + hydration, no polling).
 * Shipped under a separate entry (`trellis/react/typed`) so it does not collide
 * with the existing `useEntity(id, opts)` overload.
 *
 *   import { defineType } from 'trellis/schema';
 *   import { useEntities, useEntity, useMutation } from 'trellis/react/typed';
 *
 *   const { data: sections } = useEntities(NavSection);            // live list
 *   const { data: items } = useEntities(NavItem, { section: id }); // live + filtered
 *   const nav = useMutation(NavSection);
 *   await nav.create({ label: 'Home', order: 0, collapsed: false });
 *
 * @module trellis/react/typed
 */
import { useEffect, useMemo } from 'react';
import { Signal } from '../client/reactive.js';
import {
  liveEntities,
  type LiveEntitiesOptions,
  type ReadState,
} from '../client/live.js';
import type { EntityData } from '../client/sdk.js';
import { entityMutations, type EntityMutations } from '../schema/mutations.js';
import type { AnyType, InferType } from '../schema/define.js';
import { useTrellis } from './provider.js';
import { useSignal } from './realtime.js';

const IDLE = new Signal<ReadState<EntityData[]>>({
  data: [],
  loading: false,
  error: null,
});

export interface TypedReadResult<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

/** `where` shorthand or full read options including `resolve`. */
export type TypedReadOptions<S extends AnyType> = LiveEntitiesOptions &
  Partial<{
    where: Partial<InferType<S>>;
    resolve: Partial<Record<keyof S['relations'] & string, boolean>>;
  }>;

function parseReadOptions<S extends AnyType>(
  opts?: Partial<InferType<S>> | TypedReadOptions<S>,
): LiveEntitiesOptions {
  if (!opts) return {};
  if ('resolve' in opts || 'where' in opts) return opts as LiveEntitiesOptions;
  return { where: opts as Record<string, unknown> };
}

/** Live subscription to all entities of a type, optionally filtered / resolved. */
function useLiveEntities<S extends AnyType>(
  schema: S | null,
  opts?: Partial<InferType<S>> | TypedReadOptions<S>,
): ReadState<EntityData[]> {
  const client = useTrellis();
  const parsed = parseReadOptions(opts);
  const optsKey = JSON.stringify(parsed);
  const res = useMemo(
    () => (schema ? liveEntities(client, schema, parsed) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, schema, optsKey],
  );
  useEffect(() => res?.start(), [res]);
  return useSignal((res?.signal ?? IDLE) as Signal<ReadState<EntityData[]>>);
}

/** Live list of a type — filter with `where`, expand relations with `resolve`. */
export function useEntities<S extends AnyType>(
  schema: S,
  opts?: Partial<InferType<S>> | TypedReadOptions<S>,
): TypedReadResult<InferType<S>[]> {
  const state = useLiveEntities(schema, opts);
  return {
    data: state.data as unknown as InferType<S>[],
    loading: state.loading,
    error: state.error,
  };
}

/**
 * Live single entity by id, typed by its schema. `null` until loaded / if absent.
 *
 * Since `id` is not an EQL-queryable attribute, this subscribes to the type and
 * selects the matching row — fine for bounded sets (nav, settings). Reach for a
 * dedicated read if you need a single hot entity out of a large collection.
 */
export function useEntity<S extends AnyType>(
  schema: S,
  id: string | null | undefined,
): TypedReadResult<InferType<S> | null> {
  const state = useLiveEntities(id ? schema : null);
  const found = id ? (state.data.find((e) => e.id === id) ?? null) : null;
  return {
    data: found as InferType<S> | null,
    loading: state.loading,
    error: state.error,
  };
}

/** Schema-typed create/update/remove. Payloads are checked against the schema. */
export function useMutation<S extends AnyType>(
  schema: S,
): EntityMutations<InferType<S>> {
  const client = useTrellis();
  return useMemo(() => entityMutations(client, schema), [client, schema]);
}
