/**
 * Signing Middleware
 *
 * DESIGN.md §6.2 — Every op can be cryptographically signed by its author.
 *
 * This module provides:
 * - `signOp`: Sign a VcsOp with a local identity's private key.
 * - `verifyOp`: Verify the signature on a VcsOp.
 * - `SignatureVerificationMiddleware`: Middleware that rejects ops with
 *   invalid signatures on remote ops.
 */

import type { VcsOp } from '../vcs/types.js';
import { signMessage, verifySignature } from './identity.js';

// ---------------------------------------------------------------------------
// Op signing
// ---------------------------------------------------------------------------

/**
 * Sign a VcsOp in-place using the given private key.
 * Sets `vcs.signature` and `vcs.signedBy` on the op.
 */
export function signOp(
  op: VcsOp,
  privateKeyBase64: string,
  identityEntityId: string,
): VcsOp {
  if (!op.vcs) {
    op.vcs = {};
  }
  op.vcs.signature = signMessage(op.hash, privateKeyBase64);
  op.vcs.signedBy = identityEntityId;
  return op;
}

/**
 * Verify the signature on a VcsOp.
 * Returns true if the op has a valid signature, false if invalid.
 * Returns null if the op has no signature (unsigned).
 */
export function verifyOp(
  op: VcsOp,
  publicKeyBase64: string,
): boolean | null {
  if (!op.vcs?.signature) return null;
  return verifySignature(op.hash, op.vcs.signature, publicKeyBase64);
}

// ---------------------------------------------------------------------------
// Middleware interface
// ---------------------------------------------------------------------------

export interface IdentityResolver {
  /** Resolve an identity entity ID to its public key (base64). */
  resolvePublicKey(entityId: string): string | null;
}

export interface SignatureVerificationResult {
  valid: boolean;
  op: VcsOp;
  reason?: string;
}

/**
 * Verify all signatures on a batch of ops.
 * Returns results for ops that have signatures.
 */
export function verifyOpBatch(
  ops: VcsOp[],
  resolver: IdentityResolver,
): SignatureVerificationResult[] {
  const results: SignatureVerificationResult[] = [];

  for (const op of ops) {
    if (!op.vcs?.signature || !op.vcs?.signedBy) continue;

    const publicKey = resolver.resolvePublicKey(op.vcs.signedBy);
    if (!publicKey) {
      results.push({
        valid: false,
        op,
        reason: `Unknown identity: ${op.vcs.signedBy}`,
      });
      continue;
    }

    const valid = verifySignature(op.hash, op.vcs.signature, publicKey);
    results.push({
      valid,
      op,
      reason: valid ? undefined : `Invalid signature on op ${op.hash}`,
    });
  }

  return results;
}
