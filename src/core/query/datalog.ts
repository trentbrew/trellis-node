/**
 * Datalog Evaluator — Rule-based recursive queries.
 *
 * Provides transitive closure, reachability, and other recursive
 * graph queries via Datalog-style rules evaluated over the EAV store.
 *
 * Built-in rules:
 *   - `reachable(?src, ?tgt)` via a named link attribute
 *   - `ancestor(?x, ?y)` (generic transitive closure over any link)
 *
 * Custom rules can be registered via `addRule()`.
 *
 * @module trellis/core/query
 */

import type { EAVStore } from '../store/eav-store.js';
import type { DatalogRule } from './types.js';
import { variable, literal } from './types.js';
import { QueryEngine } from './engine.js';

// ---------------------------------------------------------------------------
// Built-in rule constructors
// ---------------------------------------------------------------------------

/**
 * Creates a transitive closure rule over a specific link attribute.
 *
 * `reachable(?x, ?y) :- (x attr y)`
 * `reachable(?x, ?y) :- (x attr ?z), reachable(?z, ?y)`
 */
export function transitiveClosureRules(ruleName: string, linkAttribute: string): DatalogRule[] {
  return [
    // Base case: direct link
    {
      name: ruleName,
      params: ['x', 'y'],
      body: [
        {
          kind: 'link',
          source: variable('x'),
          attribute: literal(linkAttribute),
          target: variable('y'),
        },
      ],
      filters: [],
    },
    // Recursive case: indirect via intermediate
    {
      name: ruleName,
      params: ['x', 'y'],
      body: [
        {
          kind: 'link',
          source: variable('x'),
          attribute: literal(linkAttribute),
          target: variable('z'),
        },
        {
          kind: 'rule',
          name: ruleName,
          args: [variable('z'), variable('y')],
        },
      ],
      filters: [],
    },
  ];
}

/**
 * Creates a reverse reachability rule (follows links backwards).
 */
export function reverseReachabilityRules(ruleName: string, linkAttribute: string): DatalogRule[] {
  return [
    {
      name: ruleName,
      params: ['x', 'y'],
      body: [
        {
          kind: 'link',
          source: variable('y'),
          attribute: literal(linkAttribute),
          target: variable('x'),
        },
      ],
      filters: [],
    },
    {
      name: ruleName,
      params: ['x', 'y'],
      body: [
        {
          kind: 'link',
          source: variable('z'),
          attribute: literal(linkAttribute),
          target: variable('x'),
        },
        {
          kind: 'rule',
          name: ruleName,
          args: [variable('z'), variable('y')],
        },
      ],
      filters: [],
    },
  ];
}

/**
 * Creates a "sibling" rule — entities that share a common parent via a link attribute.
 *
 * `sibling(?a, ?b) :- (?a attr ?parent), (?b attr ?parent)`
 * FILTER ?a != ?b
 */
export function siblingRules(ruleName: string, linkAttribute: string): DatalogRule[] {
  return [
    {
      name: ruleName,
      params: ['a', 'b'],
      body: [
        {
          kind: 'link',
          source: variable('a'),
          attribute: literal(linkAttribute),
          target: variable('parent'),
        },
        {
          kind: 'link',
          source: variable('b'),
          attribute: literal(linkAttribute),
          target: variable('parent'),
        },
      ],
      filters: [
        {
          kind: 'filter',
          left: variable('a'),
          op: '!=',
          right: variable('b'),
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Datalog Runtime — convenience wrapper around QueryEngine + rules
// ---------------------------------------------------------------------------

export class DatalogRuntime {
  private engine: QueryEngine;

  constructor(store: EAVStore) {
    this.engine = new QueryEngine(store);
  }

  /** Register a Datalog rule (or multiple). */
  addRule(rule: DatalogRule): void {
    this.engine.addRule(rule);
  }

  addRules(rules: DatalogRule[]): void {
    for (const r of rules) this.engine.addRule(r);
  }

  removeRule(name: string): void {
    this.engine.removeRule(name);
  }

  /** Register built-in transitive closure for a link attribute. */
  registerTransitiveClosure(ruleName: string, linkAttribute: string): void {
    this.addRules(transitiveClosureRules(ruleName, linkAttribute));
  }

  /** Register built-in reverse reachability for a link attribute. */
  registerReverseReachability(ruleName: string, linkAttribute: string): void {
    this.addRules(reverseReachabilityRules(ruleName, linkAttribute));
  }

  /** Register built-in sibling rule for a link attribute. */
  registerSiblings(ruleName: string, linkAttribute: string): void {
    this.addRules(siblingRules(ruleName, linkAttribute));
  }

  /** Get the underlying QueryEngine for direct query execution. */
  getEngine(): QueryEngine {
    return this.engine;
  }
}
