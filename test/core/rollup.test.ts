import { describe, expect, test } from 'vitest';
import { EAVStore } from '../../src/core/store/eav-store.js';
import {
  collectRollupRelatedIds,
  evaluateRollup,
  projectRelationFields,
} from '../../src/core/computation/rollup.js';
import type { SchemaDefinition } from '../../src/core/ontology/types.js';

describe('rollup evaluator', () => {
  test('count via graph links', () => {
    const store = new EAVStore();
    store.addFacts([
      { e: 'proj:1', a: 'type', v: 'Project' },
      { e: 'task:1', a: 'type', v: 'Task' },
      { e: 'task:2', a: 'type', v: 'Task' },
    ]);
    store.addLinks([
      { e1: 'proj:1', a: 'tasks', e2: 'task:1' },
      { e1: 'proj:1', a: 'tasks', e2: 'task:2' },
    ]);

    const count = evaluateRollup(
      {
        relationProperty: 'tasks',
        targetProperty: 'id',
        aggregation: 'count',
      },
      { store, entityId: 'proj:1' },
    );
    expect(count).toBe(2);
  });

  test('sum rollup over linked entity property', () => {
    const store = new EAVStore();
    store.addFacts([
      { e: 'order:1', a: 'type', v: 'Order' },
      { e: 'line:1', a: 'type', v: 'Line' },
      { e: 'line:1', a: 'amount', v: 10 },
      { e: 'line:2', a: 'type', v: 'Line' },
      { e: 'line:2', a: 'amount', v: 25 },
    ]);
    store.addLinks([
      { e1: 'order:1', a: 'lines', e2: 'line:1' },
      { e1: 'order:1', a: 'lines', e2: 'line:2' },
    ]);

    const total = evaluateRollup(
      {
        relationProperty: 'lines',
        targetProperty: 'amount',
        aggregation: 'sum',
      },
      { store, entityId: 'order:1' },
    );
    expect(total).toBe(35);
  });

  test('count via join-entity foreign key', () => {
    const store = new EAVStore();
    store.addFacts([
      { e: 'fw:1', a: 'type', v: 'Framework' },
      { e: 'tag:1', a: 'type', v: 'frameworkTag' },
      { e: 'tag:1', a: 'frameworkId', v: 'fw:1' },
      { e: 'tag:2', a: 'type', v: 'frameworkTag' },
      { e: 'tag:2', a: 'frameworkId', v: 'fw:1' },
      { e: 'tag:3', a: 'type', v: 'frameworkTag' },
      { e: 'tag:3', a: 'frameworkId', v: 'fw:2' },
    ]);

    const ids = collectRollupRelatedIds(
      {
        relationProperty: 'tags',
        targetProperty: 'id',
        aggregation: 'count',
        joinEntity: { type: 'frameworkTag', foreignKey: 'frameworkId' },
      },
      { store, entityId: 'fw:1' },
    );
    expect(ids).toHaveLength(2);

    const count = evaluateRollup(
      {
        relationProperty: 'tags',
        targetProperty: 'id',
        aggregation: 'count',
        joinEntity: { type: 'frameworkTag', foreignKey: 'frameworkId' },
      },
      { store, entityId: 'fw:1' },
    );
    expect(count).toBe(2);
  });

  test('projectRelationFields writes link targets into binding', () => {
    const store = new EAVStore();
    store.addFacts([
      { e: 'doc:1', a: 'type', v: 'Document' },
      { e: 'person:1', a: 'type', v: 'Person' },
    ]);
    store.addLinks([{ e1: 'doc:1', a: 'owner', e2: 'person:1' }]);

    const schema: SchemaDefinition = {
      '@id': 'schema:Document',
      '@type': 'trellis:Schema',
      version: '1.0.0',
      fields: [
        {
          name: 'owner',
          valueType: 'relation',
          relation: { cardinality: 'one' },
        },
      ],
    };

    const binding: Record<string, string> = {
      type: 'Document',
      '?e': 'doc:1',
    };
    projectRelationFields(binding, schema, store, 'doc:1');
    expect(binding.owner).toBe('person:1');
  });
});
