/**
 * Trellis Svelte — schema-typed, live entity stores.
 *
 * The Svelte half of the typed read surface. Like the realtime adapter, it takes
 * no dependency on the `svelte` package — it returns the structural store
 * contract (`subscribe(run) => unsubscribe`), so `$entities` works in markup. The
 * store is lazy: the first subscriber opens the {@link liveEntities} subscription
 * (live + hydrated) and the last to unsubscribe disposes it. Shipped under
 * `trellis/svelte/typed`.
 *
 *   import { defineType } from 'trellis/schema';
 *   import { entitiesStore, mutations } from 'trellis/svelte/typed';
 *
 *   const sections = entitiesStore(client, NavSection); // {#each $sections.data as s}…
 *
 * @module trellis/svelte/typed
 */
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

/** Minimal Svelte store contract (a structural subset of `svelte/store`'s `Readable`). */
export interface Readable<T> {
  subscribe(run: (value: T) => void): () => void;
}

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

function bindLiveResource<T, R>(
  create: () => { signal: { subscribe(fn: (v: ReadState<T>) => void): () => void }; start(): () => void },
  project: (state: ReadState<T>) => R,
): Readable<R> {
  const res = create();
  let stop: (() => void) | null = null;
  let count = 0;
  return {
    subscribe(run: (value: R) => void): () => void {
      if (count++ === 0) stop = res.start();
      const off = res.signal.subscribe((v) => run(project(v)));
      return () => {
        off();
        if (--count === 0) {
          stop?.();
          stop = null;
        }
      };
    },
  };
}

function liveListStore<R>(
  client: TrellisDb,
  schema: AnyType,
  opts: LiveEntitiesOptions | undefined,
  project: (state: ReadState<EntityData[]>) => R,
): Readable<R> {
  return bindLiveResource(
    () => liveEntities(client, schema, opts),
    project,
  );
}

/** Live list of a type as a Svelte store. */
export function entitiesStore<
  S extends AnyType,
  O extends Partial<InferType<S>> | TypedReadOptions<S> | undefined = undefined,
>(
  client: TrellisDb,
  schema: S,
  opts?: O,
): Readable<TypedRead<InferEntitiesRead<S, O>>> {
  return liveListStore(
    client,
    schema,
    parseReadOptions(opts),
    (v) => ({
      data: v.data as unknown as InferEntitiesRead<S, O>,
      loading: v.loading,
      error: v.error,
    }),
  );
}

/** Live single entity by id as a Svelte store — read-first, then type subscription. */
export function entityStore<
  S extends AnyType,
  O extends TypedEntityOptions<S> | undefined = undefined,
>(
  client: TrellisDb,
  schema: S,
  id: string | null | undefined,
  opts?: O,
): Readable<TypedRead<InferEntityRead<S, O>>> {
  return bindLiveResource(
    () => liveEntity(client, schema, id, opts),
    (v) => ({
      data: v.data as unknown as InferEntityRead<S, O>,
      loading: v.loading,
      error: v.error,
    }),
  );
}

/** Schema-typed create/update/remove. */
export function mutations<S extends AnyType>(
  client: TrellisDb,
  schema: S,
): EntityMutations<InferType<S>> {
  return entityMutations(client, schema);
}
