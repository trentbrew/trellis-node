/**
 * Tests for the Plan Approval Plugin — PlanManager, operation buffering,
 * approval/rejection, and graph persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { BetterSqliteKernelBackend } from '../../src/core/persist/better-sqlite-backend.js';
import { PluginRegistry } from '../../src/core/plugins/registry.js';
import { OntologyRegistry } from '../../src/core/ontology/registry.js';
import { createPlanApprovalPlugin } from '../../src/plugins/plan-approval/plugin.js';
import { PlanManager } from '../../src/plugins/plan-approval/plan-manager.js';

describe('Plan Approval Plugin', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;
  let pluginRegistry: PluginRegistry;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-plan-'));
    kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    kernel.boot();

    pluginRegistry = new PluginRegistry();
    const plugin = createPlanApprovalPlugin();
    pluginRegistry.register(plugin);
    await pluginRegistry.load(
      'trellis:plan-approval',
      kernel,
      new OntologyRegistry(),
    );
  });

  afterEach(() => {
    kernel.close();
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {}
  });

  it('should register the plugin successfully', () => {
    expect(pluginRegistry.isLoaded('trellis:plan-approval')).toBe(true);
  });
});

describe('PlanManager', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;
  let pm: PlanManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-pm-'));
    kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    kernel.boot();
    pm = new PlanManager(kernel);
  });

  afterEach(() => {
    kernel.close();
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {}
  });

  // -------------------------------------------------------------------------
  // Plan mode lifecycle
  // -------------------------------------------------------------------------

  it('should enter plan mode and create a PendingPlan entity', async () => {
    const planId = await pm.enterPlanMode('Bulk task import');

    expect(planId).toMatch(/^plan:/);
    expect(pm.isInPlanMode()).toBe(true);

    const entity = kernel.getEntity(planId);
    expect(entity).not.toBeNull();
    expect(entity!.type).toBe('PendingPlan');
    const title = entity!.facts.find((f) => f.a === 'title')?.v;
    expect(title).toBe('Bulk task import');
  });

  it('should prevent entering plan mode twice', async () => {
    await pm.enterPlanMode('Plan A');
    await expect(pm.enterPlanMode('Plan B')).rejects.toThrow(
      'Already in plan mode',
    );
  });

  it('should not be in plan mode initially', () => {
    expect(pm.isInPlanMode()).toBe(false);
    expect(pm.getActivePlan()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Buffering operations
  // -------------------------------------------------------------------------

  it('should buffer createEntity operations', async () => {
    await pm.enterPlanMode('Create tasks');

    const opId = await pm.planCreateEntity('task-1', 'Task', {
      title: 'Buy milk',
    });

    expect(opId).toMatch(/op:0$/);
    const plan = pm.getActivePlan()!;
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0].kind).toBe('createEntity');
    expect(plan.operations[0].entityId).toBe('task-1');
    expect(plan.operations[0].entityType).toBe('Task');
    expect(plan.operations[0].attributes).toEqual({ title: 'Buy milk' });
  });

  it('should buffer multiple operations in sequence', async () => {
    await pm.enterPlanMode('Setup project');

    await pm.planCreateEntity('proj-1', 'Project', { name: 'Alpha' });
    await pm.planCreateEntity('task-1', 'Task', { title: 'Design' });
    await pm.planAddLink('proj-1', 'hasTask', 'task-1');

    const plan = pm.getActivePlan()!;
    expect(plan.operations).toHaveLength(3);
    expect(plan.operations[0].sequence).toBe(0);
    expect(plan.operations[1].sequence).toBe(1);
    expect(plan.operations[2].sequence).toBe(2);
    expect(plan.operations[2].kind).toBe('addLink');
  });

  it('should persist operations as graph entities', async () => {
    await pm.enterPlanMode('Test persistence');
    await pm.planCreateEntity('entity-1', 'Thing', { name: 'Test' });

    const ops = kernel.listEntities('PlannedOperation');
    expect(ops).toHaveLength(1);
    const opEntity = ops[0];
    const kind = opEntity.facts.find((f) => f.a === 'kind')?.v;
    expect(kind).toBe('createEntity');
  });

  it('should link operations to the plan', async () => {
    const planId = await pm.enterPlanMode('Linked test');
    await pm.planCreateEntity('e-1', 'Thing', { x: 1 });
    await pm.planCreateEntity('e-2', 'Thing', { x: 2 });

    const store = kernel.getStore();
    const links = store.getLinksByEntityAndAttribute(planId, 'hasOperation');
    expect(links).toHaveLength(2);
  });

  it('should throw when buffering without plan mode', async () => {
    await expect(pm.planCreateEntity('x', 'Thing', {})).rejects.toThrow(
      'Not in plan mode',
    );
  });

  it('should NOT mutate the graph when buffering', async () => {
    await pm.enterPlanMode('No side effects');
    await pm.planCreateEntity('ghost-entity', 'Task', { title: 'Ghost' });

    // The entity should NOT exist in the graph
    const entity = kernel.getEntity('ghost-entity');
    expect(entity).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  it('should submit a plan and change status to submitted', async () => {
    await pm.enterPlanMode('Submittable');
    await pm.planCreateEntity('x', 'Thing', {});

    const submitted = await pm.submitPlan();

    expect(submitted.status).toBe('submitted');
    expect(submitted.submittedAt).toBeDefined();
    expect(submitted.operations).toHaveLength(1);
    expect(pm.isInPlanMode()).toBe(false); // No longer drafting
  });

  it('should persist submitted status to graph', async () => {
    const planId = await pm.enterPlanMode('Persist test');
    await pm.planCreateEntity('x', 'Thing', {});
    await pm.submitPlan();

    const entity = kernel.getEntity(planId);
    const status = entity!.facts.find((f) => f.a === 'status')?.v;
    expect(status).toBe('submitted');
  });

  it('should reject submitting an empty plan', async () => {
    await pm.enterPlanMode('Empty');
    await expect(pm.submitPlan()).rejects.toThrow('empty plan');
  });

  // -------------------------------------------------------------------------
  // Approve
  // -------------------------------------------------------------------------

  it('should execute all operations on approval', async () => {
    await pm.enterPlanMode('Approve test');
    await pm.planCreateEntity('task-1', 'Task', { title: 'Buy milk' });
    await pm.planCreateEntity('task-2', 'Task', { title: 'Walk dog' });
    await pm.planAddLink('task-1', 'dependsOn', 'task-2');
    await pm.submitPlan();

    const result = await pm.approvePlan('user:trent');

    expect(result.operationsExecuted).toBe(3);
    expect(result.results).toHaveLength(3);

    // Verify entities now exist in the graph
    const task1 = kernel.getEntity('task-1');
    expect(task1).not.toBeNull();
    expect(task1!.type).toBe('Task');
    const title = task1!.facts.find((f) => f.a === 'title')?.v;
    expect(title).toBe('Buy milk');

    const task2 = kernel.getEntity('task-2');
    expect(task2).not.toBeNull();

    // Verify link exists
    const store = kernel.getStore();
    const links = store.getLinksByEntityAndAttribute('task-1', 'dependsOn');
    expect(links).toHaveLength(1);
    expect(links[0].e2).toBe('task-2');
  });

  it('should mark plan as approved after execution', async () => {
    const planId = await pm.enterPlanMode('Status test');
    await pm.planCreateEntity('x', 'Thing', {});
    await pm.submitPlan();
    await pm.approvePlan('user:admin');

    const entity = kernel.getEntity(planId);
    const status = entity!.facts.find((f) => f.a === 'status')?.v;
    expect(status).toBe('approved');
    const resolvedBy = entity!.facts.find((f) => f.a === 'resolvedBy')?.v;
    expect(resolvedBy).toBe('user:admin');
  });

  it('should clear active plan after approval', async () => {
    await pm.enterPlanMode('Clear test');
    await pm.planCreateEntity('x', 'Thing', {});
    await pm.submitPlan();
    await pm.approvePlan();

    expect(pm.getActivePlan()).toBeNull();
    expect(pm.isInPlanMode()).toBe(false);
  });

  it('should reject approving without a submitted plan', async () => {
    await expect(pm.approvePlan()).rejects.toThrow('No submitted plan');
  });

  // -------------------------------------------------------------------------
  // Reject
  // -------------------------------------------------------------------------

  it('should reject a plan and preserve it in the graph', async () => {
    const planId = await pm.enterPlanMode('Rejectable');
    await pm.planCreateEntity('task-1', 'Task', { title: 'Bad idea' });
    await pm.submitPlan();

    await pm.rejectPlan('Not the right approach', 'user:trent');

    // Entity should NOT have been created
    expect(kernel.getEntity('task-1')).toBeNull();

    // Plan entity should still exist with rejected status
    const entity = kernel.getEntity(planId);
    expect(entity).not.toBeNull();
    const status = entity!.facts.find((f) => f.a === 'status')?.v;
    expect(status).toBe('rejected');
    const reason = entity!.facts.find((f) => f.a === 'rejectionReason')?.v;
    expect(reason).toBe('Not the right approach');
  });

  it('should clear active plan after rejection', async () => {
    await pm.enterPlanMode('Clear reject');
    await pm.planCreateEntity('x', 'Thing', {});
    await pm.submitPlan();
    await pm.rejectPlan();

    expect(pm.getActivePlan()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------

  it('should cancel a drafting plan', async () => {
    const planId = await pm.enterPlanMode('Cancellable');
    await pm.planCreateEntity('x', 'Thing', {});
    await pm.cancelPlan();

    expect(pm.isInPlanMode()).toBe(false);
    expect(pm.getActivePlan()).toBeNull();

    // Plan should be marked as rejected in graph
    const entity = kernel.getEntity(planId);
    const status = entity!.facts.find((f) => f.a === 'status')?.v;
    expect(status).toBe('rejected');
  });

  it('should allow entering plan mode after cancellation', async () => {
    await pm.enterPlanMode('First');
    await pm.cancelPlan();

    const planId = await pm.enterPlanMode('Second');
    expect(planId).toMatch(/^plan:/);
    expect(pm.isInPlanMode()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Query helpers
  // -------------------------------------------------------------------------

  it('should load a plan from the graph', async () => {
    const planId = await pm.enterPlanMode('Loadable');
    await pm.planCreateEntity('e-1', 'Task', { title: 'A' });
    await pm.planCreateEntity('e-2', 'Task', { title: 'B' });
    await pm.submitPlan();

    // Load from graph (as if from a fresh PlanManager instance)
    const pm2 = new PlanManager(kernel);
    const loaded = pm2.loadPlan(planId);

    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe('Loadable');
    expect(loaded!.status).toBe('submitted');
    expect(loaded!.operations).toHaveLength(2);
    expect(loaded!.operations[0].entityId).toBe('e-1');
    expect(loaded!.operations[1].entityId).toBe('e-2');
  });

  it('should list plans by status', async () => {
    // Create and submit one plan
    await pm.enterPlanMode('Plan A');
    await pm.planCreateEntity('x', 'Thing', {});
    await pm.submitPlan();
    await pm.approvePlan();

    // Create and reject another
    await pm.enterPlanMode('Plan B');
    await pm.planCreateEntity('y', 'Thing', {});
    await pm.submitPlan();
    await pm.rejectPlan('nope');

    const approved = pm.listPlans('approved');
    expect(approved).toHaveLength(1);
    expect(approved[0].title).toBe('Plan A');

    const rejected = pm.listPlans('rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].title).toBe('Plan B');

    const all = pm.listPlans();
    expect(all).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Convenience buffers
  // -------------------------------------------------------------------------

  it('should buffer updateEntity operations', async () => {
    // First create a real entity to update later
    await kernel.createEntity('existing-1', 'Task', { title: 'Old' });

    await pm.enterPlanMode('Update plan');
    await pm.planUpdateEntity('existing-1', { title: 'New' });
    await pm.submitPlan();
    await pm.approvePlan();

    const entity = kernel.getEntity('existing-1');
    const title = entity!.facts.find((f) => f.a === 'title')?.v;
    expect(title).toBe('New');
  });

  it('should buffer deleteEntity operations', async () => {
    await kernel.createEntity('doomed-1', 'Task', { title: 'Delete me' });

    await pm.enterPlanMode('Delete plan');
    await pm.planDeleteEntity('doomed-1');
    await pm.submitPlan();

    // Not deleted yet (still submitted, not approved)
    expect(kernel.getEntity('doomed-1')).not.toBeNull();

    await pm.approvePlan();

    // Now deleted
    expect(kernel.getEntity('doomed-1')).toBeNull();
  });

  it('should buffer removeLink operations', async () => {
    await kernel.createEntity('a', 'Thing', {});
    await kernel.createEntity('b', 'Thing', {});
    await kernel.addLink('a', 'relatedTo', 'b');

    await pm.enterPlanMode('Unlink plan');
    await pm.planRemoveLink('a', 'relatedTo', 'b');
    await pm.submitPlan();
    await pm.approvePlan();

    const store = kernel.getStore();
    const links = store.getLinksByEntityAndAttribute('a', 'relatedTo');
    expect(links).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Operation descriptions
  // -------------------------------------------------------------------------

  it('should auto-generate operation descriptions', async () => {
    await pm.enterPlanMode('Descriptions');
    await pm.planCreateEntity('task-1', 'Task', { title: 'Foo' });
    await pm.planAddLink('proj-1', 'hasTask', 'task-1');

    const plan = pm.getActivePlan()!;
    expect(plan.operations[0].description).toContain('Create Task');
    expect(plan.operations[1].description).toContain('Link');
  });
});
