/**
 * Checkpoint Module
 *
 * Extracted from engine.ts per DESIGN.md §8.1.
 * Handles checkpoint creation, listing, and auto-checkpoint logic.
 */

import { createVcsOp } from './ops.js';
import type { VcsOp } from './types.js';
import type { EngineContext } from './engine-context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckpointTrigger = 'manual' | 'op-count' | 'interval' | 'green-build';

export interface CheckpointInfo {
  id: string;
  createdAt?: string;
  trigger?: string;
  atOpHash?: string;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Create a checkpoint at the current position in the causal stream.
 */
export async function createCheckpoint(
  ctx: EngineContext,
  trigger: CheckpointTrigger = 'manual',
): Promise<VcsOp> {
  const op = await createVcsOp('vcs:checkpointCreate', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { trigger },
  });
  await ctx.applyOp(op);
  return op;
}

/**
 * List all checkpoints from the EAV store.
 */
export function listCheckpoints(ctx: EngineContext): CheckpointInfo[] {
  const cpFacts = ctx.store
    .getFactsByAttribute('type')
    .filter((f) => f.v === 'Checkpoint');

  return cpFacts.map((f) => {
    const facts = ctx.store.getFactsByEntity(f.e);
    const get = (attr: string) =>
      facts.find((ef) => ef.a === attr)?.v as string | undefined;
    return {
      id: f.e,
      createdAt: get('createdAt'),
      trigger: get('trigger'),
      atOpHash: get('atOpHash'),
    };
  });
}
