/**
 * Trellis Vue — schema-typed, live entity composables.
 *
 * The Vue half of the typed read surface. Identical semantics to
 * `trellis/react/typed`, bridging the same Signal-first {@link liveEntities}
 * (live subscription + hydration) into Vue's reactivity via `shallowRef` +
 * `onScopeDispose`. Shipped under `trellis/vue/typed`.
 *
 *   import { defineType } from 'trellis/schema';
 *   import { useEntities, useMutation } from 'trellis/vue/typed';
 *
 *   const sections = useEntities(client, NavSection);   // ComputedRef<{ data, loading, error }>
 *   const nav = useMutation(client, NavSection);
 *
 * @module trellis/vue/typed
 */
import { computed, onScopeDispose, shallowRef, type ComputedRef, type Ref } from 'vue';
import {
  liveEntities,
  liveEntity,
  type LiveEntitiesOptions,
  type LiveEntityOptions,
  type ReadState,
} from '../client/live.js';
import type { EntityData, TrellisDb } from '../client/sdk.js';
import { entityMutations, type EntityMutations } from '../schema/mutations.js';
import type {
  AnyType,
  InferEntitiesRead,
  InferEntityRead,
  InferType,
  ResolveSpecFor,
} from '../schema/define.js';
import type { WhereInput } from '../schema/eql.js';

export interface TypedRead<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

export type TypedReadOptions<S extends AnyType> = LiveEntitiesOptions & {
  where?: WhereInput;
  resolve?: ResolveSpecFor<S>;
};

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

function useLive(
  client: TrellisDb,
  schema: AnyType,
  opts?: LiveEntitiesOptions,
): Ref<ReadState<EntityData[]>> {
  const res = liveEntities(client, schema, opts);
  const state = shallowRef<ReadState<EntityData[]>>(res.signal.peek());
  const off = res.signal.subscribe((v) => {
    state.value = v;
  });
  const stop = res.start();
  onScopeDispose(() => {
    off();
    stop();
  });
  return state;
}

/** Live list of a type — filter with `where`, expand relations with `resolve`. */
export function useEntities<
  S extends AnyType,
  O extends Partial<InferType<S>> | TypedReadOptions<S> | undefined = undefined,
>(
  client: TrellisDb,
  schema: S,
  opts?: O,
): ComputedRef<TypedRead<InferEntitiesRead<S, O>>> {
  const state = useLive(client, schema, parseReadOptions(opts));
  return computed(() => ({
    data: state.value.data as unknown as InferEntitiesRead<S, O>,
    loading: state.value.loading,
    error: state.value.error,
  }));
}

/** Live single entity by id — read-first, then type subscription. */
export function useEntity<
  S extends AnyType,
  O extends TypedEntityOptions<S> | undefined = undefined,
>(
  client: TrellisDb,
  schema: S,
  id: string | null | undefined,
  opts?: O,
): ComputedRef<TypedRead<InferEntityRead<S, O>>> {
  const res = liveEntity(client, schema, id, opts);
  const state = shallowRef(res.signal.peek());
  const off = res.signal.subscribe((v) => {
    state.value = v;
  });
  const stop = res.start();
  onScopeDispose(() => {
    off();
    stop();
  });
  return computed(() => ({
    data: state.value.data as unknown as InferEntityRead<S, O>,
    loading: state.value.loading,
    error: state.value.error,
  }));
}

/** Schema-typed create/update/remove. */
export function useMutation<S extends AnyType>(
  client: TrellisDb,
  schema: S,
): EntityMutations<InferType<S>> {
  return entityMutations(client, schema);
}
