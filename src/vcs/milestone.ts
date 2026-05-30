/**
 * Milestone Module
 *
 * Extracted from engine.ts per DESIGN.md §8.1.
 * Handles milestone creation, listing, and op-range computation.
 */

import { createVcsOp } from './ops.js';
import type { VcsOp } from './types.js';
import type { EngineContext } from './engine-context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MilestoneInfo {
  id: string;
  message?: string;
  createdAt?: string;
  createdBy?: string;
  fromOpHash?: string;
  toOpHash?: string;
  affectedFiles: string[];
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Create a milestone spanning a range of ops.
 * If no fromOpHash is specified, spans from the last milestone (or start).
 */
export async function createMilestone(
  ctx: EngineContext,
  message: string,
  opts?: {
    fromOpHash?: string;
    toOpHash?: string;
  },
): Promise<VcsOp> {
  const ops = ctx.readAllOps();
  const toOpHash = opts?.toOpHash ?? ops[ops.length - 1]?.hash;

  // Find the start: either specified, or the op after the last milestone
  let fromOpHash = opts?.fromOpHash;
  if (!fromOpHash) {
    const milestones = ops.filter((o) => o.kind === 'vcs:milestoneCreate');
    if (milestones.length > 0) {
      const lastMilestone = milestones[milestones.length - 1];
      fromOpHash = lastMilestone.vcs?.toOpHash ?? lastMilestone.hash;
    } else {
      fromOpHash = ops[0]?.hash;
    }
  }

  // Generate milestone ID
  const idBase = `${message}:${Date.now()}`;
  const msgUint8 = new TextEncoder().encode(idBase);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const milestoneId = `milestone:${hashHex.slice(0, 12)}`;

  // Determine affected files in the range
  const fromIdx = ops.findIndex((o) => o.hash === fromOpHash);
  const toIdx = ops.findIndex((o) => o.hash === toOpHash);
  const rangeOps =
    fromIdx >= 0 && toIdx >= 0 ? ops.slice(fromIdx, toIdx + 1) : ops;
  const affectedFiles = [
    ...new Set(
      rangeOps.filter((o) => o.vcs?.filePath).map((o) => o.vcs!.filePath!),
    ),
  ];

  const op = await createVcsOp('vcs:milestoneCreate', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: {
      milestoneId,
      message,
      fromOpHash,
      toOpHash,
    },
  });
  await ctx.applyOp(op);

  // Store affected files as multi-valued facts
  for (const file of affectedFiles) {
    ctx.store.addFacts([{ e: milestoneId, a: 'affectsFile', v: file }]);
  }

  return op;
}

/**
 * List all milestones from the EAV store.
 */
export function listMilestones(ctx: EngineContext): MilestoneInfo[] {
  const milestoneFacts = ctx.store
    .getFactsByAttribute('type')
    .filter((f) => f.v === 'Milestone');

  return milestoneFacts.map((f) => {
    const facts = ctx.store.getFactsByEntity(f.e);
    const get = (attr: string) =>
      facts.find((ef) => ef.a === attr)?.v as string | undefined;
    const affectedFiles = facts
      .filter((ef) => ef.a === 'affectsFile')
      .map((ef) => ef.v as string);

    return {
      id: f.e,
      message: get('message'),
      createdAt: get('createdAt'),
      createdBy: get('createdBy'),
      fromOpHash: get('fromOpHash'),
      toOpHash: get('toOpHash'),
      affectedFiles,
    };
  });
}
