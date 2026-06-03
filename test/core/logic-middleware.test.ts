import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { SqliteKernelBackend } from '../../src/core/persist/sqlite-backend.js';
import { attachStandardMiddleware } from '../../src/core/kernel/boot-middleware.js';
import type { SchemaDefinition } from '../../src/core/ontology/types.js';
import type { Query } from '../../src/core/query/types.js';
import { variable, literal } from '../../src/core/query/types.js';

const lineItemOntology: SchemaDefinition = {
  '@id': 'schema:LineItem',
  '@type': 'trellis:Schema',
  version: '1.0.0',
  tier: 'user',
  label: 'LineItem',
  fields: [
    { name: 'price', valueType: 'number' },
    { name: 'quantity', valueType: 'number' },
    {
      name: 'total',
      valueType: 'formula',
      formula: '$mul($price, $quantity)',
      computed: true,
    },
  ],
};

describe('logic middleware — EQL formula enrichment', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-logic-mw-'));
    kernel = new TrellisKernel({
      backend: new SqliteKernelBackend(join(tmpDir, 'test.db')),
      agentId: 'test',
    });
    kernel.boot();
    kernel.createOntology(lineItemOntology);
    attachStandardMiddleware(kernel);
  });

  afterEach(() => {
    kernel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('enriches query bindings with ontology formula fields', async () => {
    await kernel.createEntity('line:1', 'LineItem', {
      price: 10,
      quantity: 3,
    });

    const query: Query = {
      select: ['e', 'price', 'quantity', 'total'],
      where: [
        {
          kind: 'fact',
          entity: variable('e'),
          attribute: literal('type'),
          value: literal('LineItem'),
        },
        {
          kind: 'fact',
          entity: variable('e'),
          attribute: literal('price'),
          value: variable('price'),
        },
        {
          kind: 'fact',
          entity: variable('e'),
          attribute: literal('quantity'),
          value: variable('quantity'),
        },
      ],
      filters: [],
      aggregates: [],
      orderBy: [],
      limit: 0,
      offset: 0,
    };

    const result = await kernel.query(query);
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0]!.total).toBe(30);
  });

  test('resolves ontology by lowercase entity type', async () => {
    const ontology: SchemaDefinition = {
      '@id': 'schema:framework',
      '@type': 'trellis:Schema',
      version: '1.0.0',
      tier: 'user',
      label: 'Framework',
      fields: [
        { name: 'title', valueType: 'title' },
        {
          name: 'titleLength',
          valueType: 'formula',
          formula: '$len($title)',
          computed: true,
        },
      ],
    };

    kernel.createOntology(ontology);
    attachStandardMiddleware(kernel);

    await kernel.createEntity('framework:1', 'framework', { title: 'svelte' });

    const result = await kernel.query({
      select: ['e', 'title', 'titleLength'],
      where: [
        {
          kind: 'fact',
          entity: variable('e'),
          attribute: literal('type'),
          value: literal('framework'),
        },
        {
          kind: 'fact',
          entity: variable('e'),
          attribute: literal('title'),
          value: variable('title'),
        },
      ],
      filters: [],
      aggregates: [],
      orderBy: [],
      limit: 0,
      offset: 0,
    });

    expect(result.bindings[0]!.titleLength).toBe(6);
  });
});
