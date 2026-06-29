/**
 * Room graph summary + MCP helpers.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { BetterSqliteKernelBackend } from '../../src/core/persist/better-sqlite-backend.js';
import { buildRoomGraphSummary } from '../../src/mcp/graph-summary.js';
import { resolveWriteAgentId } from '../../src/mcp/room-helpers.js';
import { McpRateLimitError, UsageMeter } from '../../src/server/usage-meter.js';
import { ANONYMOUS } from '../../src/server/auth.js';

describe('buildRoomGraphSummary', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'room-summary-'));
    const backend = new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db'));
    kernel = new TrellisKernel({
      backend,
      agentId: 'test-agent',
      snapshotThreshold: 0,
    });
    kernel.boot();
    await kernel.createEntity('note:1', 'Note', { title: 'Hello' });
    await kernel.createEntity('task:1', 'Task', { title: 'Do thing' });
    await kernel.addLink('task:1', 'assignedTo', 'note:1');
  });

  afterEach(() => {
    kernel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns compact overview from kernel state', () => {
    const summary = buildRoomGraphSummary(kernel, 'default', { limit: 5 });

    expect(summary.health.status).toBe('ok');
    expect(summary.health.entityCount).toBe(2);
    expect(summary.health.linkCount).toBe(1);
    expect(summary.entityTypes).toEqual(
      expect.arrayContaining([
        { type: 'Note', count: 1 },
        { type: 'Task', count: 1 },
      ]),
    );
    expect(summary.links.relations).toContain('assignedTo');
    expect(summary.recentMutations.length).toBeGreaterThan(0);
  });
});

describe('resolveWriteAgentId', () => {
  it('prefixes lane with agent:', () => {
    expect(resolveWriteAgentId('cursor', ANONYMOUS)).toBe('agent:cursor');
  });

  it('uses header lane when tool param omitted', () => {
    expect(resolveWriteAgentId(undefined, ANONYMOUS, 'agent:claude')).toBe(
      'agent:claude',
    );
  });
});

describe('UsageMeter rate limit', () => {
  it('throws when daily graph_io budget exceeded', () => {
    const meter = new UsageMeter({ graphIoLimit: 2 });
    meter.recordGraphIo('tenant-a');
    meter.recordGraphIo('tenant-a');
    expect(() => meter.assertGraphIoBudget('tenant-a')).toThrow(McpRateLimitError);
  });
});
