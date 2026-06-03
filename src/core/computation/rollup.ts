/**
 * Ontology rollup evaluation — aggregates over graph links or join-entities.
 */

import type { EAVStore, Atom } from '../store/eav-store.js';
import type {
  PropertyValueSpecification,
  RollupConfig,
  SchemaDefinition,
} from '../ontology/types.js';

export interface RollupEvalContext {
  store: EAVStore;
  entityId: string;
  schema?: SchemaDefinition;
  getEntityType?: (entityId: string) => string | undefined;
}

/** Collect related entity ids for a rollup field. */
export function collectRollupRelatedIds(
  rollup: RollupConfig,
  ctx: RollupEvalContext,
): string[] {
  if (rollup.joinEntity) {
    const { type, foreignKey } = rollup.joinEntity;
    const facts = ctx.store.getFactsByAttribute(foreignKey);
    const ids: string[] = [];
    for (const fact of facts) {
      if (fact.v !== ctx.entityId) continue;
      const typeFacts = ctx.store.getFactsByEntity(fact.e);
      const entityType = typeFacts.find((f) => f.a === 'type')?.v;
      if (entityType === type) ids.push(fact.e);
    }
    return ids;
  }

  const linkAttr = resolveLinkAttribute(rollup.relationProperty, ctx.schema);
  const links = ctx.store.getLinksByEntityAndAttribute(ctx.entityId, linkAttr);
  if (links.length > 0) return links.map((l) => l.e2);

  return [];
}

function resolveLinkAttribute(
  relationProperty: string,
  schema?: SchemaDefinition,
): string {
  const field = schema?.fields.find((f) => f.name === relationProperty);
  if (field?.valueType === 'relation') return relationProperty;
  return relationProperty;
}

function readTargetValue(
  store: EAVStore,
  entityId: string,
  targetProperty: string,
): Atom | undefined {
  if (targetProperty === 'id') return entityId;
  const facts = store.getFactsByEntity(entityId);
  return facts.find((f) => f.a === targetProperty)?.v;
}

function toNumbers(values: Atom[]): number[] {
  const nums: number[] = [];
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
  }
  return nums;
}

export function evaluateRollup(
  rollup: RollupConfig,
  ctx: RollupEvalContext,
): Atom {
  const related = collectRollupRelatedIds(rollup, ctx);

  if (rollup.aggregation === 'count') {
    return related.length;
  }

  const values = related
    .map((id) => readTargetValue(ctx.store, id, rollup.targetProperty))
    .filter((v): v is Atom => v !== undefined);

  const nums = toNumbers(values);
  if (nums.length === 0) return 0;

  switch (rollup.aggregation) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
    case 'median': {
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1]! + sorted[mid]!) / 2
        : sorted[mid]!;
    }
    case 'mode': {
      const freq = new Map<number, number>();
      for (const n of nums) freq.set(n, (freq.get(n) ?? 0) + 1);
      let best = nums[0]!;
      let bestCount = 0;
      for (const [n, c] of freq) {
        if (c > bestCount) {
          best = n;
          bestCount = c;
        }
      }
      return best;
    }
    default:
      return 0;
  }
}

/** Project ontology relation fields from graph links onto a binding row. */
export function projectRelationFields(
  binding: Record<string, Atom>,
  schema: SchemaDefinition,
  store: EAVStore,
  entityId: string,
): void {
  for (const field of schema.fields) {
    if (field.valueType !== 'relation' || field.name in binding) continue;

    const links = store.getLinksByEntityAndAttribute(entityId, field.name);
    if (links.length === 0) continue;

    const cardinality = field.relation?.cardinality ?? 'many';
    if (cardinality === 'one') {
      binding[field.name] = links[0]!.e2;
    } else {
      binding[field.name] = links.map((l) => l.e2).join(',');
    }
  }
}

export function findRollupField(
  schema: SchemaDefinition,
  name: string,
): PropertyValueSpecification | undefined {
  return schema.fields.find((f) => f.name === name && f.rollup);
}
