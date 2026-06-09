/**
 * Trellis Live Reads — Signal-first reactive queries.
 *
 * `liveQuery` is the framework-agnostic read primitive: it returns a {@link Signal}
 * of read-state that the React/Vue/Svelte adapters all wrap, so the subscription
 * is implemented once. It is lazy — `start()` opens the underlying source and
 * returns a disposer — which lets adapters bind start/stop to component lifetime
 * without side effects during render.
 *
 * Source today: the remote WebSocket subscription (`TrellisDb.subscribe`). The
 * local embedded-kernel path is NOT live yet (`subscribe()` throws in local mode);
 * a kernel op-stream source is the seam for that and is surfaced here as an error
 * state rather than a throw.
 *
 * @module trellis/client
 */
import { Signal } from './reactive.js';
import {
  bindingEntityId,
  bindingToEntity,
  isSparseBinding,
} from '../schema/entity-projection.js';
import { entitiesQuery, entityQuery, type WhereInput } from '../schema/eql.js';
import { resolveRelations, type ResolveSpec } from '../schema/resolve.js';
import type { AnyType } from '../schema/define.js';
import type { EntityData, Subscription, TrellisDb } from './sdk.js';

export interface ReadState<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

export interface LiveResource<T> {
  /** Reactive read-state. Subscribe via any framework adapter (or `.subscribe`). */
  readonly signal: Signal<ReadState<T>>;
  /** Open the subscription. Idempotent. Returns a disposer. */
  start(): () => void;
}

/**
 * Subscribe to a live EQL-S query as a {@link Signal}. The returned resource is
 * inert until `start()` is called.
 */
export function liveQuery<T = Record<string, unknown>>(
  client: TrellisDb,
  eql: string,
): LiveResource<T[]> {
  const signal = new Signal<ReadState<T[]>>({
    data: [],
    loading: true,
    error: null,
  });
  let sub: Subscription | null = null;

  return {
    signal,
    start() {
      if (sub) return () => stop();
      try {
        sub = client.subscribe<T>(eql, (rows) => {
          signal.value = { data: rows, loading: false, error: null };
        });
      } catch (err) {
        // e.g. local mode: `subscribe() requires remote mode`. Surface, don't throw.
        signal.value = {
          data: [],
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
      return () => stop();
    },
  };

  function stop(): void {
    sub?.unsubscribe();
    sub = null;
  }
}

export interface LiveEntitiesOptions {
  where?: WhereInput;
  /** Expand declared relations after hydration (requires `schema`). */
  resolve?: ResolveSpec;
}

export interface LiveEntityOptions {
  /** Expand declared relations on the loaded row (requires `schema`). */
  resolve?: ResolveSpec;
}

function normalizeLiveEntitiesOpts(
  whereOrOpts?: Record<string, unknown> | LiveEntitiesOptions,
): LiveEntitiesOptions {
  if (!whereOrOpts) return {};
  if ('resolve' in whereOrOpts || 'where' in whereOrOpts) {
    return whereOrOpts as LiveEntitiesOptions;
  }
  return { where: whereOrOpts as Record<string, unknown> };
}

/**
 * Live, *hydrated* entity list for a type.
 *
 * Remote subscriptions are server-hydrated to full entity records when possible.
 * When `resolve` is set, the server expands relations on the wire (TRL-6) and
 * the client skips a second resolve pass. Stale hydrations are dropped if a
 * newer push arrives first.
 *
 * Pass a {@link AnyType} schema (or `resolve` in options) to expand relations
 * in one batched pass — e.g. `NavSection` with `{ resolve: { items: true } }`
 * loads all `NavItem` rows grouped by `section`, avoiding per-parent reads.
 */
export function liveEntities<T extends EntityData = EntityData>(
  client: TrellisDb,
  typeOrSchema: string | AnyType,
  whereOrOpts?: Record<string, unknown> | LiveEntitiesOptions,
): LiveResource<T[]> {
  const schema =
    typeof typeOrSchema === 'string' ? undefined : typeOrSchema;
  const type = typeof typeOrSchema === 'string' ? typeOrSchema : typeOrSchema.type;
  const { where, resolve } = normalizeLiveEntitiesOpts(whereOrOpts);

  const signal = new Signal<ReadState<T[]>>({
    data: [],
    loading: true,
    error: null,
  });
  let sub: Subscription | null = null;
  let token = 0;

  return {
    signal,
    start() {
      if (sub) return () => stop();
      try {
        const serverResolve =
          schema && resolve && Object.keys(resolve).length > 0;

        sub = client.subscribe<Record<string, unknown>>(
          entitiesQuery(type, where),
          (rows, _diff, meta) => {
            const turn = ++token;
            const hydrate = async (): Promise<EntityData[]> =>
              hydrateSubscriptionRows(client, rows, meta);

            hydrate()
              .then(async (entities) => {
                if (turn !== token) return;
                let data = entities as T[];
                if (
                  schema &&
                  resolve &&
                  Object.keys(resolve).length > 0 &&
                  !meta?.resolved
                ) {
                  data = (await resolveRelations(
                    client,
                    schema,
                    data,
                    resolve,
                  )) as T[];
                }
                if (turn !== token) return;
                signal.value = { data, loading: false, error: null };
              })
              .catch((err: unknown) => {
                if (turn !== token) return;
                signal.value = {
                  data: signal.peek().data,
                  loading: false,
                  error: err instanceof Error ? err : new Error(String(err)),
                };
              });
          },
          serverResolve
            ? { entityType: type, resolve }
            : undefined,
        );
      } catch (err) {
        signal.value = {
          data: [],
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
      return () => stop();
    },
  };

  function stop(): void {
    token++; // invalidate any in-flight hydration
    sub?.unsubscribe();
    sub = null;
  }
}

async function hydrateSubscriptionRows(
  client: TrellisDb,
  rows: Record<string, unknown>[],
  meta?: { resolved?: boolean },
): Promise<EntityData[]> {
  if (rows.length === 0) return [];
  if (meta?.resolved) return rows as EntityData[];
  if (rows.some((r) => isSparseBinding(r))) {
    const ids = rows
      .map((r) => bindingEntityId(r))
      .filter((id): id is string => Boolean(id));
    const loaded = await Promise.all(ids.map((id) => client.read(id)));
    return loaded.filter((e): e is EntityData => e != null);
  }
  return rows.map((r) => bindingToEntity(r));
}

async function pickEntityFromRows(
  client: TrellisDb,
  rows: Record<string, unknown>[],
  entityId: string,
  meta?: { resolved?: boolean },
): Promise<EntityData | null> {
  const hydrated = await hydrateSubscriptionRows(client, rows, meta);
  const hit = hydrated.find((r) => r.id === entityId);
  if (hit) return hit;
  if (hydrated.length === 0) return client.read(entityId);
  return null;
}

/**
 * Live single entity by id (TRL-9).
 *
 * Opens with a direct `read(id)` for fast first paint, then keeps the row fresh
 * via an id-scoped subscription ({@link entityQuery}) — not a full-type scan.
 */
export function liveEntity<T extends EntityData = EntityData>(
  client: TrellisDb,
  typeOrSchema: string | AnyType,
  id: string | null | undefined,
  opts?: LiveEntityOptions,
): LiveResource<T | null> {
  const schema =
    typeof typeOrSchema === 'string' ? undefined : typeOrSchema;
  const type = typeof typeOrSchema === 'string' ? typeOrSchema : typeOrSchema.type;
  const { resolve } = opts ?? {};

  const signal = new Signal<ReadState<T | null>>({
    data: null,
    loading: Boolean(id),
    error: null,
  });
  let sub: Subscription | null = null;
  let token = 0;

  return {
    signal,
    start() {
      if (!id) {
        signal.value = { data: null, loading: false, error: null };
        return () => {};
      }
      if (sub) return () => stop();

      const entityId = id;
      const serverResolve =
        Boolean(schema) && Boolean(resolve && Object.keys(resolve).length > 0);

      const applyRow = async (
        row: EntityData | null,
        turn: number,
      ): Promise<void> => {
        if (turn !== token) return;
        if (!row) {
          signal.value = { data: null, loading: false, error: null };
          return;
        }
        let data = row;
        if (
          schema &&
          resolve &&
          Object.keys(resolve).length > 0 &&
          !serverResolve
        ) {
          const [resolved] = await resolveRelations(client, schema, [data], resolve);
          data = resolved ?? data;
        }
        if (turn !== token) return;
        signal.value = { data: data as T, loading: false, error: null };
      };

      const readGen = token;
      client
        .read(entityId)
        .then((row) => applyRow(row, readGen))
        .catch((err: unknown) => {
          signal.value = {
            data: signal.peek().data,
            loading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          };
        });

      try {
        sub = client.subscribe<Record<string, unknown>>(
          entityQuery(type, entityId),
          (rows, _diff, meta) => {
            const turn = ++token;
            pickEntityFromRows(client, rows, entityId, meta)
              .then((row) => applyRow(row, turn))
              .catch((err: unknown) => {
                if (turn !== token) return;
                signal.value = {
                  data: signal.peek().data,
                  loading: false,
                  error: err instanceof Error ? err : new Error(String(err)),
                };
              });
          },
          serverResolve
            ? { entityType: type, resolve }
            : undefined,
        );
      } catch (err) {
        signal.value = {
          data: null,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }

      return () => stop();
    },
  };

  function stop(): void {
    token++;
    sub?.unsubscribe();
    sub = null;
  }
}
