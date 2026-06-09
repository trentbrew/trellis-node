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
  liveEntity,
  type LiveEntitiesOptions,
  type LiveEntityOptions,
  type ReadState,
} from '../client/live.js';
import type { EntityData } from '../client/sdk.js';
import { entityMutations, type EntityMutations } from '../schema/mutations.js';
import type {
  AnyType,
  InferEntitiesRead,
  InferEntityRead,
  InferType,
  ResolveSpecFor,
} from '../schema/define.js';
import type { WhereInput } from '../schema/eql.js';
import { useTrellis } from './provider.js';
import { useSignal } from './realtime.js';

const IDLE = new Signal<ReadState<EntityData[]>>({
  data: [],
  loading: false,
  error: null,
});

const IDLE_SINGLE = new Signal<ReadState<EntityData | null>>({
  data: null,
  loading: false,
  error: null,
});

export interface TypedReadResult<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

/** `where` shorthand or full read options including nested `resolve`. */
export type TypedReadOptions<S extends AnyType> = LiveEntitiesOptions & {
  where?: WhereInput;
  resolve?: ResolveSpecFor<S>;
};

/** Options for {@link useEntity} — optional relation expansion. */
export type TypedEntityOptions<S extends AnyType> = LiveEntityOptions & {
  resolve?: ResolveSpecFor<S>;
};

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

function useLiveEntity<S extends AnyType>(
  schema: S | null,
  id: string | null | undefined,
  opts?: TypedEntityOptions<S>,
): ReadState<EntityData | null> {
  const client = useTrellis();
  const optsKey = JSON.stringify(opts ?? {});
  const res = useMemo(
    () =>
      schema && id
        ? liveEntity(client, schema, id, opts)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, schema, id, optsKey],
  );
  useEffect(() => res?.start(), [res]);
  return useSignal(
    (res?.signal ?? IDLE_SINGLE) as Signal<ReadState<EntityData | null>>,
  );
}

/** Live list of a type — filter with `where`, expand relations with `resolve`. */
export function useEntities<
  S extends AnyType,
  O extends Partial<InferType<S>> | TypedReadOptions<S> | undefined = undefined,
>(
  schema: S,
  opts?: O,
): TypedReadResult<InferEntitiesRead<S, O>> {
  const state = useLiveEntities(schema, opts);
  return {
    data: state.data as unknown as InferEntitiesRead<S, O>,
    loading: state.loading,
    error: state.error,
  };
}

/**
 * Live single entity by id — read-first, then kept fresh via type subscription.
 *
 * `id` may be `null`/`undefined` while routing resolves; returns `{ data: null, loading: false }`.
 */
export function useEntity<
  S extends AnyType,
  O extends TypedEntityOptions<S> | undefined = undefined,
>(
  schema: S,
  id: string | null | undefined,
  opts?: O,
): TypedReadResult<InferEntityRead<S, O>> {
  const state = useLiveEntity(id ? schema : null, id, opts);
  return {
    data: state.data as unknown as InferEntityRead<S, O>,
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
