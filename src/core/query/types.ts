/**
 * EQL-S Query Types — Entity Query Language (Structured)
 *
 * Defines the AST for structured queries over the EAV store.
 * Queries are composed of patterns (fact/link clauses) that bind
 * variables, plus optional filters, aggregations, and projections.
 *
 * @module trellis/core/query
 */

import type { Atom } from '../store/eav-store.js';

// ---------------------------------------------------------------------------
// Variables & Terms
// ---------------------------------------------------------------------------

/**
 * A query variable, prefixed with `?` in the DSL.
 * e.g. `?e`, `?name`, `?type`
 */
export interface Variable {
  kind: 'variable';
  name: string;
}

/**
 * A literal constant value.
 */
export interface Literal {
  kind: 'literal';
  value: Atom;
}

/**
 * A term is either a variable or a literal.
 */
export type Term = Variable | Literal;

// ---------------------------------------------------------------------------
// Patterns (clauses)
// ---------------------------------------------------------------------------

/**
 * A fact pattern matches triples (e, a, v) in the EAV store.
 *
 * Example DSL: `[?e "type" "Project"]` or `[?e ?attr ?val]`
 */
export interface FactPattern {
  kind: 'fact';
  entity: Term;
  attribute: Term;
  value: Term;
}

/**
 * A link pattern matches links (e1, a, e2) in the graph.
 *
 * Example DSL: `(?src "memberOf" ?tgt)`
 */
export interface LinkPattern {
  kind: 'link';
  source: Term;
  attribute: Term;
  target: Term;
}

/**
 * A negation pattern — succeeds when the inner pattern has NO matches.
 */
export interface NotPattern {
  kind: 'not';
  pattern: Pattern;
}

/**
 * An or-pattern — succeeds when ANY branch matches.
 */
export interface OrPattern {
  kind: 'or';
  branches: Pattern[][];
}

/**
 * A rule application — invoke a named Datalog rule.
 */
export interface RuleApplication {
  kind: 'rule';
  name: string;
  args: Term[];
}

export type Pattern = FactPattern | LinkPattern | NotPattern | OrPattern | RuleApplication;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type FilterOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'contains' | 'startsWith' | 'endsWith' | 'matches';

export interface Filter {
  kind: 'filter';
  left: Term;
  op: FilterOp;
  right: Term;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export type AggregateOp = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'collect';

export interface Aggregate {
  op: AggregateOp;
  /** Variable to aggregate over. */
  variable: string;
  /** Output variable name. */
  as: string;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

export interface OrderBy {
  variable: string;
  direction: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * A complete EQL-S query.
 */
export interface Query {
  /** Variables to project in the result. Empty = return all bound variables. */
  select: string[];
  /** Pattern clauses that must all match (conjunction). */
  where: Pattern[];
  /** Post-match filters. */
  filters: Filter[];
  /** Aggregation functions. */
  aggregates: Aggregate[];
  /** Ordering. */
  orderBy: OrderBy[];
  /** Maximum number of results (0 = unlimited). */
  limit: number;
  /** Number of results to skip. */
  offset: number;
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

/**
 * A single set of variable bindings.
 */
export type Bindings = Map<string, Atom>;

// ---------------------------------------------------------------------------
// Datalog Rules
// ---------------------------------------------------------------------------

/**
 * A Datalog rule: `head :- body`.
 *
 * Example: `ancestor(?x, ?z) :- [?x "parent" ?y], ancestor(?y, ?z)`
 */
export interface DatalogRule {
  name: string;
  /** Parameter variable names for the head. */
  params: string[];
  /** Body patterns (conjunction). */
  body: Pattern[];
  /** Body filters. */
  filters: Filter[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isVariable(t: Term): t is Variable {
  return t.kind === 'variable';
}

export function isLiteral(t: Term): t is Literal {
  return t.kind === 'literal';
}

export function variable(name: string): Variable {
  return { kind: 'variable', name };
}

export function literal(value: Atom): Literal {
  return { kind: 'literal', value };
}
