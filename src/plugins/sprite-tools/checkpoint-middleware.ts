/**
 * Checkpoint Middleware — Deterministic auto-checkpointing before large mutations.
 *
 * Counts facts + links in each mutation and triggers a kernel checkpoint when
 * a batch exceeds a configurable threshold. This ensures safety-critical
 * behavior is deterministic (middleware), not dependent on LLM prompt
 * compliance.
 *
 * @module trellis/plugins/sprite-tools
 */

import type {
  KernelMiddleware,
  MiddlewareContext,
  OpMiddlewareNext,
} from '../../core/kernel/middleware.js';
import type { KernelOp } from '../../core/persist/backend.js';

export interface CheckpointMiddlewareConfig {
  /**
   * Trigger a checkpoint when a single mutation batch contains this many
   * or more combined facts + links (adds + deletes).
   * Default: 50.
   */
  threshold?: number;

  /**
   * Callback invoked when a checkpoint is auto-triggered.
   * Useful for logging or notification.
   */
  onCheckpoint?: (batchSize: number) => void;
}

/**
 * Create a CheckpointMiddleware instance.
 *
 * The middleware hooks into `handleOp`. It inspects each op's payload size
 * and if it exceeds the threshold, calls `checkpoint()` on the kernel
 * *before* the op proceeds through the chain.
 *
 * Because the middleware only has access to the op and the `next` function
 * (not the kernel directly), the actual checkpoint call is deferred to the
 * caller via the `onCheckpoint` callback. The caller should wire this to
 * `kernel.checkpoint()`.
 */
export function createCheckpointMiddleware(
  config?: CheckpointMiddlewareConfig,
): KernelMiddleware & { getStats: () => { checkpointsTriggered: number; lastBatchSize: number } } {
  const threshold = config?.threshold ?? 50;
  const onCheckpoint = config?.onCheckpoint;

  let checkpointsTriggered = 0;
  let lastBatchSize = 0;

  return {
    name: 'CheckpointMiddleware',

    handleOp(
      op: KernelOp,
      ctx: MiddlewareContext,
      next: OpMiddlewareNext,
    ): void {
      // Calculate batch size: total facts + links (both adds and deletes)
      const batchSize =
        (op.facts?.length ?? 0) +
        (op.links?.length ?? 0) +
        (op.deleteFacts?.length ?? 0) +
        (op.deleteLinks?.length ?? 0);

      lastBatchSize = batchSize;

      if (batchSize >= threshold) {
        checkpointsTriggered++;
        onCheckpoint?.(batchSize);
      }

      // Always continue the chain regardless
      next(op, ctx);
    },

    getStats() {
      return { checkpointsTriggered, lastBatchSize };
    },
  };
}
