/**
 * Plan Manager — Coordinates multi-turn planning with buffered mutations.
 *
 * When plan mode is active, the PlanManager buffers intended graph operations
 * as structured data instead of executing them. On approval, it replays them
 * as real kernel calls. On rejection, the plan is preserved as an entity for
 * the Idea Garden.
 *
 * @module trellis/plugins/plan-approval
 */

import type { TrellisKernel, MutateResult } from '../../core/kernel/trellis-kernel.js';
import type { Atom } from '../../core/store/eav-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OperationKind = 'createEntity' | 'updateEntity' | 'deleteEntity' | 'addLink' | 'removeLink';

export interface PlannedOperation {
  id: string;
  kind: OperationKind;
  entityId?: string;
  entityType?: string;
  attributes?: Record<string, Atom>;
  sourceId?: string;
  targetId?: string;
  linkAttribute?: string;
  description?: string;
  sequence: number;
}

export type PlanStatus = 'drafting' | 'submitted' | 'approved' | 'rejected';

export interface PendingPlan {
  id: string;
  status: PlanStatus;
  title: string;
  description?: string;
  operations: PlannedOperation[];
  createdAt: string;
  submittedAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  rejectionReason?: string;
}

export interface ApprovalResult {
  planId: string;
  operationsExecuted: number;
  results: MutateResult[];
}

// ---------------------------------------------------------------------------
// Global counter for unique IDs
// ---------------------------------------------------------------------------

let planIdCounter = 0;

// ---------------------------------------------------------------------------
// Plan Manager
// ---------------------------------------------------------------------------

export class PlanManager {
  private kernel: TrellisKernel;
  private activePlan: PendingPlan | null = null;

  constructor(kernel: TrellisKernel) {
    this.kernel = kernel;
  }

  // -------------------------------------------------------------------------
  // Plan mode lifecycle
  // -------------------------------------------------------------------------

  /**
   * Enter plan mode. Creates a PendingPlan entity in the graph and sets it
   * as the active plan. All subsequent `addOperation()` calls buffer into it.
   */
  async enterPlanMode(title: string, description?: string): Promise<string> {
    if (this.activePlan && this.activePlan.status === 'drafting') {
      throw new Error('PlanManager: Already in plan mode. Submit or cancel the current plan first.');
    }

    const id = `plan:${Date.now()}:${++planIdCounter}`;
    const now = new Date().toISOString();

    const plan: PendingPlan = {
      id,
      status: 'drafting',
      title,
      description,
      operations: [],
      createdAt: now,
    };

    // Persist to graph
    const attrs: Record<string, Atom> = {
      title,
      status: 'drafting',
    };
    if (description) attrs.description = description;
    attrs.operationCount = 0;
    await this.kernel.createEntity(id, 'PendingPlan', attrs);

    this.activePlan = plan;
    return id;
  }

  /**
   * Whether a plan is currently being drafted.
   */
  isInPlanMode(): boolean {
    return this.activePlan !== null && this.activePlan.status === 'drafting';
  }

  /**
   * Get the active plan (if any).
   */
  getActivePlan(): PendingPlan | null {
    return this.activePlan;
  }

  // -------------------------------------------------------------------------
  // Buffer operations
  // -------------------------------------------------------------------------

  /**
   * Buffer a planned graph operation. Only valid in plan mode.
   * Returns the operation ID.
   */
  async addOperation(op: Omit<PlannedOperation, 'id' | 'sequence'>): Promise<string> {
    if (!this.activePlan || this.activePlan.status !== 'drafting') {
      throw new Error('PlanManager: Not in plan mode. Call enterPlanMode() first.');
    }

    const sequence = this.activePlan.operations.length;
    const opId = `${this.activePlan.id}:op:${sequence}`;

    const planned: PlannedOperation = {
      ...op,
      id: opId,
      sequence,
    };

    this.activePlan.operations.push(planned);

    // Persist operation as a graph entity linked to the plan
    const attrs: Record<string, Atom> = {
      kind: op.kind,
      sequence,
    };
    if (op.entityId) attrs.entityId = op.entityId;
    if (op.entityType) attrs.entityType = op.entityType;
    if (op.attributes) attrs.attributes = JSON.stringify(op.attributes);
    if (op.sourceId) attrs.sourceId = op.sourceId;
    if (op.targetId) attrs.targetId = op.targetId;
    if (op.linkAttribute) attrs.linkAttribute = op.linkAttribute;
    if (op.description) attrs.description = op.description;

    await this.kernel.createEntity(opId, 'PlannedOperation', attrs);
    await this.kernel.addLink(this.activePlan.id, 'hasOperation', opId);

    // Update operation count on the plan
    await this.kernel.updateEntity(this.activePlan.id, {
      operationCount: this.activePlan.operations.length,
    });

    return opId;
  }

  // -------------------------------------------------------------------------
  // Convenience buffers (mirror the kernel entity API)
  // -------------------------------------------------------------------------

  async planCreateEntity(
    entityId: string,
    entityType: string,
    attributes?: Record<string, Atom>,
    description?: string,
  ): Promise<string> {
    return this.addOperation({
      kind: 'createEntity',
      entityId,
      entityType,
      attributes,
      description: description ?? `Create ${entityType} "${entityId}"`,
    });
  }

  async planUpdateEntity(
    entityId: string,
    attributes: Record<string, Atom>,
    description?: string,
  ): Promise<string> {
    return this.addOperation({
      kind: 'updateEntity',
      entityId,
      attributes,
      description: description ?? `Update "${entityId}"`,
    });
  }

  async planDeleteEntity(entityId: string, description?: string): Promise<string> {
    return this.addOperation({
      kind: 'deleteEntity',
      entityId,
      description: description ?? `Delete "${entityId}"`,
    });
  }

  async planAddLink(
    sourceId: string,
    linkAttribute: string,
    targetId: string,
    description?: string,
  ): Promise<string> {
    return this.addOperation({
      kind: 'addLink',
      sourceId,
      targetId,
      linkAttribute,
      description: description ?? `Link ${sourceId} -[${linkAttribute}]-> ${targetId}`,
    });
  }

  async planRemoveLink(
    sourceId: string,
    linkAttribute: string,
    targetId: string,
    description?: string,
  ): Promise<string> {
    return this.addOperation({
      kind: 'removeLink',
      sourceId,
      targetId,
      linkAttribute,
      description: description ?? `Unlink ${sourceId} -[${linkAttribute}]-> ${targetId}`,
    });
  }

  // -------------------------------------------------------------------------
  // Plan resolution
  // -------------------------------------------------------------------------

  /**
   * Submit the active plan for review. Marks it as submitted and returns
   * the plan for the caller to present to the user.
   */
  async submitPlan(): Promise<PendingPlan> {
    if (!this.activePlan || this.activePlan.status !== 'drafting') {
      throw new Error('PlanManager: No active plan to submit.');
    }

    if (this.activePlan.operations.length === 0) {
      throw new Error('PlanManager: Cannot submit an empty plan.');
    }

    const now = new Date().toISOString();
    this.activePlan.status = 'submitted';
    this.activePlan.submittedAt = now;

    await this.kernel.updateEntity(this.activePlan.id, {
      status: 'submitted',
      submittedAt: now,
    });

    return { ...this.activePlan };
  }

  /**
   * Approve a submitted plan. Replays all buffered operations against the
   * real kernel in sequence order. Returns the results of each operation.
   */
  async approvePlan(resolvedBy?: string): Promise<ApprovalResult> {
    if (!this.activePlan || this.activePlan.status !== 'submitted') {
      throw new Error('PlanManager: No submitted plan to approve.');
    }

    const plan = this.activePlan;
    const now = new Date().toISOString();
    const results: MutateResult[] = [];

    // Sort by sequence to ensure correct order
    const ops = [...plan.operations].sort((a, b) => a.sequence - b.sequence);

    for (const op of ops) {
      const result = await this._executeOperation(op);
      if (result) results.push(result);
    }

    plan.status = 'approved';
    plan.resolvedAt = now;
    plan.resolvedBy = resolvedBy;

    await this.kernel.updateEntity(plan.id, {
      status: 'approved',
      resolvedAt: now,
      ...(resolvedBy ? { resolvedBy } : {}),
    });

    this.activePlan = null;

    return {
      planId: plan.id,
      operationsExecuted: results.length,
      results,
    };
  }

  /**
   * Reject a submitted plan. The plan and its operations remain in the graph
   * as entities, preserving them as substrate for the Idea Garden (Phase 6).
   */
  async rejectPlan(reason?: string, resolvedBy?: string): Promise<void> {
    if (!this.activePlan || this.activePlan.status !== 'submitted') {
      throw new Error('PlanManager: No submitted plan to reject.');
    }

    const now = new Date().toISOString();
    this.activePlan.status = 'rejected';
    this.activePlan.resolvedAt = now;
    this.activePlan.resolvedBy = resolvedBy;
    this.activePlan.rejectionReason = reason;

    const updates: Record<string, Atom> = {
      status: 'rejected',
      resolvedAt: now,
    };
    if (reason) updates.rejectionReason = reason;
    if (resolvedBy) updates.resolvedBy = resolvedBy;

    await this.kernel.updateEntity(this.activePlan.id, updates);
    this.activePlan = null;
  }

  /**
   * Cancel a drafting plan without submitting. Like rejection but for
   * plans that were never submitted.
   */
  async cancelPlan(): Promise<void> {
    if (!this.activePlan || this.activePlan.status !== 'drafting') {
      throw new Error('PlanManager: No active plan to cancel.');
    }

    await this.kernel.updateEntity(this.activePlan.id, {
      status: 'rejected',
      resolvedAt: new Date().toISOString(),
      rejectionReason: 'Cancelled before submission',
    });

    this.activePlan = null;
  }

  // -------------------------------------------------------------------------
  // Query helpers
  // -------------------------------------------------------------------------

  /**
   * Load a plan from the graph by ID, including its operations.
   */
  loadPlan(planId: string): PendingPlan | null {
    const entity = this.kernel.getEntity(planId);
    if (!entity || entity.type !== 'PendingPlan') return null;

    const get = (a: string) => entity.facts.find(f => f.a === a)?.v;
    const store = this.kernel.getStore();
    const opLinks = store.getLinksByEntityAndAttribute(planId, 'hasOperation');

    const operations: PlannedOperation[] = [];
    for (const link of opLinks) {
      const opEntity = this.kernel.getEntity(link.e2);
      if (!opEntity || opEntity.type !== 'PlannedOperation') continue;

      const opGet = (a: string) => opEntity.facts.find(f => f.a === a)?.v;
      let attributes: Record<string, Atom> | undefined;
      const attrsRaw = opGet('attributes') as string | undefined;
      if (attrsRaw) {
        try { attributes = JSON.parse(attrsRaw); } catch {}
      }

      operations.push({
        id: opEntity.id,
        kind: opGet('kind') as OperationKind,
        entityId: opGet('entityId') as string | undefined,
        entityType: opGet('entityType') as string | undefined,
        attributes,
        sourceId: opGet('sourceId') as string | undefined,
        targetId: opGet('targetId') as string | undefined,
        linkAttribute: opGet('linkAttribute') as string | undefined,
        description: opGet('description') as string | undefined,
        sequence: (opGet('sequence') as number) ?? 0,
      });
    }

    operations.sort((a, b) => a.sequence - b.sequence);

    return {
      id: planId,
      status: (get('status') as PlanStatus) ?? 'drafting',
      title: String(get('title') ?? ''),
      description: get('description') as string | undefined,
      operations,
      createdAt: String(get('createdAt') ?? ''),
      submittedAt: get('submittedAt') as string | undefined,
      resolvedAt: get('resolvedAt') as string | undefined,
      resolvedBy: get('resolvedBy') as string | undefined,
      rejectionReason: get('rejectionReason') as string | undefined,
    };
  }

  /**
   * List all plans, optionally filtered by status.
   */
  listPlans(status?: PlanStatus): PendingPlan[] {
    const entities = this.kernel.listEntities('PendingPlan', status ? { status } : undefined);
    return entities
      .map(e => this.loadPlan(e.id))
      .filter((p): p is PendingPlan => p !== null);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /**
   * Execute a single planned operation against the real kernel.
   */
  private async _executeOperation(op: PlannedOperation): Promise<MutateResult | null> {
    switch (op.kind) {
      case 'createEntity':
        if (!op.entityId || !op.entityType) {
          throw new Error(`PlannedOperation ${op.id}: createEntity requires entityId and entityType`);
        }
        return this.kernel.createEntity(op.entityId, op.entityType, op.attributes ?? {});

      case 'updateEntity':
        if (!op.entityId || !op.attributes) {
          throw new Error(`PlannedOperation ${op.id}: updateEntity requires entityId and attributes`);
        }
        return this.kernel.updateEntity(op.entityId, op.attributes);

      case 'deleteEntity':
        if (!op.entityId) {
          throw new Error(`PlannedOperation ${op.id}: deleteEntity requires entityId`);
        }
        return this.kernel.deleteEntity(op.entityId);

      case 'addLink':
        if (!op.sourceId || !op.linkAttribute || !op.targetId) {
          throw new Error(`PlannedOperation ${op.id}: addLink requires sourceId, linkAttribute, and targetId`);
        }
        return this.kernel.addLink(op.sourceId, op.linkAttribute, op.targetId);

      case 'removeLink':
        if (!op.sourceId || !op.linkAttribute || !op.targetId) {
          throw new Error(`PlannedOperation ${op.id}: removeLink requires sourceId, linkAttribute, and targetId`);
        }
        return this.kernel.removeLink(op.sourceId, op.linkAttribute, op.targetId);

      default:
        throw new Error(`PlannedOperation ${op.id}: Unknown operation kind "${op.kind}"`);
    }
  }
}
