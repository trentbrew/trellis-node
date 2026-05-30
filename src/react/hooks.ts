/**
 * Trellis React — Hooks
 *
 * Reactive hooks that wrap the TrellisClient SDK with automatic
 * WebSocket subscriptions for live updates.
 *
 * @module trellis/react
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTrellis } from './provider.js';
import type { EntityData, ListResult } from '../client/sdk.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// useEntity — fetch a single entity by ID, auto-refresh via polling
// ---------------------------------------------------------------------------

export interface UseEntityOptions {
  /** Polling interval in ms for live updates (default: off). */
  pollInterval?: number;
}

export interface UseEntityResult<
  T extends EntityData = EntityData,
> extends AsyncState<T | null> {
  refetch: () => Promise<void>;
}

/**
 * Fetch and watch a single entity by ID.
 *
 * ```tsx
 * const { data: note, loading } = useEntity<Note>(noteId);
 * ```
 */
export function useEntity<T extends EntityData = EntityData>(
  id: string | null | undefined,
  options: UseEntityOptions = {},
): UseEntityResult<T> {
  const client = useTrellis();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    if (!id) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const entity = await client.read<T>(id);
      setData(entity);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, id]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    if (!options.pollInterval || !id) return;
    const interval = setInterval(fetch, options.pollInterval);
    return () => clearInterval(interval);
  }, [fetch, options.pollInterval, id]);

  return { data, loading, error, refetch: fetch };
}

// ---------------------------------------------------------------------------
// useEntities — list entities with live subscription
// ---------------------------------------------------------------------------

export interface UseEntitiesOptions {
  /** Entity type filter. */
  type?: string;
  /** Max results. */
  limit?: number;
  /** Offset for pagination. */
  offset?: number;
  /** Polling interval in ms (default: off). */
  pollInterval?: number;
}

export interface UseEntitiesResult<
  T extends EntityData = EntityData,
> extends AsyncState<T[]> {
  total: number;
  refetch: () => Promise<void>;
}

/**
 * List and watch entities by type.
 *
 * ```tsx
 * const { data: notes, total, loading } = useEntities<Note>({ type: 'Note', limit: 20 });
 * ```
 */
export function useEntities<T extends EntityData = EntityData>(
  options: UseEntitiesOptions = {},
): UseEntitiesResult<T> {
  const client = useTrellis();
  const [data, setData] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const optsRef = useRef(options);
  optsRef.current = options;

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const result: ListResult<T> = await client.list<T>(optsRef.current.type, {
        limit: optsRef.current.limit,
        offset: optsRef.current.offset,
      });
      setData(result.data);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, options.type, options.limit, options.offset]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    if (!options.pollInterval) return;
    const interval = setInterval(fetch, options.pollInterval);
    return () => clearInterval(interval);
  }, [fetch, options.pollInterval]);

  return { data, total, loading, error, refetch: fetch };
}

// ---------------------------------------------------------------------------
// useQuery — live EQL-S query via WebSocket subscription
// ---------------------------------------------------------------------------

export interface UseQueryOptions {
  /** If false, the query will not execute. Useful for conditional queries. */
  enabled?: boolean;
}

export interface UseQueryResult<T = Record<string, unknown>> extends AsyncState<
  T[]
> {
  refetch: () => Promise<void>;
}

/**
 * Subscribe to a live EQL-S query. Results auto-update via WebSocket.
 *
 * ```tsx
 * const { data: pinned } = useQuery<Note>('find Note where pinned = "true"');
 * ```
 */
export function useQuery<T = Record<string, unknown>>(
  eql: string,
  options: UseQueryOptions = {},
): UseQueryResult<T> {
  const client = useTrellis();
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const enabled = options.enabled !== false;

  const refetch = useCallback(async () => {
    if (!enabled || !eql.trim()) return;
    try {
      setLoading(true);
      const result = await client.query(eql);
      setData(result.bindings as T[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, eql, enabled]);

  // Subscribe via WebSocket for live updates
  useEffect(() => {
    if (!enabled || !eql.trim()) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const sub = client.subscribe<T>(eql, (result: T[]) => {
      setData(result);
      setLoading(false);
      setError(null);
    });

    return () => {
      sub.unsubscribe();
    };
  }, [client, eql, enabled]);

  return { data, loading, error, refetch };
}

// ---------------------------------------------------------------------------
// useMutation — CRUD operations with loading/error state
// ---------------------------------------------------------------------------

export interface UseMutationResult {
  /** Create a new entity. Returns the entity ID. */
  create: (
    type: string,
    attributes?: Record<string, unknown>,
  ) => Promise<string>;
  /** Update an entity's attributes. */
  update: (id: string, attributes: Record<string, unknown>) => Promise<void>;
  /** Delete an entity by ID. */
  remove: (id: string) => Promise<void>;
  /** Whether a mutation is in progress. */
  loading: boolean;
  /** Last mutation error, if any. */
  error: Error | null;
}

/**
 * CRUD mutation operations with loading/error state tracking.
 *
 * ```tsx
 * const { create, update, remove, loading } = useMutation();
 * const id = await create('Note', { title: 'Hello' });
 * ```
 */
export function useMutation(): UseMutationResult {
  const client = useTrellis();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }

  const create = useCallback(
    (type: string, attributes: Record<string, unknown> = {}): Promise<string> =>
      run(() => client.create(type, attributes)),
    [client],
  );

  const update = useCallback(
    (id: string, attributes: Record<string, unknown>): Promise<void> =>
      run(() => client.update(id, attributes)),
    [client],
  );

  const remove = useCallback(
    (id: string): Promise<void> => run(() => client.delete(id)),
    [client],
  );

  return { create, update, remove, loading, error };
}
