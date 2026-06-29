/**
 * Tests for TrellisKernel — generic graph kernel
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { BetterSqliteKernelBackend } from '../../src/core/persist/better-sqlite-backend.js';
import type { KernelMiddleware } from '../../src/core/kernel/middleware.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TrellisKernel', () => {
  let tmpDir: string;
  let backend: BetterSqliteKernelBackend;
  let kernel: TrellisKernel;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-kernel-'));
    backend = new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db'));
    kernel = new TrellisKernel({
      backend,
      agentId: 'test-agent',
      snapshotThreshold: 0,
    });
    kernel.boot();
  });

  afterEach(() => {
    kernel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  it('should boot successfully', () => {
    expect(kernel.isBooted()).toBe(true);
  });

  it('should replay ops on boot', async () => {
    // Create some entities
    await kernel.createEntity('user:1', 'User', { name: 'Alice' });
    await kernel.createEntity('user:2', 'User', { name: 'Bob' });

    // Create a new kernel on the same database
    const kernel2 = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    const { opsReplayed } = kernel2.boot();
    expect(opsReplayed).toBe(2);

    const alice = kernel2.getEntity('user:1');
    expect(alice).not.toBeNull();
    expect(alice!.facts.find((f) => f.a === 'name')?.v).toBe('Alice');

    kernel2.close();
  });

  // -----------------------------------------------------------------------
  // Entity CRUD
  // -----------------------------------------------------------------------

  it('should create an entity', async () => {
    const result = await kernel.createEntity('project:1', 'Project', {
      name: 'My Project',
      description: 'A test project',
    });

    expect(result.op.hash).toMatch(/^trellis:op:/);
    expect(result.factsDelta.added).toBeGreaterThan(0);

    const entity = kernel.getEntity('project:1');
    expect(entity).not.toBeNull();
    expect(entity!.type).toBe('Project');
    expect(entity!.facts.find((f) => f.a === 'name')?.v).toBe('My Project');
  });

  it('should not inject ISO createdAt when caller supplies createdAt', async () => {
    const ts = Date.now();
    await kernel.createEntity('message:1', 'message', {
      room: 'lobby',
      createdAt: ts,
    });

    const createdFacts = kernel.getEntity('message:1')!.facts.filter((f) => f.a === 'createdAt');
    expect(createdFacts).toHaveLength(1);
    expect(createdFacts[0].v).toBe(ts);
  });

  it('should create an entity with links', async () => {
    await kernel.createEntity('team:1', 'Team', { name: 'Core Team' });
    await kernel.createEntity('user:1', 'User', { name: 'Alice' }, [
      { attribute: 'memberOf', targetEntityId: 'team:1' },
    ]);

    const user = kernel.getEntity('user:1');
    expect(user).not.toBeNull();
    expect(user!.links.find((l) => l.a === 'memberOf')?.e2).toBe('team:1');
  });

  it('should return null for non-existent entity', () => {
    expect(kernel.getEntity('nonexistent')).toBeNull();
  });

  it('should update an entity', async () => {
    await kernel.createEntity('user:1', 'User', { name: 'Alice', age: 30 });

    await kernel.updateEntity('user:1', { name: 'Alicia', age: 31 });

    const entity = kernel.getEntity('user:1');
    expect(entity!.facts.filter((f) => f.a === 'name').pop()?.v).toBe('Alicia');
    expect(entity!.facts.filter((f) => f.a === 'age').pop()?.v).toBe(31);
  });

  it('should delete an entity', async () => {
    await kernel.createEntity('user:1', 'User', { name: 'Alice' });
    expect(kernel.getEntity('user:1')).not.toBeNull();

    await kernel.deleteEntity('user:1');
    expect(kernel.getEntity('user:1')).toBeNull();
  });

  it('should list entities by type', async () => {
    await kernel.createEntity('user:1', 'User', { name: 'Alice' });
    await kernel.createEntity('user:2', 'User', { name: 'Bob' });
    await kernel.createEntity('team:1', 'Team', { name: 'Core' });

    const users = kernel.listEntities('User');
    expect(users).toHaveLength(2);

    const teams = kernel.listEntities('Team');
    expect(teams).toHaveLength(1);
  });

  it('should list entities with filters', async () => {
    await kernel.createEntity('user:1', 'User', {
      name: 'Alice',
      role: 'admin',
    });
    await kernel.createEntity('user:2', 'User', { name: 'Bob', role: 'dev' });
    await kernel.createEntity('user:3', 'User', {
      name: 'Charlie',
      role: 'admin',
    });

    const admins = kernel.listEntities('User', { role: 'admin' });
    expect(admins).toHaveLength(2);
    expect(admins.map((e) => e.id).sort()).toEqual(['user:1', 'user:3']);
  });

  it('should list all entities when no type specified', async () => {
    await kernel.createEntity('user:1', 'User', { name: 'Alice' });
    await kernel.createEntity('team:1', 'Team', { name: 'Core' });

    const all = kernel.listEntities();
    expect(all).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // Links
  // -----------------------------------------------------------------------

  it('should add a link', async () => {
    await kernel.createEntity('user:1', 'User', { name: 'Alice' });
    await kernel.createEntity('team:1', 'Team', { name: 'Core' });

    await kernel.addLink('user:1', 'memberOf', 'team:1');

    const entity = kernel.getEntity('user:1');
    const link = entity!.links.find(
      (l) => l.a === 'memberOf' && l.e2 === 'team:1',
    );
    expect(link).toBeDefined();
  });

  it('should remove a link', async () => {
    await kernel.createEntity('user:1', 'User', { name: 'Alice' });
    await kernel.createEntity('team:1', 'Team', { name: 'Core' });
    await kernel.addLink('user:1', 'memberOf', 'team:1');

    await kernel.removeLink('user:1', 'memberOf', 'team:1');

    const entity = kernel.getEntity('user:1');
    const link = entity!.links.find(
      (l) => l.a === 'memberOf' && l.e2 === 'team:1',
    );
    expect(link).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Facts
  // -----------------------------------------------------------------------

  it('should add a fact', async () => {
    await kernel.createEntity('user:1', 'User', { name: 'Alice' });
    await kernel.addFact('user:1', 'email', 'alice@example.com');

    const entity = kernel.getEntity('user:1');
    const email = entity!.facts.find((f) => f.a === 'email');
    expect(email?.v).toBe('alice@example.com');
  });

  it('should remove a fact', async () => {
    await kernel.createEntity('user:1', 'User', { name: 'Alice' });
    await kernel.removeFact('user:1', 'name', 'Alice');

    const entity = kernel.getEntity('user:1');
    const name = entity!.facts.find((f) => f.a === 'name');
    expect(name).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Snapshots / Time Travel
  // -----------------------------------------------------------------------

  it('should checkpoint and restore', async () => {
    await kernel.createEntity('user:1', 'User', { name: 'Alice' });
    kernel.checkpoint();

    await kernel.createEntity('user:2', 'User', { name: 'Bob' });

    // New kernel boots from snapshot + replays remaining ops
    const kernel2 = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    const { opsReplayed, fromSnapshot } = kernel2.boot();
    expect(fromSnapshot).toBe(true);
    expect(opsReplayed).toBe(1); // only Bob's op replayed

    expect(kernel2.getEntity('user:1')).not.toBeNull();
    expect(kernel2.getEntity('user:2')).not.toBeNull();

    kernel2.close();
  });

  it('should time-travel to a specific op', async () => {
    const r1 = await kernel.createEntity('user:1', 'User', { name: 'Alice' });
    await kernel.createEntity('user:2', 'User', { name: 'Bob' });

    const pastStore = kernel.timeTravel(r1.op.hash);
    // At r1, only Alice should exist
    const aliceFacts = pastStore.getFactsByEntity('user:1');
    expect(aliceFacts.length).toBeGreaterThan(0);

    const bobFacts = pastStore.getFactsByEntity('user:2');
    expect(bobFacts.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Middleware
  // -----------------------------------------------------------------------

  it('should run middleware on mutations', async () => {
    const log: string[] = [];
    const loggingMiddleware: KernelMiddleware = {
      name: 'test-logger',
      handleOp: async (op, ctx, next) => {
        log.push(`before:${op.kind}`);
        await next(op, ctx);
        log.push(`after:${op.kind}`);
      },
    };

    kernel.addMiddleware(loggingMiddleware);
    await kernel.createEntity('user:1', 'User', { name: 'Alice' });

    expect(log).toEqual(['before:addFacts', 'after:addFacts']);
  });

  it('should allow middleware to block operations', async () => {
    const blockMiddleware: KernelMiddleware = {
      name: 'blocker',
      handleOp: async (_op, _ctx, _next) => {
        throw new Error('Blocked by policy');
      },
    };

    kernel.addMiddleware(blockMiddleware);

    await expect(
      kernel.createEntity('user:1', 'User', { name: 'Alice' }),
    ).rejects.toThrow('Blocked by policy');
  });

  it('should remove middleware by name', async () => {
    const mw: KernelMiddleware = {
      name: 'temp',
      handleOp: async (_op, _ctx, _next) => {
        throw new Error('Should not fire');
      },
    };

    kernel.addMiddleware(mw);
    kernel.removeMiddleware('temp');

    // Should succeed because middleware was removed
    await kernel.createEntity('user:1', 'User', { name: 'Alice' });
    expect(kernel.getEntity('user:1')).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Delete survives reboot (regression)
  // -----------------------------------------------------------------------

  it('should persist deletes across reboot', async () => {
    await kernel.createEntity('user:1', 'User', { name: 'Alice' });
    await kernel.createEntity('user:2', 'User', { name: 'Bob' });
    await kernel.deleteEntity('user:1');

    // Reboot on same DB
    const kernel2 = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    kernel2.boot();

    expect(kernel2.getEntity('user:1')).toBeNull();
    expect(kernel2.getEntity('user:2')).not.toBeNull();

    const entities = kernel2.listEntities('User');
    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe('user:2');

    kernel2.close();
  });

  // -----------------------------------------------------------------------
  // Auto-snapshot
  // -----------------------------------------------------------------------

  it('should auto-snapshot at threshold', async () => {
    kernel.close();

    const autoKernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'auto.db')),
      agentId: 'test-agent',
      snapshotThreshold: 3,
    });
    autoKernel.boot();

    await autoKernel.createEntity('e:1', 'T', { x: 1 });
    await autoKernel.createEntity('e:2', 'T', { x: 2 });
    await autoKernel.createEntity('e:3', 'T', { x: 3 }); // triggers snapshot

    // Verify snapshot exists by booting a new kernel
    const k2 = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'auto.db')),
      agentId: 'test-agent',
    });
    const { fromSnapshot } = k2.boot();
    expect(fromSnapshot).toBe(true);

    autoKernel.close();
    k2.close();
  });
});
