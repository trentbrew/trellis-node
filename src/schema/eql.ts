/**
 * EQL-S query builders shared by every typed read adapter (React/Vue/Svelte).
 *
 * Centralised so the (currently naive) string interpolation has one home — the
 * follow-up to parameterised queries lands here, not in three places.
 *
 * Note on shape: EQL-S `find ?e where …` binds the entity *variable*, so a live
 * subscription returns sparse rows (`{ e: "<id>" }`), and `id` is not itself a
 * queryable attribute — entities are matched by their `type` fact. The typed
 * read layer hydrates those ids via `client.read` (see `liveEntities`).
 *
 * @module trellis/schema
 */

/** Escape a value for inclusion in a double-quoted EQL literal. */
export function escapeValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * `find ?e where type = "<Type>" [and <k> = "<v>" …]` — all entities of a type,
 * optionally narrowed by equality on string attributes (ANDed).
 */
export function entitiesQuery(
  type: string,
  where?: Record<string, unknown>,
): string {
  const conds = [`type = "${escapeValue(type)}"`];
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined || v === null) continue;
    conds.push(`${k} = "${escapeValue(String(v))}"`);
  }
  return `find ?e where ${conds.join(' and ')}`;
}
