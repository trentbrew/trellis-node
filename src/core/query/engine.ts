/**
 * EQL-S Query Engine — Pattern-matching evaluator over the EAV store.
 *
 * Evaluates queries by matching fact/link patterns against the store,
 * binding variables, applying filters, and computing aggregates.
 *
 * @module trellis/core/query
 */

import type { EAVStore, Fact, Link, Atom } from '../store/eav-store.js';
import type {
  Query,
  Pattern,
  FactPattern,
  LinkPattern,
  NotPattern,
  OrPattern,
  RuleApplication,
  Filter,
  FilterOp,
  Aggregate,
  OrderBy,
  Term,
  Bindings,
  DatalogRule,
} from './types.js';
import { isVariable, isLiteral } from './types.js';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface QueryResult {
  bindings: Record<string, Atom>[];
  executionTime: number;
  count: number;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class QueryEngine {
  private rules: Map<string, DatalogRule[]> = new Map();
  private maxRuleDepth = 32;

  constructor(private store: EAVStore) {}

  /** Register a Datalog rule. Multiple rules with the same name = union. */
  addRule(rule: DatalogRule): void {
    const existing = this.rules.get(rule.name) ?? [];
    existing.push(rule);
    this.rules.set(rule.name, existing);
  }

  removeRule(name: string): void {
    this.rules.delete(name);
  }

  /** Execute a query against the store. */
  execute(query: Query): QueryResult {
    const start = performance.now();

    // Evaluate patterns
    let results = this._evaluatePatterns(query.where, [new Map()]);

    // Apply filters
    for (const filter of query.filters) {
      results = results.filter((b) => this._evalFilter(filter, b));
    }

    // Apply aggregates
    if (query.aggregates.length > 0) {
      results = this._aggregate(results, query.aggregates, query.select);
    }

    // Apply ordering
    if (query.orderBy.length > 0) {
      results = this._order(results, query.orderBy);
    }

    // Apply offset/limit
    if (query.offset > 0) results = results.slice(query.offset);
    if (query.limit > 0) results = results.slice(0, query.limit);

    // Project selected variables
    const projected = this._project(results, query.select);

    return {
      bindings: projected,
      executionTime: performance.now() - start,
      count: projected.length,
    };
  }

  // -------------------------------------------------------------------------
  // Pattern evaluation
  // -------------------------------------------------------------------------

  private _evaluatePatterns(
    patterns: Pattern[],
    bindings: Bindings[],
  ): Bindings[] {
    let current = bindings;
    for (const pattern of patterns) {
      if (current.length === 0) break;
      current = this._evaluatePattern(pattern, current);
    }
    return current;
  }

  private _evaluatePattern(pattern: Pattern, bindings: Bindings[]): Bindings[] {
    switch (pattern.kind) {
      case 'fact':
        return this._evalFactPattern(pattern, bindings);
      case 'link':
        return this._evalLinkPattern(pattern, bindings);
      case 'not':
        return this._evalNotPattern(pattern, bindings);
      case 'or':
        return this._evalOrPattern(pattern, bindings);
      case 'rule':
        return this._evalRuleApplication(pattern, bindings);
    }
  }

  private _evalFactPattern(p: FactPattern, bindings: Bindings[]): Bindings[] {
    const results: Bindings[] = [];
    for (const b of bindings) {
      const eResolved = this._resolve(p.entity, b);
      const aResolved = this._resolve(p.attribute, b);
      const vResolved = this._resolve(p.value, b);

      let facts: Fact[];
      if (eResolved !== undefined && aResolved !== undefined) {
        facts = this.store
          .getFactsByEntity(String(eResolved))
          .filter((f) => f.a === aResolved);
      } else if (eResolved !== undefined) {
        facts = this.store.getFactsByEntity(String(eResolved));
      } else if (aResolved !== undefined && vResolved !== undefined) {
        facts = this.store.getFactsByValue(String(aResolved), vResolved);
      } else if (aResolved !== undefined) {
        facts = this.store.getFactsByAttribute(String(aResolved));
      } else {
        facts = this.store.getAllFacts();
      }

      if (vResolved !== undefined) {
        facts = facts.filter((f) => f.v === vResolved);
      }

      for (const fact of facts) {
        const nb = new Map(b);
        if (
          this._bind(p.entity, fact.e, nb) &&
          this._bind(p.attribute, fact.a, nb) &&
          this._bind(p.value, fact.v, nb)
        ) {
          results.push(nb);
        }
      }
    }
    return results;
  }

  private _evalLinkPattern(p: LinkPattern, bindings: Bindings[]): Bindings[] {
    const results: Bindings[] = [];
    for (const b of bindings) {
      const srcResolved = this._resolve(p.source, b);
      const attrResolved = this._resolve(p.attribute, b);
      const tgtResolved = this._resolve(p.target, b);

      let links: Link[];
      if (srcResolved !== undefined && attrResolved !== undefined) {
        links = this.store.getLinksByEntityAndAttribute(
          String(srcResolved),
          String(attrResolved),
        );
      } else if (srcResolved !== undefined) {
        links = this.store.getLinksByEntity(String(srcResolved));
      } else if (attrResolved !== undefined) {
        links = this.store.getLinksByAttribute(String(attrResolved));
      } else {
        links = this.store.getAllLinks();
      }

      if (tgtResolved !== undefined) {
        links = links.filter((l) => l.e2 === tgtResolved);
      }

      for (const link of links) {
        const nb = new Map(b);
        if (
          this._bind(p.source, link.e1, nb) &&
          this._bind(p.attribute, link.a, nb) &&
          this._bind(p.target, link.e2, nb)
        ) {
          results.push(nb);
        }
      }
    }
    return results;
  }

  private _evalNotPattern(p: NotPattern, bindings: Bindings[]): Bindings[] {
    return bindings.filter((b) => {
      const matches = this._evaluatePattern(p.pattern, [b]);
      return matches.length === 0;
    });
  }

  private _evalOrPattern(p: OrPattern, bindings: Bindings[]): Bindings[] {
    const results: Bindings[] = [];
    for (const branch of p.branches) {
      const branchResults = this._evaluatePatterns(branch, bindings);
      results.push(...branchResults);
    }
    return this._dedup(results);
  }

  private _evalRuleApplication(
    p: RuleApplication,
    bindings: Bindings[],
    depth = 0,
  ): Bindings[] {
    if (depth > this.maxRuleDepth) return [];
    const ruleDefs = this.rules.get(p.name);
    if (!ruleDefs) return [];

    const results: Bindings[] = [];
    for (const b of bindings) {
      for (const rule of ruleDefs) {
        // Bind rule params from application args
        const ruleBindings = new Map(b);
        let ok = true;
        for (let i = 0; i < rule.params.length && i < p.args.length; i++) {
          const resolved = this._resolve(p.args[i], b);
          if (resolved !== undefined) {
            ruleBindings.set(rule.params[i], resolved);
          } else if (isVariable(p.args[i])) {
            // Leave unbound — will be bound by body
          }
        }
        if (!ok) continue;

        // Evaluate body
        let bodyResults = this._evaluatePatterns(rule.body, [ruleBindings]);

        // Apply rule filters
        for (const f of rule.filters) {
          bodyResults = bodyResults.filter((rb) => this._evalFilter(f, rb));
        }

        // Map back rule param bindings to the application arg variables
        for (const rb of bodyResults) {
          const nb = new Map(b);
          for (let i = 0; i < rule.params.length && i < p.args.length; i++) {
            if (isVariable(p.args[i])) {
              const val = rb.get(rule.params[i]);
              if (val !== undefined)
                nb.set((p.args[i] as { name: string }).name, val);
            }
          }
          results.push(nb);
        }
      }
    }
    return this._dedup(results);
  }

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------

  private _evalFilter(filter: Filter, b: Bindings): boolean {
    const left = this._resolve(filter.left, b);
    const right = this._resolve(filter.right, b);
    if (left === undefined || right === undefined) return false;

    switch (filter.op) {
      case '=':
        return left === right;
      case '!=':
        return left !== right;
      case '<':
        return (left as any) < (right as any);
      case '<=':
        return (left as any) <= (right as any);
      case '>':
        return (left as any) > (right as any);
      case '>=':
        return (left as any) >= (right as any);
      case 'contains':
        return String(left).includes(String(right));
      case 'startsWith':
        return String(left).startsWith(String(right));
      case 'endsWith':
        return String(left).endsWith(String(right));
      case 'matches':
        return new RegExp(String(right)).test(String(left));
      default:
        return false;
    }
  }

  // -------------------------------------------------------------------------
  // Aggregation
  // -------------------------------------------------------------------------

  private _aggregate(
    bindings: Bindings[],
    aggregates: Aggregate[],
    groupBy: string[],
  ): Bindings[] {
    // Group by non-aggregated select variables
    const aggVarNames = new Set(aggregates.map((a) => a.as));
    const groupVars = groupBy.filter((v) => !aggVarNames.has(v));

    const groups = new Map<string, Bindings[]>();
    for (const b of bindings) {
      const key = groupVars.map((v) => String(b.get(v) ?? '')).join('\0');
      const group = groups.get(key) ?? [];
      group.push(b);
      groups.set(key, group);
    }

    const results: Bindings[] = [];
    for (const [, group] of groups) {
      const nb = new Map(group[0]);
      for (const agg of aggregates) {
        const vals = group
          .map((b) => b.get(agg.variable))
          .filter((v) => v !== undefined);
        nb.set(agg.as, this._computeAggregate(agg.op, vals as Atom[]));
      }
      results.push(nb);
    }
    return results;
  }

  private _computeAggregate(op: string, vals: Atom[]): Atom {
    switch (op) {
      case 'count':
        return vals.length;
      case 'sum':
        return vals.reduce(
          (s, v) => (s as number) + (Number(v) || 0),
          0 as any,
        ) as number;
      case 'avg':
        return vals.length
          ? (vals.reduce(
              (s, v) => (s as number) + (Number(v) || 0),
              0 as any,
            ) as number) / vals.length
          : 0;
      case 'min':
        return vals.reduce(
          (m, v) => ((v as any) < (m as any) ? v : m),
          vals[0],
        );
      case 'max':
        return vals.reduce(
          (m, v) => ((v as any) > (m as any) ? v : m),
          vals[0],
        );
      case 'collect':
        return JSON.stringify(vals);
      default:
        return vals.length;
    }
  }

  // -------------------------------------------------------------------------
  // Ordering
  // -------------------------------------------------------------------------

  private _order(bindings: Bindings[], orderBy: OrderBy[]): Bindings[] {
    return [...bindings].sort((a, b) => {
      for (const o of orderBy) {
        const va = a.get(o.variable);
        const vb = b.get(o.variable);
        if (va === vb) continue;
        if (va === undefined) return 1;
        if (vb === undefined) return -1;
        const cmp = (va as any) < (vb as any) ? -1 : 1;
        return o.direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  // -------------------------------------------------------------------------
  // Projection
  // -------------------------------------------------------------------------

  private _project(
    bindings: Bindings[],
    select: string[],
  ): Record<string, Atom>[] {
    return bindings.map((b) => {
      const row: Record<string, Atom> = {};
      if (select.length === 0) {
        for (const [k, v] of b) row[k] = v;
      } else {
        for (const s of select) {
          const v = b.get(s);
          if (v !== undefined) row[s] = v;
        }
      }
      return row;
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private _resolve(term: Term, bindings: Bindings): Atom | undefined {
    if (isLiteral(term)) return term.value;
    return bindings.get(term.name);
  }

  private _bind(term: Term, value: Atom, bindings: Bindings): boolean {
    if (isLiteral(term)) return term.value === value;
    const existing = bindings.get(term.name);
    if (existing !== undefined) return existing === value;
    bindings.set(term.name, value);
    return true;
  }

  private _dedup(bindings: Bindings[]): Bindings[] {
    const seen = new Set<string>();
    return bindings.filter((b) => {
      const key = [...b.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('\0');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
