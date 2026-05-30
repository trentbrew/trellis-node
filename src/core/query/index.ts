/**
 * EQL-S Query Module — Public API Surface
 *
 * @module trellis/core/query
 */

// Types
export type {
  Variable, Literal, Term,
  FactPattern, LinkPattern, NotPattern, OrPattern, RuleApplication, Pattern,
  FilterOp, Filter,
  AggregateOp, Aggregate,
  OrderBy,
  Query,
  Bindings,
  DatalogRule,
} from './types.js';

export { isVariable, isLiteral, variable, literal } from './types.js';

// Engine
export { QueryEngine } from './engine.js';
export type { QueryResult } from './engine.js';

// Parser
export { parseQuery, parseRule, parseSimple } from './parser.js';

// Datalog
export {
  DatalogRuntime,
  transitiveClosureRules,
  reverseReachabilityRules,
  siblingRules,
} from './datalog.js';
