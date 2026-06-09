/**
 * EQL-S query builders shared by every typed read adapter (React/Vue/Svelte).
 *
 * Centralised so filter encoding has one home — typed reads, live subscriptions,
 * and HTTP `/query` all share the same `find ?e where …` shape.
 *
 * @module trellis/schema
 */

/** Escape a value for inclusion in a double-quoted EQL literal. */
export function escapeValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Comparison operators supported by {@link parseSimple}. */
export type WhereOp =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'contains'
  | 'startsWith'
  | 'endsWith';

/** Structured filter for one attribute (TRL-7). */
export type WhereFilter = {
  eq?: unknown;
  ne?: unknown;
  lt?: number | string;
  lte?: number | string;
  gt?: number | string;
  gte?: number | string;
  contains?: string;
  startsWith?: string;
  endsWith?: string;
};

/** Equality shorthand or a {@link WhereFilter} object. */
export type WhereValue = unknown | WhereFilter;

const WHERE_OP_TO_EQL: Record<WhereOp, string> = {
  eq: '=',
  ne: '!=',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
  contains: 'contains',
  startsWith: 'startsWith',
  endsWith: 'endsWith',
};

export function isWhereFilter(value: unknown): value is WhereFilter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return (Object.keys(WHERE_OP_TO_EQL) as WhereOp[]).some(
    (op) => (value as WhereFilter)[op] !== undefined,
  );
}

/** Format a JS value as an EQL-S literal (quoted string, bare number, or boolean). */
export function formatEqlLiteral(value: unknown): string {
  if (typeof value === 'string') return `"${escapeValue(value)}"`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value === null || value === undefined) {
    throw new Error('Cannot format null/undefined as an EQL literal');
  }
  return `"${escapeValue(String(value))}"`;
}

/**
 * One `attr op value` fragment for `find ?e where …`.
 * Throws when a filter object specifies more than one operator.
 */
export function whereCondition(attr: string, value: WhereValue): string {
  if (isWhereFilter(value)) {
    const ops = (Object.keys(WHERE_OP_TO_EQL) as WhereOp[]).filter(
      (op) => value[op] !== undefined,
    );
    if (ops.length === 0) {
      throw new Error(`Empty where filter for attribute "${attr}"`);
    }
    if (ops.length > 1) {
      throw new Error(
        `Where filter for "${attr}" must specify one operator, got: ${ops.join(', ')}`,
      );
    }
    const op = ops[0]!;
    return `${attr} ${WHERE_OP_TO_EQL[op]} ${formatEqlLiteral(value[op])}`;
  }
  return `${attr} = ${formatEqlLiteral(value)}`;
}

export type WhereInput = Record<string, WhereValue>;

/**
 * `find ?e where type = "<Type>" [and <k> <op> <v> …]` — entities of a type,
 * optionally narrowed by attribute filters (ANDed).
 */
export function entitiesQuery(type: string, where?: WhereInput): string {
  const conds = [`type = "${escapeValue(type)}"`];
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined || v === null) continue;
    conds.push(whereCondition(k, v));
  }
  return `find ?e where ${conds.join(' and ')}`;
}

/**
 * Single-entity live subscription query (TRL-9).
 * Narrows the type pattern to one entity id — avoids full-type fan-out on the wire.
 */
export function entityQuery(type: string, entityId: string): string {
  const t = formatEqlLiteral(type);
  const id = formatEqlLiteral(entityId);
  return `SELECT ?e\nWHERE {\n  [?e "type" ${t}]\n}\nFILTER ?e = ${id}`;
}
