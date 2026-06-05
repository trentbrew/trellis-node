/**
 * Tests for the Ontology System — registry, validation, middleware, builtins.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EAVStore } from '../../src/core/store/eav-store.js';
import { OntologyRegistry } from '../../src/core/ontology/registry.js';
import {
  validateEntity,
  validateStore,
  createValidationMiddleware,
} from '../../src/core/ontology/validator.js';
import {
  projectOntology,
  teamOntology,
  agentOntology,
  builtinOntologies,
} from '../../src/core/ontology/builtins.js';
import type { OntologySchema } from '../../src/core/ontology/types.js';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { BetterSqliteKernelBackend } from '../../src/core/persist/better-sqlite-backend.js';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('OntologyRegistry', () => {
  let registry: OntologyRegistry;

  beforeEach(() => {
    registry = new OntologyRegistry();
  });

  it('should register an ontology', () => {
    registry.register(projectOntology);
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('trellis:project')).toBeDefined();
  });

  it('should register all builtins', () => {
    for (const o of builtinOntologies) registry.register(o);
    expect(registry.list()).toHaveLength(3);
  });

  it('should reject duplicate registration at same version', () => {
    registry.register(projectOntology);
    expect(() => registry.register(projectOntology)).toThrow(
      'already registered',
    );
  });

  it('should unregister an ontology', () => {
    registry.register(projectOntology);
    registry.unregister('trellis:project');
    expect(registry.list()).toHaveLength(0);
    expect(registry.hasEntityType('Project')).toBe(false);
  });

  it('should resolve entity types', () => {
    registry.register(projectOntology);
    expect(registry.hasEntityType('Project')).toBe(true);
    expect(registry.hasEntityType('Module')).toBe(true);
    expect(registry.hasEntityType('NonExistent')).toBe(false);
  });

  it('should return entity def with attributes', () => {
    registry.register(projectOntology);
    const def = registry.getEntityDef('Project');
    expect(def).toBeDefined();
    expect(def!.name).toBe('Project');
    expect(def!.attributes.length).toBeGreaterThan(0);
    expect(def!.attributes.find((a) => a.name === 'name')).toBeDefined();
  });

  it('should list all entity types', () => {
    registry.register(projectOntology);
    const types = registry.listEntityTypes();
    expect(types).toContain('Project');
    expect(types).toContain('Module');
    expect(types).toContain('Feature');
  });

  it('should return required attributes', () => {
    registry.register(projectOntology);
    const required = registry.getRequiredAttributes('Project');
    expect(required.find((a) => a.name === 'name')).toBeDefined();
  });

  it('should resolve relations', () => {
    registry.register(projectOntology);
    const rel = registry.getRelationDef('contains');
    expect(rel).toBeDefined();
    expect(rel!.sourceTypes).toContain('Project');
  });

  it('should get relations for a type', () => {
    registry.register(projectOntology);
    const rels = registry.getRelationsForType('Project');
    expect(rels.length).toBeGreaterThan(0);
    expect(rels.some((r) => r.name === 'contains')).toBe(true);
  });

  it('should list relation names', () => {
    registry.register(projectOntology);
    const names = registry.listRelationNames();
    expect(names).toContain('dependsOn');
    expect(names).toContain('contains');
  });

  it('should track which ontology defines each type', () => {
    registry.register(projectOntology);
    registry.register(teamOntology);
    expect(registry.getEntityOntology('Project')).toBe('trellis:project');
    expect(registry.getEntityOntology('Developer')).toBe('trellis:team');
  });

  it('should resolve entity inheritance', () => {
    const schema: OntologySchema = {
      id: 'test:inherit',
      name: 'Inheritance Test',
      version: '1.0.0',
      entities: [
        {
          name: 'BaseEntity',
          attributes: [
            { name: 'name', type: 'string', required: true },
            { name: 'createdBy', type: 'string' },
          ],
        },
        {
          name: 'ChildEntity',
          extends: 'BaseEntity',
          attributes: [{ name: 'childAttr', type: 'number' }],
        },
      ],
      relations: [],
    };

    registry.register(schema);
    const child = registry.getEntityDef('ChildEntity');
    expect(child).toBeDefined();
    // Should have inherited attributes + own
    expect(child!.attributes.find((a) => a.name === 'name')).toBeDefined();
    expect(child!.attributes.find((a) => a.name === 'createdBy')).toBeDefined();
    expect(child!.attributes.find((a) => a.name === 'childAttr')).toBeDefined();
  });

  it('should allow child to override parent attributes', () => {
    const schema: OntologySchema = {
      id: 'test:override',
      name: 'Override Test',
      version: '1.0.0',
      entities: [
        {
          name: 'Parent',
          attributes: [{ name: 'status', type: 'string', enum: ['a', 'b'] }],
        },
        {
          name: 'Child',
          extends: 'Parent',
          attributes: [
            { name: 'status', type: 'string', enum: ['x', 'y', 'z'] },
          ],
        },
      ],
      relations: [],
    };

    registry.register(schema);
    const child = registry.getEntityDef('Child');
    const statusAttr = child!.attributes.find((a) => a.name === 'status');
    expect(statusAttr!.enum).toEqual(['x', 'y', 'z']);
  });
});

// ---------------------------------------------------------------------------
// Validation — standalone
// ---------------------------------------------------------------------------

describe('Validation', () => {
  let store: EAVStore;
  let registry: OntologyRegistry;

  beforeEach(() => {
    store = new EAVStore();
    registry = new OntologyRegistry();
    registry.register(projectOntology);
    registry.register(teamOntology);
  });

  it('should validate a correct entity', () => {
    store.addFacts([
      { e: 'proj:1', a: 'type', v: 'Project' },
      { e: 'proj:1', a: 'name', v: 'My Project' },
      { e: 'proj:1', a: 'status', v: 'active' },
    ]);

    const result = validateEntity('proj:1', store, registry);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect missing required attribute', () => {
    store.addFacts([
      { e: 'proj:1', a: 'type', v: 'Project' },
      // name is required but missing
      { e: 'proj:1', a: 'status', v: 'active' },
    ]);

    const result = validateEntity('proj:1', store, registry);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('should detect invalid enum value', () => {
    store.addFacts([
      { e: 'proj:1', a: 'type', v: 'Project' },
      { e: 'proj:1', a: 'name', v: 'Test' },
      { e: 'proj:1', a: 'status', v: 'invalid_status' },
    ]);

    const result = validateEntity('proj:1', store, registry);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'status')).toBe(true);
  });

  it('should detect type mismatch', () => {
    store.addFacts([
      { e: 'dep:1', a: 'type', v: 'Dependency' },
      { e: 'dep:1', a: 'name', v: 123 as any }, // should be string
    ]);

    const result = validateEntity('dep:1', store, registry);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('should warn about unknown entity types', () => {
    store.addFacts([
      { e: 'x:1', a: 'type', v: 'UnknownType' },
      { e: 'x:1', a: 'foo', v: 'bar' },
    ]);

    const result = validateEntity('x:1', store, registry);
    expect(result.valid).toBe(true); // Unknown types are not errors by default
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should warn about unknown attributes', () => {
    store.addFacts([
      { e: 'proj:1', a: 'type', v: 'Project' },
      { e: 'proj:1', a: 'name', v: 'Test' },
      { e: 'proj:1', a: 'unknownAttr', v: 'foo' },
    ]);

    const result = validateEntity('proj:1', store, registry);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.field === 'unknownAttr')).toBe(true);
  });

  it('should validate links against relation defs', () => {
    store.addFacts([
      { e: 'proj:1', a: 'type', v: 'Project' },
      { e: 'proj:1', a: 'name', v: 'Test' },
      { e: 'dev:1', a: 'type', v: 'Developer' },
      { e: 'dev:1', a: 'name', v: 'Alice' },
    ]);
    // This link is valid: Developer -> Team via memberOf
    store.addLinks([{ e1: 'proj:1', a: 'contains', e2: 'dev:1' }]);

    const result = validateEntity('proj:1', store, registry);
    // Developer is not a valid target for 'contains' (expects Module, Feature, Config)
    expect(result.errors.some((e) => e.field === 'contains')).toBe(true);
  });

  it('should validate entire store', () => {
    store.addFacts([
      { e: 'proj:1', a: 'type', v: 'Project' },
      { e: 'proj:1', a: 'name', v: 'Good Project' },
      { e: 'proj:2', a: 'type', v: 'Project' },
      // proj:2 is missing required 'name'
    ]);

    const result = validateStore(store, registry);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.entityId === 'proj:2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validation Middleware
// ---------------------------------------------------------------------------

describe('Validation Middleware', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-ontology-test-'));
  });

  it('should allow valid mutations', async () => {
    const kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'test.db')),
      agentId: 'test',
    });
    kernel.boot();

    const registry = new OntologyRegistry();
    registry.register(projectOntology);
    kernel.addMiddleware(createValidationMiddleware(registry));

    // Valid entity — should not throw
    const result = await kernel.createEntity('proj:1', 'Project', {
      name: 'Test Project',
      status: 'active',
    });
    expect(result.op).toBeDefined();

    kernel.close();
  });

  it('should reject invalid enum values via middleware', async () => {
    const kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'test.db')),
      agentId: 'test',
    });
    kernel.boot();

    const registry = new OntologyRegistry();
    registry.register(projectOntology);
    kernel.addMiddleware(createValidationMiddleware(registry));

    await expect(
      kernel.createEntity('proj:1', 'Project', {
        name: 'Test',
        status: 'bogus_status',
      }),
    ).rejects.toThrow('not in');

    kernel.close();
  });

  it('should reject type mismatches via middleware', async () => {
    const kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'test.db')),
      agentId: 'test',
    });
    kernel.boot();

    const registry = new OntologyRegistry();
    registry.register(projectOntology);
    kernel.addMiddleware(createValidationMiddleware(registry));

    await expect(
      kernel.createEntity('dep:1', 'Dependency', {
        name: 42, // should be string
      }),
    ).rejects.toThrow('Expected string');

    kernel.close();
  });

  it('should allow unknown types in non-strict mode', async () => {
    const kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'test.db')),
      agentId: 'test',
    });
    kernel.boot();

    const registry = new OntologyRegistry();
    registry.register(projectOntology);
    kernel.addMiddleware(createValidationMiddleware(registry));

    // Unknown type — should pass in non-strict mode
    const result = await kernel.createEntity('x:1', 'CustomType', {
      whatever: 'value',
    });
    expect(result.op).toBeDefined();

    kernel.close();
  });

  it('should reject unknown types in strict mode', async () => {
    const kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'test.db')),
      agentId: 'test',
    });
    kernel.boot();

    const registry = new OntologyRegistry();
    registry.register(projectOntology);
    kernel.addMiddleware(
      createValidationMiddleware(registry, { strict: true }),
    );

    await expect(
      kernel.createEntity('x:1', 'CustomType', {
        whatever: 'value',
      }),
    ).rejects.toThrow('Unknown entity type');

    kernel.close();
  });
});

// ---------------------------------------------------------------------------
// Built-in Ontologies
// ---------------------------------------------------------------------------

describe('Built-in Ontologies', () => {
  it('should have 3 built-in ontologies', () => {
    expect(builtinOntologies).toHaveLength(3);
  });

  it('project ontology should have expected entity types', () => {
    const types = projectOntology.entities.map((e) => e.name);
    expect(types).toContain('Project');
    expect(types).toContain('Module');
    expect(types).toContain('Feature');
    expect(types).toContain('Dependency');
    expect(types).toContain('Release');
  });

  it('team ontology should have expected entity types', () => {
    const types = teamOntology.entities.map((e) => e.name);
    expect(types).toContain('Team');
    expect(types).toContain('Developer');
    expect(types).toContain('Role');
    expect(types).toContain('Capability');
  });

  it('agent ontology should have expected entity types', () => {
    const types = agentOntology.entities.map((e) => e.name);
    expect(types).toContain('Agent');
    expect(types).toContain('AgentRun');
    expect(types).toContain('AgentPlan');
    expect(types).toContain('Tool');
  });

  it('all built-ins should register without error', () => {
    const registry = new OntologyRegistry();
    for (const o of builtinOntologies) {
      registry.register(o);
    }
    expect(registry.list()).toHaveLength(3);
    expect(registry.listEntityTypes().length).toBeGreaterThan(10);
  });
});
