/**
 * Tests for the Idea Garden feature.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { SqliteKernelBackend } from '../../src/core/persist/sqlite-backend.js';
import { IdeaGarden } from '../../src/plugins/idea-garden/api.js';

describe('Idea Garden', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;
  let garden: IdeaGarden;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-garden-'));
    kernel = new TrellisKernel({
      backend: new SqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    kernel.boot();
    garden = new IdeaGarden(kernel);
  });

  afterEach(() => {
    kernel.close();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it('should harvest rejected and cancelled plans', async () => {
    // Active plan -> should be ignored
    await kernel.createEntity('plan:1', 'PendingPlan', {
      title: 'Active Plan',
      status: 'pending',
      createdAt: '2026-01-01',
    });

    // Rejected plan -> should be harvested
    await kernel.createEntity('plan:2', 'PendingPlan', {
      title: 'Rejected Plan',
      status: 'rejected',
      operations: '[{"kind":"create"}]',
      createdAt: '2026-01-02',
    });

    // Cancelled plan -> should be harvested
    await kernel.createEntity('plan:3', 'PendingPlan', {
      title: 'Cancelled Plan',
      status: 'cancelled',
      operations: '[]',
      createdAt: '2026-01-03',
    });

    const ideas = garden.harvestIdeas();
    expect(ideas).toHaveLength(2);

    // Filter to ensure both the rejected and cancelled plans are properly harvested.
    const harvestedIds = ideas.map((i) => i.sourceEntityId).sort();
    expect(harvestedIds).toEqual(['plan:2', 'plan:3']);
    
    // Find rejected plan
    const rejectedIdea = ideas.find(i => i.sourceEntityId === 'plan:2');
    expect(rejectedIdea).toBeDefined();
    expect(rejectedIdea?.title).toBe('Rejected Plan');
    expect(rejectedIdea?.payload?.operations).toBeDefined();
  });

  it('should harvest archived conversations', async () => {
    // Active convo -> ignored
    await kernel.createEntity('conv:1', 'Conversation', {
      title: 'Active Convo',
      status: 'active',
      createdAt: '2026-01-01',
    });

    // Archived convo -> harvested
    await kernel.createEntity('conv:2', 'Conversation', {
      title: 'Archived Convo',
      status: 'archived',
      createdAt: '2026-01-02',
    });

    const ideas = garden.harvestIdeas();
    expect(ideas).toHaveLength(1);
    expect(ideas[0].sourceType).toBe('archived_conversation');
    expect(ideas[0].sourceEntityId).toBe('conv:2');
    expect(ideas[0].title).toBe('Archived Convo');
  });

  it('should harvest decision traces with unexplored alternatives', async () => {
    // Decision with NO alternatives -> ignored
    await kernel.createEntity('trace:1', 'DecisionTrace', {
      toolName: 'myTool',
      timestamp: '2026-01-01',
    });

    // Decision with alternatives -> harvested
    await kernel.createEntity('trace:2', 'DecisionTrace', {
      toolName: 'complexTool',
      rationale: 'Seemed best.',
      alternatives: '["Alternative 1", "Alternative 2"]',
      timestamp: '2026-01-02',
    });

    const ideas = garden.harvestIdeas();
    expect(ideas).toHaveLength(1);
    expect(ideas[0].sourceType).toBe('unexplored_alternative');
    expect(ideas[0].sourceEntityId).toBe('trace:2');
    expect(ideas[0].title).toBe('Alternatives for complexTool');
    expect((ideas[0].payload?.alternatives as string[])).toHaveLength(2);
  });

  it('should be able to resurrect a rejected plan', async () => {
    await kernel.createEntity('plan:r1', 'PendingPlan', {
      title: 'Old Plan to resurrect',
      status: 'rejected',
      operations: '[{"kind":"delete"}]',
      createdAt: '2026-01-01',
    });

    const ideas = garden.harvestIdeas();
    expect(ideas).toHaveLength(1);

    const ideaId = ideas[0].id;
    const newPlanId = await garden.resurrectPlan(ideaId);

    const newPlan = kernel.listEntities('PendingPlan').find(p => p.id === newPlanId);
    expect(newPlan).toBeDefined();
    if (!newPlan) return;
    
    // Check that it cloned the data and is pending
    expect(newPlan.facts.find(f => f.a === 'status')?.v).toBe('pending');
    expect(newPlan.facts.find(f => f.a === 'operations')?.v).toBe('[{"kind":"delete"}]');
    expect(newPlan.facts.find(f => f.a === 'title')?.v).toContain('(Resurrected)');
  });
});
