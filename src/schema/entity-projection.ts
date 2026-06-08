/**
 * Entity projection — sparse EQL bindings ↔ plain entity records.
 *
 * Shared by the realtime subscription path (server hydrates before push) and
 * the client read layer (skips `read()` when rows are already full entities).
 *
 * @module trellis/schema
 */
import type { EntityData } from '../client/sdk.js';

/** Minimal kernel surface for hydration. */
export interface EntityReader {
  getEntity(id: string): EntityRecordLike | null;
}

export interface EntityRecordLike {
  id: string;
  type: string;
  facts: Array<{ a: string; v: unknown }>;
}

export function entityRecordToPlain(entity: EntityRecordLike): EntityData {
  const obj: EntityData = { id: entity.id, type: entity.type };
  for (const f of entity.facts) {
    if (f.a !== 'type') obj[f.a] = f.v;
  }
  return obj;
}

/** Extract an entity id from a query binding row. */
export function bindingEntityId(row: Record<string, unknown>): string | null {
  const id = row.id ?? row.e ?? row['?e'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** True when the row is a sparse `{ e: id }` trigger, not a hydrated entity. */
export function isSparseBinding(row: Record<string, unknown>): boolean {
  const id = bindingEntityId(row);
  if (!id) return false;
  return typeof row.type !== 'string';
}

/** Normalize a binding row to {@link EntityData} (hydrated or sparse+partial). */
export function bindingToEntity(row: Record<string, unknown>): EntityData {
  const id = bindingEntityId(row);
  if (id && typeof row.type === 'string') {
    return { ...row, id, type: row.type } as EntityData;
  }
  if (id) return { id, type: String(row.type ?? ''), ...row };
  return row as EntityData;
}

/**
 * Hydrate sparse subscription bindings to full entity records via the kernel.
 * Already-hydrated rows pass through unchanged.
 */
export function hydrateBindings(
  kernel: EntityReader,
  bindings: Record<string, unknown>[],
): EntityData[] {
  return bindings.map((row) => {
    if (!isSparseBinding(row)) return bindingToEntity(row);
    const id = bindingEntityId(row)!;
    const entity = kernel.getEntity(id);
    return entity ? entityRecordToPlain(entity) : bindingToEntity(row);
  });
}
