/**
 * Plan Approval Plugin — Trellis plugin for multi-turn planning with
 * buffered mutations and user approval.
 *
 * Registers the plan approval ontology and provides agent tool definitions
 * that the harness can register for plan-mode interactions.
 *
 * @module trellis/plugins/plan-approval
 */

import type { PluginDef } from '../../core/plugins/types.js';
import type { ToolHandler } from '../../core/agents/types.js';
import type { PlanManager } from './plan-manager.js';
import { planApprovalOntology } from './ontology.js';

/**
 * Create the plan approval plugin instance.
 */
export function createPlanApprovalPlugin(): PluginDef {
  return {
    id: 'trellis:plan-approval',
    name: 'Plan Approval',
    version: '1.0.0',
    description: 'Multi-turn planning with buffered mutations and user approval',

    ontologies: [planApprovalOntology],

    eventHandlers: [
      {
        event: 'entity:updated',
        handler: (data) => {
          if (!data || typeof data !== 'object') return;
          const d = data as Record<string, unknown>;
          if (d.type !== 'PendingPlan') return;
          // Future: emit plan lifecycle events for UI notifications
        },
      },
    ],

    onLoad: async (ctx) => {
      ctx.log('Plan approval system loaded');
    },

    onUnload: async (ctx) => {
      ctx.log('Plan approval system unloaded');
    },
  };
}

// ---------------------------------------------------------------------------
// Agent tool definitions for the harness
// ---------------------------------------------------------------------------

/**
 * Context required by plan approval tools.
 */
export interface PlanToolContext {
  planManager: PlanManager;
}

/**
 * Tool: enterPlanMode
 *
 * Agent calls this when it wants to plan a set of operations before
 * executing them. Subsequent plan* tool calls buffer operations.
 */
export function createEnterPlanModeTool(ctx: PlanToolContext): {
  def: { name: string; description: string; schema: string };
  handler: ToolHandler;
} {
  return {
    def: {
      name: 'enterPlanMode',
      description:
        'Enter plan mode. Subsequent planCreateEntity/planUpdateEntity/planAddLink calls will be buffered for user review instead of executing immediately. Use this before performing bulk operations or significant architectural changes.',
      schema: JSON.stringify({
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title describing the planned changes' },
          description: { type: 'string', description: 'Detailed description of what will be changed and why' },
        },
        required: ['title'],
      }),
    },
    handler: async (input) => {
      const { title, description } = input as { title: string; description?: string };
      const planId = await ctx.planManager.enterPlanMode(title, description);
      return {
        success: true,
        output: { planId, message: `Plan mode active. Use planCreateEntity/planUpdateEntity/planAddLink to buffer operations, then submitPlan to send for review.` },
      };
    },
  };
}

/**
 * Tool: planCreateEntity
 *
 * Buffer a createEntity operation in the active plan.
 */
export function createPlanCreateEntityTool(ctx: PlanToolContext): {
  def: { name: string; description: string; schema: string };
  handler: ToolHandler;
} {
  return {
    def: {
      name: 'planCreateEntity',
      description: 'Buffer a new entity creation in the active plan. Must be in plan mode.',
      schema: JSON.stringify({
        type: 'object',
        properties: {
          entityId: { type: 'string', description: 'Unique entity ID' },
          entityType: { type: 'string', description: 'Entity type name' },
          attributes: { type: 'object', description: 'Entity attributes as key-value pairs' },
          description: { type: 'string', description: 'Human-readable description of this operation' },
        },
        required: ['entityId', 'entityType'],
      }),
    },
    handler: async (input) => {
      const { entityId, entityType, attributes, description } = input as {
        entityId: string;
        entityType: string;
        attributes?: Record<string, unknown>;
        description?: string;
      };
      const opId = await ctx.planManager.planCreateEntity(entityId, entityType, attributes as any, description);
      return { success: true, output: { operationId: opId } };
    },
  };
}

/**
 * Tool: planUpdateEntity
 */
export function createPlanUpdateEntityTool(ctx: PlanToolContext): {
  def: { name: string; description: string; schema: string };
  handler: ToolHandler;
} {
  return {
    def: {
      name: 'planUpdateEntity',
      description: 'Buffer an entity update in the active plan. Must be in plan mode.',
      schema: JSON.stringify({
        type: 'object',
        properties: {
          entityId: { type: 'string', description: 'Target entity ID' },
          attributes: { type: 'object', description: 'Attributes to update' },
          description: { type: 'string', description: 'Human-readable description' },
        },
        required: ['entityId', 'attributes'],
      }),
    },
    handler: async (input) => {
      const { entityId, attributes, description } = input as {
        entityId: string;
        attributes: Record<string, unknown>;
        description?: string;
      };
      const opId = await ctx.planManager.planUpdateEntity(entityId, attributes as any, description);
      return { success: true, output: { operationId: opId } };
    },
  };
}

/**
 * Tool: planAddLink
 */
export function createPlanAddLinkTool(ctx: PlanToolContext): {
  def: { name: string; description: string; schema: string };
  handler: ToolHandler;
} {
  return {
    def: {
      name: 'planAddLink',
      description: 'Buffer a link creation in the active plan. Must be in plan mode.',
      schema: JSON.stringify({
        type: 'object',
        properties: {
          sourceId: { type: 'string', description: 'Source entity ID' },
          linkAttribute: { type: 'string', description: 'Relationship attribute name' },
          targetId: { type: 'string', description: 'Target entity ID' },
          description: { type: 'string', description: 'Human-readable description' },
        },
        required: ['sourceId', 'linkAttribute', 'targetId'],
      }),
    },
    handler: async (input) => {
      const { sourceId, linkAttribute, targetId, description } = input as {
        sourceId: string;
        linkAttribute: string;
        targetId: string;
        description?: string;
      };
      const opId = await ctx.planManager.planAddLink(sourceId, linkAttribute, targetId, description);
      return { success: true, output: { operationId: opId } };
    },
  };
}

/**
 * Tool: submitPlan
 *
 * Submit the active plan for user review. This signals the harness to
 * pause the agent loop and yield control to the caller.
 *
 * The tool result includes `_planPending: true` which the harness
 * recognizes as a signal to set run status to `plan_pending`.
 */
export function createSubmitPlanTool(ctx: PlanToolContext): {
  def: { name: string; description: string; schema: string };
  handler: ToolHandler;
} {
  return {
    def: {
      name: 'submitPlan',
      description:
        'Submit the active plan for user review. The plan will be presented to the user for approval before any operations are executed. The agent loop will pause until the user approves or rejects.',
      schema: JSON.stringify({
        type: 'object',
        properties: {},
      }),
    },
    handler: async () => {
      const plan = await ctx.planManager.submitPlan();
      return {
        success: true,
        output: {
          _planPending: true,
          planId: plan.id,
          title: plan.title,
          description: plan.description,
          operationCount: plan.operations.length,
          operations: plan.operations.map(op => ({
            kind: op.kind,
            description: op.description,
            entityId: op.entityId,
            entityType: op.entityType,
          })),
        },
      };
    },
  };
}

/**
 * Tool: cancelPlan
 */
export function createCancelPlanTool(ctx: PlanToolContext): {
  def: { name: string; description: string; schema: string };
  handler: ToolHandler;
} {
  return {
    def: {
      name: 'cancelPlan',
      description: 'Cancel the active plan without submitting. Discards all buffered operations.',
      schema: JSON.stringify({
        type: 'object',
        properties: {},
      }),
    },
    handler: async () => {
      await ctx.planManager.cancelPlan();
      return { success: true, output: { message: 'Plan cancelled.' } };
    },
  };
}

/**
 * Register all plan approval tools with an AgentHarness.
 */
export function registerPlanTools(
  harness: { registerTool: (def: { name: string; description: string; schema?: string }, handler: ToolHandler) => Promise<string> },
  ctx: PlanToolContext,
): Promise<string[]> {
  const tools = [
    createEnterPlanModeTool(ctx),
    createPlanCreateEntityTool(ctx),
    createPlanUpdateEntityTool(ctx),
    createPlanAddLinkTool(ctx),
    createSubmitPlanTool(ctx),
    createCancelPlanTool(ctx),
  ];

  return Promise.all(
    tools.map(t => harness.registerTool(t.def, t.handler)),
  );
}
