/**
 * Sprite Tools — Trellis plugin for agent-driven checkpoint, deploy,
 * rollback, and infrastructure management.
 *
 * @module trellis/plugins/sprite-tools
 *
 * @example
 * ```typescript
 * import {
 *   createSpriteToolsPlugin,
 *   registerSpriteTools,
 *   createCheckpointMiddleware,
 * } from 'trellis/plugins/sprite-tools';
 *
 * // 1. Register the plugin
 * const plugin = createSpriteToolsPlugin();
 * pluginRegistry.register(plugin);
 * await pluginRegistry.load('trellis:sprite-tools', kernel, ontologyRegistry);
 *
 * // 2. Add checkpoint middleware (auto-checkpoint before large mutations)
 * const checkpointMw = createCheckpointMiddleware({
 *   threshold: 50,
 *   onCheckpoint: (batchSize) => {
 *     console.log(`Auto-checkpoint triggered (batch: ${batchSize})`);
 *     kernel.checkpoint();
 *   },
 * });
 * // Wire into kernel config or add via addMiddleware()
 *
 * // 3. Register tools with the agent harness
 * await registerSpriteTools(harness, { kernel });
 *
 * // Agent can now use: createCheckpoint, rollback, deployToSprite,
 * // getDeployStatus, listOps
 * ```
 */

// Plugin
export { createSpriteToolsPlugin } from './plugin.js';

// Agent tools
export {
  registerSpriteTools,
  createCheckpointTool,
  createRollbackTool,
  createGetDeployStatusTool,
  createDeployToSpriteTool,
  createListOpsTool,
  type SpriteToolContext,
} from './plugin.js';

// Checkpoint middleware
export {
  createCheckpointMiddleware,
  type CheckpointMiddlewareConfig,
} from './checkpoint-middleware.js';
