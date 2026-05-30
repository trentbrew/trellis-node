/**
 * Plan Approval — Trellis plugin for multi-turn planning with buffered
 * mutations and user approval.
 *
 * @module trellis/plugins/plan-approval
 *
 * @example
 * ```typescript
 * import {
 *   createPlanApprovalPlugin,
 *   PlanManager,
 *   registerPlanTools,
 * } from 'trellis/plugins/plan-approval';
 *
 * // 1. Register the plugin
 * const plugin = createPlanApprovalPlugin();
 * pluginRegistry.register(plugin);
 * await pluginRegistry.load('trellis:plan-approval', kernel, ontologyRegistry);
 *
 * // 2. Create a plan manager and register tools with the harness
 * const planManager = new PlanManager(kernel);
 * await registerPlanTools(harness, { planManager });
 *
 * // 3. Agent can now use enterPlanMode, planCreateEntity, submitPlan tools
 * //    The harness will pause on submitPlan and set run status to plan_pending
 *
 * // 4. After user reviews:
 * const result = await planManager.approvePlan('user:trent');
 * // or: await planManager.rejectPlan('Not the right approach', 'user:trent');
 * ```
 */

// Ontology
export { planApprovalOntology } from './ontology.js';

// Plugin
export { createPlanApprovalPlugin } from './plugin.js';

// Plan Manager
export {
  PlanManager,
  type PlannedOperation,
  type PendingPlan,
  type PlanStatus,
  type OperationKind,
  type ApprovalResult,
} from './plan-manager.js';

// Agent tools
export {
  registerPlanTools,
  createEnterPlanModeTool,
  createPlanCreateEntityTool,
  createPlanUpdateEntityTool,
  createPlanAddLinkTool,
  createSubmitPlanTool,
  createCancelPlanTool,
  type PlanToolContext,
} from './plugin.js';
