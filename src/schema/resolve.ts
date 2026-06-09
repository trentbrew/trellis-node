/**
 * Relation resolution for typed live reads.
 *
 * After entities are hydrated, `resolve` expands relation fields in one batched
 * pass instead of per-row subscriptions. Supports:
 *
 *   - **Forward `one`** — relation stored as a target id on the entity (read once).
 *   - **Reverse `many`** — children point back via a foreign-key attribute
 *     (e.g. `NavItem.section` → `NavSection.items`); one child-type query + group.
 *
 * @module trellis/schema
 */
import { bindingEntityId } from './entity-projection.js';
import { entitiesQuery } from './eql.js';
import type { AnyType, Relation } from './define.js';
import type { EntityData, TrellisDb } from '../client/sdk.js';

/** Read/query surface used by relation expansion (client or in-process kernel). */
export type RelationResolveClient = Pick<TrellisDb, 'read' | 'query'>;

/**
 * Runtime resolve map (loose keys). For static types use
 * {@link import('./define.js').ResolveSpecFor}.
 */
export type ResolveSpec = {
  [key: string]: boolean | ResolveSpec | undefined;
};

function isNestedResolveSpec(
  v: boolean | ResolveSpec | undefined,
): v is ResolveSpec {
  return typeof v === 'object' && v !== null;
}

function relationTargetName(r: Relation<AnyType, 'one' | 'many'>): string {
  return typeof r.target === 'string' ? r.target : r.target().type;
}

function relationTargetSchema(
  r: Relation<AnyType, 'one' | 'many'>,
  schemaLookup?: (typeName: string) => AnyType | null,
): AnyType | null {
  if (typeof r.target !== 'string') return r.target();
  return schemaLookup?.(r.target) ?? null;
}

/** Child attribute pointing at `parent` (inverse of a `many` relation). */
export function inverseForeignKey(
  parent: AnyType,
  relationName: string,
  child: AnyType,
): string | null {
  for (const [key, r] of Object.entries(child.relations)) {
    if (relationTargetName(r) === parent.type) return key;
  }
  return null;
}

async function loadByIds(
  client: RelationResolveClient,
  ids: string[],
  cache: Map<string, EntityData | null>,
): Promise<void> {
  const missing = ids.filter((id) => !cache.has(id));
  if (missing.length === 0) return;
  await Promise.all(
    missing.map(async (id) => {
      cache.set(id, await client.read(id));
    }),
  );
}

async function resolveReverseMany(
  client: RelationResolveClient,
  parent: AnyType,
  relationName: string,
  parents: EntityData[],
  cache: Map<string, EntityData | null>,
  schemaLookup?: (typeName: string) => AnyType | null,
): Promise<void> {
  const rel = parent.relations[relationName];
  if (!rel || rel.cardinality !== 'many') return;

  const childSchema = relationTargetSchema(rel, schemaLookup);
  if (!childSchema) return;

  const foreignKey = inverseForeignKey(parent, relationName, childSchema);
  if (!foreignKey) return;

  const parentIds = new Set(parents.map((p) => p.id));
  const qr = await client.query(entitiesQuery(childSchema.type));
  const childIds = qr.bindings
    .map((b) => bindingEntityId(b as Record<string, unknown>))
    .filter((id): id is string => Boolean(id));

  await loadByIds(client, childIds, cache);

  const grouped = new Map<string, EntityData[]>();
  for (const id of childIds) {
    const child = cache.get(id);
    if (!child) continue;
    const fk = child[foreignKey];
    if (typeof fk !== 'string' || !parentIds.has(fk)) continue;
    if (!grouped.has(fk)) grouped.set(fk, []);
    grouped.get(fk)!.push(child);
  }

  for (const row of parents) {
    (row as Record<string, unknown>)[relationName] = grouped.get(row.id) ?? [];
  }
}

async function resolveForwardOne(
  client: RelationResolveClient,
  parents: EntityData[],
  relationName: string,
  cache: Map<string, EntityData | null>,
): Promise<void> {
  const ids = parents
    .map((p) => p[relationName])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);

  await loadByIds(client, ids, cache);

  for (const row of parents) {
    const ref = row[relationName];
    if (typeof ref !== 'string') continue;
    const loaded = cache.get(ref);
    if (loaded) (row as Record<string, unknown>)[relationName] = loaded;
  }
}

/**
 * Expand `resolve` relation keys on hydrated entities. Mutates rows in place.
 */
export async function resolveRelations(
  client: RelationResolveClient,
  schema: AnyType,
  entities: EntityData[],
  spec: ResolveSpec,
  opts?: { copy?: boolean; schemaLookup?: (typeName: string) => AnyType | null },
): Promise<EntityData[]> {
  if (entities.length === 0 || Object.keys(spec).length === 0) return entities;

  const cache = new Map<string, EntityData | null>();
  const rows =
    opts?.copy === false ? entities : entities.map((e) => ({ ...e }));

  for (const [name, enabled] of Object.entries(spec)) {
    if (!enabled) continue;
    const rel = schema.relations[name];
    if (!rel) continue;

    if (rel.cardinality === 'many') {
      await resolveReverseMany(
        client,
        schema,
        name,
        rows,
        cache,
        opts?.schemaLookup,
      );
      if (isNestedResolveSpec(enabled)) {
        const childSchema = relationTargetSchema(rel, opts?.schemaLookup);
        if (childSchema) {
          for (const row of rows) {
            const kids = (row as Record<string, unknown>)[name] as
              | EntityData[]
              | undefined;
            if (kids?.length) {
              await resolveRelations(client, childSchema, kids, enabled, {
                copy: false,
                schemaLookup: opts?.schemaLookup,
              });
            }
          }
        }
      }
    } else if (isNestedResolveSpec(enabled)) {
      await resolveForwardOne(client, rows, name, cache);
      const childSchema = relationTargetSchema(rel, opts?.schemaLookup);
      if (childSchema) {
        const nested: EntityData[] = [];
        for (const row of rows) {
          const loaded = (row as Record<string, unknown>)[name];
          if (loaded && typeof loaded === 'object' && 'id' in loaded) {
            nested.push(loaded as EntityData);
          }
        }
        if (nested.length) {
          await resolveRelations(client, childSchema, nested, enabled, {
            copy: false,
            schemaLookup: opts?.schemaLookup,
          });
        }
      }
    } else {
      await resolveForwardOne(client, rows, name, cache);
    }
  }

  return rows;
}
