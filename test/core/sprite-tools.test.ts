/**
 * Tests for the Sprite Tools Plugin — checkpoint, rollback, deploy status,
 * ops listing, and checkpoint middleware.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { BetterSqliteKernelBackend } from '../../src/core/persist/better-sqlite-backend.js';
import { createCheckpointMiddleware } from '../../src/plugins/sprite-tools/checkpoint-middleware.js';
import {
  createCheckpointTool,
  createRollbackTool,
  createGetDeployStatusTool,
  createListOpsTool,
} from '../../src/plugins/sprite-tools/plugin.js';

// -------------------------------------------------------------------------
// Checkpoint Middleware
// -------------------------------------------------------------------------

describe('CheckpointMiddleware', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;
  let checkpointCalls: number[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-cpmw-'));
    checkpointCalls = [];

    const mw = createCheckpointMiddleware({
      threshold: 5,
      onCheckpoint: (batchSize) => {
        checkpointCalls.push(batchSize);
        kernel.checkpoint();
      },
    });

    kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
      middleware: [mw],
    });
    kernel.boot();
  });

  afterEach(() => {
    kernel.close();
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {}
  });

  it('should NOT trigger checkpoint for small mutations', async () => {
    await kernel.createEntity('a', 'Thing', { name: 'Small' });
    expect(checkpointCalls).toHaveLength(0);
  });

  it('should trigger checkpoint when batch exceeds threshold', async () => {
    // createEntity creates facts for: type, createdAt, + each attribute
    // 5 attributes + type + createdAt = 7 facts >= threshold of 5
    await kernel.createEntity('a', 'Thing', {
      f1: 'v1',
      f2: 'v2',
      f3: 'v3',
      f4: 'v4',
      f5: 'v5',
    });

    expect(checkpointCalls).toHaveLength(1);
    expect(checkpointCalls[0]).toBeGreaterThanOrEqual(5);
  });

  it('should track stats', async () => {
    const mw = createCheckpointMiddleware({ threshold: 3 });
    const k2 = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'k2.db')),
      agentId: 'test',
      middleware: [mw],
    });
    k2.boot();

    // Small mutation (type + createdAt + name = 3 → exactly at threshold)
    await k2.createEntity('x', 'Thing', { name: 'test' });

    const stats = mw.getStats();
    expect(stats.checkpointsTriggered).toBe(1);
    expect(stats.lastBatchSize).toBe(3);

    k2.close();
  });

  it('should allow mutations to proceed regardless of checkpoint', async () => {
    // Even when checkpoint triggers, the mutation should complete
    await kernel.createEntity('big', 'Task', {
      a: '1',
      b: '2',
      c: '3',
      d: '4',
      e: '5',
    });

    const entity = kernel.getEntity('big');
    expect(entity).not.toBeNull();
    expect(entity!.type).toBe('Task');
  });
});

// -------------------------------------------------------------------------
// Checkpoint Tool
// -------------------------------------------------------------------------

describe('Checkpoint Tool', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-cpt-'));
    kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    kernel.boot();
  });

  afterEach(() => {
    kernel.close();
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {}
  });

  it('should create a checkpoint and return success', async () => {
    // Create some data first
    await kernel.createEntity('task-1', 'Task', { title: 'Test' });

    const tool = createCheckpointTool({ kernel });
    const result = await tool.handler({ comment: 'Before deploy' });

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.message).toBe('Checkpoint created');
    expect(output.comment).toBe('Before deploy');
    expect(output.opHash).toBeDefined();
  });

  it('should work without a comment', async () => {
    await kernel.createEntity('x', 'Thing', {});
    const tool = createCheckpointTool({ kernel });
    const result = await tool.handler({});

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.comment).toBeUndefined();
  });
});

// -------------------------------------------------------------------------
// Rollback Tool
// -------------------------------------------------------------------------

describe('Rollback Tool', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-rb-'));
    kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    kernel.boot();
  });

  afterEach(() => {
    kernel.close();
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {}
  });

  it('should rollback to a previous state', async () => {
    // Create entity, note the op hash
    await kernel.createEntity('task-1', 'Task', { title: 'Original' });
    const opHash = kernel.getLastOp()!.hash;

    // Create more data
    await kernel.createEntity('task-2', 'Task', { title: 'Later' });

    const tool = createRollbackTool({ kernel });
    const result = await tool.handler({ opHash });

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.message).toContain('Rolled back');
    // The snapshot should have task-1 but NOT task-2
    expect(output.factCount as number).toBeGreaterThan(0);
  });

  it('should handle invalid op hash gracefully', async () => {
    const tool = createRollbackTool({ kernel });
    const result = await tool.handler({ opHash: 'trellis:op:nonexistent' });

    // timeTravel returns empty store for unknown hash — not an error
    expect(result.success).toBe(true);
  });
});

// -------------------------------------------------------------------------
// Deploy Status Tool
// -------------------------------------------------------------------------

describe('Deploy Status Tool', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-ds-'));
    kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    kernel.boot();
  });

  afterEach(() => {
    kernel.close();
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {}
  });

  it('should report when no config exists', async () => {
    const tool = createGetDeployStatusTool({ kernel, configDir: tmpDir });
    const result = await tool.handler({});

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.deployed).toBe(false);
  });

  it('should read local config', async () => {
    // Write a local config
    writeFileSync(
      join(tmpDir, '.trellis-db.json'),
      JSON.stringify({ mode: 'local', port: 3000 }),
    );

    const tool = createGetDeployStatusTool({ kernel, configDir: tmpDir });
    const result = await tool.handler({});

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.deployed).toBe(false);
    expect(output.mode).toBe('local');
    expect(output.port).toBe(3000);
  });

  it('should report remote deployment', async () => {
    writeFileSync(
      join(tmpDir, '.trellis-db.json'),
      JSON.stringify({
        mode: 'remote',
        url: 'https://test-app.sprites.app',
        spriteName: 'test-app',
        deployedAt: '2026-04-01T00:00:00Z',
      }),
    );

    const tool = createGetDeployStatusTool({ kernel, configDir: tmpDir });
    const result = await tool.handler({});

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.deployed).toBe(true);
    expect(output.mode).toBe('remote');
    expect(output.url).toBe('https://test-app.sprites.app');
    expect(output.spriteName).toBe('test-app');
  });
});

// -------------------------------------------------------------------------
// List Ops Tool
// -------------------------------------------------------------------------

describe('List Ops Tool', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-ops-'));
    kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    kernel.boot();
  });

  afterEach(() => {
    kernel.close();
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {}
  });

  it('should list recent ops', async () => {
    await kernel.createEntity('a', 'Thing', {});
    await kernel.createEntity('b', 'Thing', {});
    await kernel.createEntity('c', 'Thing', {});

    const tool = createListOpsTool({ kernel });
    const result = await tool.handler({});

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.total).toBe(3);
    expect(output.showing).toBe(3);
    expect((output.ops as any[]).length).toBe(3);
  });

  it('should respect the limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await kernel.createEntity(`e-${i}`, 'Thing', {});
    }

    const tool = createListOpsTool({ kernel });
    const result = await tool.handler({ limit: 3 });

    const output = result.output as Record<string, unknown>;
    expect(output.total).toBe(10);
    expect(output.showing).toBe(3);
  });

  it('should include op metadata', async () => {
    await kernel.createEntity('x', 'Task', { title: 'Test' });

    const tool = createListOpsTool({ kernel });
    const result = await tool.handler({});

    const ops = (result.output as any).ops;
    expect(ops[0].hash).toBeDefined();
    expect(ops[0].kind).toBeDefined();
    expect(ops[0].timestamp).toBeDefined();
    expect(ops[0].agentId).toBe('test-agent');
    expect(ops[0].factsCount).toBeGreaterThan(0);
  });
});
