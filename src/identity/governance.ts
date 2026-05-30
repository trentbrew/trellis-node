/**
 * Governance Module
 *
 * DESIGN.md §6.3–6.4 — Policy nodes and governance enforcement.
 *
 * Policy rules are expressed as EAV entities. The governance engine evaluates
 * ops against applicable policies before allowing them through.
 */

import type { VcsOp } from '../vcs/types.js';
import type { IdentityResolver } from './signing-middleware.js';
import { verifySignature } from './identity.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolicyRule {
  id: string;
  /** What this policy protects. */
  target: 'branch' | 'path' | 'entityType';
  targetPattern: string;
  /** What action requires authorization. */
  action: 'push' | 'merge' | 'createMilestone' | 'deleteBranch';
  /** Who is authorized (identity entity IDs). */
  requiredSigners: string[];
  /** Minimum number of valid signatures required. */
  minSignatures: number;
  /** Optional: require CI attestation. */
  requireAttestation?: {
    type: 'test-pass' | 'build-pass' | 'review-approved';
    from: string;
  };
  /** Whether this policy is active. */
  enabled: boolean;
}

export interface PolicyViolation {
  policyId: string;
  op: VcsOp;
  reason: string;
}

export interface GovernanceResult {
  allowed: boolean;
  violations: PolicyViolation[];
}

// ---------------------------------------------------------------------------
// Op → action mapping
// ---------------------------------------------------------------------------

/**
 * Determine which governance action an op corresponds to.
 */
function opToAction(op: VcsOp): string | null {
  switch (op.kind) {
    case 'vcs:branchDelete':
      return 'deleteBranch';
    case 'vcs:milestoneCreate':
      return 'createMilestone';
    case 'vcs:merge':
      return 'merge';
    case 'vcs:fileAdd':
    case 'vcs:fileModify':
    case 'vcs:fileDelete':
    case 'vcs:fileRename':
    case 'vcs:branchAdvance':
      return 'push';
    default:
      return null;
  }
}

/**
 * Check if an op's target matches a policy's target pattern.
 */
function matchesTarget(op: VcsOp, policy: PolicyRule): boolean {
  switch (policy.target) {
    case 'branch': {
      const branchName = op.vcs?.branchName ?? op.vcs?.sourceBranch;
      if (!branchName) return false;
      return matchGlob(branchName, policy.targetPattern);
    }
    case 'path': {
      const filePath = op.vcs?.filePath;
      if (!filePath) return false;
      return matchGlob(filePath, policy.targetPattern);
    }
    case 'entityType': {
      return op.kind.includes(policy.targetPattern.toLowerCase());
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate an op against a set of policies.
 */
export function evaluatePolicy(
  op: VcsOp,
  policies: PolicyRule[],
  resolver: IdentityResolver,
): GovernanceResult {
  const violations: PolicyViolation[] = [];
  const action = opToAction(op);

  if (!action) {
    return { allowed: true, violations: [] };
  }

  const applicable = policies.filter(
    (p) => p.enabled && p.action === action && matchesTarget(op, p),
  );

  for (const policy of applicable) {
    // Check signature requirements
    if (policy.minSignatures > 0) {
      const validSigners = countValidSigners(op, policy, resolver);

      if (validSigners < policy.minSignatures) {
        violations.push({
          policyId: policy.id,
          op,
          reason:
            `Policy '${policy.id}' requires ${policy.minSignatures} signature(s) ` +
            `from [${policy.requiredSigners.join(', ')}], got ${validSigners}.`,
        });
      }
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

/**
 * Count how many valid required signers signed the op.
 */
function countValidSigners(
  op: VcsOp,
  policy: PolicyRule,
  resolver: IdentityResolver,
): number {
  if (!op.vcs?.signature || !op.vcs?.signedBy) return 0;

  // Check if the signer is in the required signers list
  if (!policy.requiredSigners.includes(op.vcs.signedBy)) return 0;

  // Verify signature
  const publicKey = resolver.resolvePublicKey(op.vcs.signedBy);
  if (!publicKey) return 0;

  const valid = verifySignature(op.hash, op.vcs.signature, publicKey);
  return valid ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Policy CRUD helpers
// ---------------------------------------------------------------------------

/**
 * Create a new policy rule.
 */
export function createPolicy(opts: {
  id: string;
  target: PolicyRule['target'];
  targetPattern: string;
  action: PolicyRule['action'];
  requiredSigners: string[];
  minSignatures?: number;
}): PolicyRule {
  return {
    id: opts.id,
    target: opts.target,
    targetPattern: opts.targetPattern,
    action: opts.action,
    requiredSigners: opts.requiredSigners,
    minSignatures: opts.minSignatures ?? 1,
    enabled: true,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple glob matcher supporting * and ** patterns.
 */
function matchGlob(value: string, pattern: string): boolean {
  if (pattern === '*' || pattern === '**') return true;
  if (pattern === value) return true;

  // Convert glob to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{DOUBLESTAR\}\}/g, '.*');

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(value);
}
