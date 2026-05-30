/**
 * Tests for the EQL-S Query Engine, Parser, and Datalog evaluator.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EAVStore } from '../../src/core/store/eav-store.js';
import { QueryEngine } from '../../src/core/query/engine.js';
import { parseQuery, parseRule, parseSimple } from '../../src/core/query/parser.js';
import { DatalogRuntime, transitiveClosureRules } from '../../src/core/query/datalog.js';
import { variable, literal } from '../../src/core/query/types.js';
import type { Query } from '../../src/core/query/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function seedStore(): EAVStore {
  const store = new EAVStore();

  // Entities
  store.addFacts([
    { e: 'proj:alpha', a: 'type', v: 'Project' },
    { e: 'proj:alpha', a: 'name', v: 'Alpha' },
    { e: 'proj:alpha', a: 'status', v: 'active' },
    { e: 'proj:alpha', a: 'priority', v: 1 },

    { e: 'proj:beta', a: 'type', v: 'Project' },
    { e: 'proj:beta', a: 'name', v: 'Beta' },
    { e: 'proj:beta', a: 'status', v: 'archived' },
    { e: 'proj:beta', a: 'priority', v: 2 },

    { e: 'proj:gamma', a: 'type', v: 'Project' },
    { e: 'proj:gamma', a: 'name', v: 'Gamma' },
    { e: 'proj:gamma', a: 'status', v: 'active' },
    { e: 'proj:gamma', a: 'priority', v: 3 },

    { e: 'user:alice', a: 'type', v: 'User' },
    { e: 'user:alice', a: 'name', v: 'Alice' },
    { e: 'user:alice', a: 'role', v: 'admin' },

    { e: 'user:bob', a: 'type', v: 'User' },
    { e: 'user:bob', a: 'name', v: 'Bob' },
    { e: 'user:bob', a: 'role', v: 'developer' },

    { e: 'user:carol', a: 'type', v: 'User' },
    { e: 'user:carol', a: 'name', v: 'Carol' },
    { e: 'user:carol', a: 'role', v: 'developer' },
  ]);

  // Links
  store.addLinks([
    { e1: 'user:alice', a: 'memberOf', e2: 'proj:alpha' },
    { e1: 'user:bob', a: 'memberOf', e2: 'proj:alpha' },
    { e1: 'user:bob', a: 'memberOf', e2: 'proj:beta' },
    { e1: 'user:carol', a: 'memberOf', e2: 'proj:gamma' },
    { e1: 'proj:beta', a: 'dependsOn', e2: 'proj:alpha' },
    { e1: 'proj:gamma', a: 'dependsOn', e2: 'proj:beta' },
  ]);

  return store;
}

// ---------------------------------------------------------------------------
// QueryEngine — direct API
// ---------------------------------------------------------------------------

describe('QueryEngine', () => {
  let store: EAVStore;
  let engine: QueryEngine;

  beforeEach(() => {
    store = seedStore();
    engine = new QueryEngine(store);
  });

  it('should match a simple fact pattern', () => {
    const query: Query = {
      select: ['e', 'name'],
      where: [
        { kind: 'fact', entity: variable('e'), attribute: literal('type'), value: literal('Project') },
        { kind: 'fact', entity: variable('e'), attribute: literal('name'), value: variable('name') },
      ],
      filters: [],
      aggregates: [],
      orderBy: [],
      limit: 0,
      offset: 0,
    };
    const result = engine.execute(query);
    expect(result.count).toBe(3);
    const names = result.bindings.map((b) => b.name).sort();
    expect(names).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('should match a link pattern', () => {
    const query: Query = {
      select: ['user', 'proj'],
      where: [
        { kind: 'link', source: variable('user'), attribute: literal('memberOf'), target: variable('proj') },
      ],
      filters: [],
      aggregates: [],
      orderBy: [],
      limit: 0,
      offset: 0,
    };
    const result = engine.execute(query);
    expect(result.count).toBe(4);
  });

  it('should join facts and links', () => {
    const query: Query = {
      select: ['userName', 'projName'],
      where: [
        { kind: 'link', source: variable('u'), attribute: literal('memberOf'), target: variable('p') },
        { kind: 'fact', entity: variable('u'), attribute: literal('name'), value: variable('userName') },
        { kind: 'fact', entity: variable('p'), attribute: literal('name'), value: variable('projName') },
      ],
      filters: [],
      aggregates: [],
      orderBy: [],
      limit: 0,
      offset: 0,
    };
    const result = engine.execute(query);
    expect(result.count).toBe(4);
    const pairs = result.bindings.map((b) => `${b.userName}->${b.projName}`).sort();
    expect(pairs).toEqual([
      'Alice->Alpha',
      'Bob->Alpha',
      'Bob->Beta',
      'Carol->Gamma',
    ]);
  });

  it('should apply filters', () => {
    const query: Query = {
      select: ['e', 'name'],
      where: [
        { kind: 'fact', entity: variable('e'), attribute: literal('type'), value: literal('Project') },
        { kind: 'fact', entity: variable('e'), attribute: literal('name'), value: variable('name') },
        { kind: 'fact', entity: variable('e'), attribute: literal('status'), value: variable('status') },
      ],
      filters: [
        { kind: 'filter', left: variable('status'), op: '=', right: literal('active') },
      ],
      aggregates: [],
      orderBy: [],
      limit: 0,
      offset: 0,
    };
    const result = engine.execute(query);
    expect(result.count).toBe(2);
    const names = result.bindings.map((b) => b.name).sort();
    expect(names).toEqual(['Alpha', 'Gamma']);
  });

  it('should apply NOT patterns', () => {
    const query: Query = {
      select: ['e', 'name'],
      where: [
        { kind: 'fact', entity: variable('e'), attribute: literal('type'), value: literal('User') },
        { kind: 'fact', entity: variable('e'), attribute: literal('name'), value: variable('name') },
        { kind: 'not', pattern: {
          kind: 'link', source: variable('e'), attribute: literal('memberOf'), target: literal('proj:alpha'),
        }},
      ],
      filters: [],
      aggregates: [],
      orderBy: [],
      limit: 0,
      offset: 0,
    };
    const result = engine.execute(query);
    // Carol is the only user NOT a member of proj:alpha
    expect(result.count).toBe(1);
    expect(result.bindings[0].name).toBe('Carol');
  });

  it('should apply OR patterns', () => {
    const query: Query = {
      select: ['e', 'name'],
      where: [
        { kind: 'fact', entity: variable('e'), attribute: literal('type'), value: literal('User') },
        { kind: 'fact', entity: variable('e'), attribute: literal('name'), value: variable('name') },
        { kind: 'or', branches: [
          [{ kind: 'fact', entity: variable('e'), attribute: literal('role'), value: literal('admin') }],
          [{ kind: 'link', source: variable('e'), attribute: literal('memberOf'), target: literal('proj:gamma') }],
        ]},
      ],
      filters: [],
      aggregates: [],
      orderBy: [],
      limit: 0,
      offset: 0,
    };
    const result = engine.execute(query);
    const names = result.bindings.map((b) => b.name).sort();
    expect(names).toEqual(['Alice', 'Carol']);
  });

  it('should aggregate with count', () => {
    const query: Query = {
      select: ['proj', 'cnt'],
      where: [
        { kind: 'link', source: variable('user'), attribute: literal('memberOf'), target: variable('proj') },
      ],
      filters: [],
      aggregates: [{ op: 'count', variable: 'user', as: 'cnt' }],
      orderBy: [],
      limit: 0,
      offset: 0,
    };
    const result = engine.execute(query);
    const alphaRow = result.bindings.find((b) => b.proj === 'proj:alpha');
    expect(alphaRow?.cnt).toBe(2);
  });

  it('should order results', () => {
    const query: Query = {
      select: ['name'],
      where: [
        { kind: 'fact', entity: variable('e'), attribute: literal('type'), value: literal('Project') },
        { kind: 'fact', entity: variable('e'), attribute: literal('name'), value: variable('name') },
      ],
      filters: [],
      aggregates: [],
      orderBy: [{ variable: 'name', direction: 'desc' }],
      limit: 0,
      offset: 0,
    };
    const result = engine.execute(query);
    expect(result.bindings.map((b) => b.name)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('should apply limit and offset', () => {
    const query: Query = {
      select: ['name'],
      where: [
        { kind: 'fact', entity: variable('e'), attribute: literal('type'), value: literal('Project') },
        { kind: 'fact', entity: variable('e'), attribute: literal('name'), value: variable('name') },
      ],
      filters: [],
      aggregates: [],
      orderBy: [{ variable: 'name', direction: 'asc' }],
      limit: 1,
      offset: 1,
    };
    const result = engine.execute(query);
    expect(result.count).toBe(1);
    expect(result.bindings[0].name).toBe('Beta');
  });

  it('should return all bound variables when select is empty', () => {
    const query: Query = {
      select: [],
      where: [
        { kind: 'fact', entity: variable('e'), attribute: literal('type'), value: literal('User') },
        { kind: 'fact', entity: variable('e'), attribute: literal('name'), value: variable('name') },
      ],
      filters: [],
      aggregates: [],
      orderBy: [],
      limit: 1,
      offset: 0,
    };
    const result = engine.execute(query);
    expect(result.count).toBe(1);
    // Should include both 'e' and 'name'
    expect(Object.keys(result.bindings[0]).sort()).toEqual(['e', 'name']);
  });
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('Parser', () => {
  it('should parse a basic SELECT WHERE query', () => {
    const q = parseQuery(`
      SELECT ?e ?name
      WHERE {
        [?e "type" "Project"]
        [?e "name" ?name]
      }
    `);
    expect(q.select).toEqual(['e', 'name']);
    expect(q.where).toHaveLength(2);
    expect(q.where[0].kind).toBe('fact');
  });

  it('should parse link patterns', () => {
    const q = parseQuery(`
      SELECT ?user ?proj
      WHERE {
        (?user "memberOf" ?proj)
      }
    `);
    expect(q.where).toHaveLength(1);
    expect(q.where[0].kind).toBe('link');
  });

  it('should parse filters', () => {
    const q = parseQuery(`
      SELECT ?e
      WHERE {
        [?e "type" "Project"]
        [?e "status" ?s]
      }
      FILTER ?s != "archived"
    `);
    expect(q.filters).toHaveLength(1);
    expect(q.filters[0].op).toBe('!=');
  });

  it('should parse ORDER BY, LIMIT, OFFSET', () => {
    const q = parseQuery(`
      SELECT ?name
      WHERE { [?e "name" ?name] }
      ORDER BY ?name DESC
      LIMIT 10
      OFFSET 5
    `);
    expect(q.orderBy).toEqual([{ variable: 'name', direction: 'desc' }]);
    expect(q.limit).toBe(10);
    expect(q.offset).toBe(5);
  });

  it('should parse NOT patterns', () => {
    const q = parseQuery(`
      SELECT ?e
      WHERE {
        [?e "type" "User"]
        NOT (?e "memberOf" "proj:alpha")
      }
    `);
    expect(q.where).toHaveLength(2);
    expect(q.where[1].kind).toBe('not');
  });

  it('should parse OR patterns', () => {
    const q = parseQuery(`
      SELECT ?e
      WHERE {
        [?e "type" "User"]
        OR { [?e "role" "admin"] } { (?e "memberOf" "proj:gamma") }
      }
    `);
    expect(q.where).toHaveLength(2);
    expect(q.where[1].kind).toBe('or');
  });

  it('should parse AGGREGATE', () => {
    const q = parseQuery(`
      SELECT ?proj ?cnt
      WHERE {
        (?user "memberOf" ?proj)
      }
      AGGREGATE count(?user) AS ?cnt
    `);
    expect(q.aggregates).toHaveLength(1);
    expect(q.aggregates[0].op).toBe('count');
    expect(q.aggregates[0].variable).toBe('user');
    expect(q.aggregates[0].as).toBe('cnt');
  });

  it('should parse numeric literals', () => {
    const q = parseQuery(`
      SELECT ?e
      WHERE { [?e "priority" 1] }
    `);
    const fp = q.where[0] as any;
    expect(fp.value.value).toBe(1);
  });

  it('should parse boolean literals', () => {
    const q = parseQuery(`
      SELECT ?e
      WHERE { [?e "active" true] }
    `);
    const fp = q.where[0] as any;
    expect(fp.value.value).toBe(true);
  });

  it('should parse a Datalog rule', () => {
    const rule = parseRule(`
      reachable(?x, ?y) :- (?x "dependsOn" ?y)
    `);
    expect(rule.name).toBe('reachable');
    expect(rule.params).toEqual(['x', 'y']);
    expect(rule.body).toHaveLength(1);
    expect(rule.body[0].kind).toBe('link');
  });

  it('should parse rule applications in queries', () => {
    const q = parseQuery(`
      SELECT ?src ?tgt
      WHERE {
        reachable(?src, ?tgt)
      }
    `);
    expect(q.where).toHaveLength(1);
    expect(q.where[0].kind).toBe('rule');
  });
});

// ---------------------------------------------------------------------------
// parseSimple
// ---------------------------------------------------------------------------

describe('parseSimple', () => {
  it('should parse a simple find-where query', () => {
    const q = parseSimple('find ?e where type = "Project"');
    expect(q.select).toEqual(['e']);
    expect(q.where).toHaveLength(1);
    expect(q.where[0].kind).toBe('fact');
  });

  it('should pass through full EQL-S syntax', () => {
    const q = parseSimple('SELECT ?e WHERE { [?e "type" "User"] }');
    expect(q.select).toEqual(['e']);
    expect(q.where).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Parser + Engine integration
// ---------------------------------------------------------------------------

describe('Parser + Engine integration', () => {
  let store: EAVStore;
  let engine: QueryEngine;

  beforeEach(() => {
    store = seedStore();
    engine = new QueryEngine(store);
  });

  it('should parse and execute a full query', () => {
    const q = parseQuery(`
      SELECT ?userName ?projName
      WHERE {
        (?u "memberOf" ?p)
        [?u "name" ?userName]
        [?p "name" ?projName]
      }
      ORDER BY ?userName ASC
    `);
    const result = engine.execute(q);
    expect(result.count).toBe(4);
    expect(result.bindings[0].userName).toBe('Alice');
  });

  it('should parse and execute with filters', () => {
    const q = parseQuery(`
      SELECT ?e ?name
      WHERE {
        [?e "type" "Project"]
        [?e "name" ?name]
        [?e "status" ?s]
      }
      FILTER ?s = "active"
      ORDER BY ?name ASC
    `);
    const result = engine.execute(q);
    expect(result.count).toBe(2);
    expect(result.bindings.map((b) => b.name)).toEqual(['Alpha', 'Gamma']);
  });

  it('should parse and execute a simple query', () => {
    const q = parseSimple('find ?e where type = "User"');
    const result = engine.execute(q);
    expect(result.count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Datalog
// ---------------------------------------------------------------------------

describe('DatalogRuntime', () => {
  let store: EAVStore;
  let runtime: DatalogRuntime;

  beforeEach(() => {
    store = seedStore();
    runtime = new DatalogRuntime(store);
  });

  it('should resolve transitive closure (direct)', () => {
    runtime.registerTransitiveClosure('reachable', 'dependsOn');
    const engine = runtime.getEngine();

    const q = parseQuery(`
      SELECT ?src ?tgt
      WHERE {
        reachable(?src, ?tgt)
      }
    `);
    const result = engine.execute(q);

    // Direct: gamma->beta, beta->alpha
    // Transitive: gamma->alpha
    expect(result.count).toBe(3);

    const pairs = result.bindings.map((b) => `${b.src}->${b.tgt}`).sort();
    expect(pairs).toContain('proj:beta->proj:alpha');
    expect(pairs).toContain('proj:gamma->proj:beta');
    expect(pairs).toContain('proj:gamma->proj:alpha');
  });

  it('should resolve transitive closure from a specific source', () => {
    runtime.registerTransitiveClosure('reachable', 'dependsOn');
    const engine = runtime.getEngine();

    const q: Query = {
      select: ['tgt'],
      where: [
        { kind: 'rule', name: 'reachable', args: [literal('proj:gamma'), variable('tgt')] },
      ],
      filters: [],
      aggregates: [],
      orderBy: [],
      limit: 0,
      offset: 0,
    };
    const result = engine.execute(q);

    expect(result.count).toBe(2);
    const targets = result.bindings.map((b) => b.tgt).sort();
    expect(targets).toEqual(['proj:alpha', 'proj:beta']);
  });

  it('should register and use custom rules', () => {
    const rule = parseRule(`
      projectMember(?user, ?proj) :- (?user "memberOf" ?proj), [?proj "type" "Project"]
    `);
    runtime.addRule(rule);
    const engine = runtime.getEngine();

    const q = parseQuery(`
      SELECT ?user ?proj
      WHERE {
        projectMember(?user, ?proj)
      }
    `);
    const result = engine.execute(q);
    expect(result.count).toBe(4);
  });
});
