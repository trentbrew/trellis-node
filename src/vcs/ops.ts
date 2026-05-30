/**
 * VCS Operation Constructors
 *
 * Helpers to create content-addressed VcsOps with proper
 * causality chaining and metadata.
 */

import type { VcsOp, VcsOpKind, VcsPayload } from './types.js';

/**
 * Creates a VcsOp with full metadata, hash, and causal chain link.
 */
export async function createVcsOp(
  kind: VcsOpKind,
  params: {
    agentId: string;
    previousHash?: string;
    vcs: VcsPayload;
  },
): Promise<VcsOp> {
  const opBase = {
    kind,
    timestamp: new Date().toISOString(),
    agentId: params.agentId,
    previousHash: params.previousHash,
    vcs: params.vcs,
  };

  // Hash covers the full op including VCS payload for content-addressability.
  const content = JSON.stringify(opBase);
  const msgUint8 = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    ...opBase,
    hash: `trellis:op:${hashHex}`,
  };
}

/**
 * Checks whether a KernelOp is a VcsOp (has a vcs payload).
 */
export function isVcsOp(op: { kind: string; vcs?: unknown }): op is VcsOp {
  return (
    op.vcs !== undefined ||
    (typeof op.kind === 'string' && op.kind.startsWith('vcs:'))
  );
}

/**
 * Checks whether an op kind is a VCS kind.
 */
export function isVcsOpKind(kind: string): kind is VcsOpKind {
  return kind.startsWith('vcs:');
}
