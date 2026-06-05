/**
 * VCS Operation Constructors
 *
 * Helpers to create content-addressed VcsOps with proper
 * causality chaining and metadata.
 */

import type { VcsOp, VcsOpKind, VcsPayload } from './types.js';

type VcsOpHashInput = Pick<
  VcsOp,
  'kind' | 'timestamp' | 'agentId' | 'previousHash' | 'vcs'
>;

/**
 * Computes the content-addressed hash for a VCS op body.
 */
export async function hashVcsOp(op: VcsOpHashInput): Promise<string> {
  // Hash covers the full op body except the hash field itself.
  const content = JSON.stringify({
    kind: op.kind,
    timestamp: op.timestamp,
    agentId: op.agentId,
    previousHash: op.previousHash,
    vcs: op.vcs,
  });
  const msgUint8 = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `trellis:op:${hashHex}`;
}

/**
 * Verifies that a VCS op's hash matches its immutable body.
 */
export async function verifyVcsOpHash(op: VcsOp): Promise<boolean> {
  return op.hash === (await hashVcsOp(op));
}

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

  return {
    ...opBase,
    hash: await hashVcsOp(opBase),
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
