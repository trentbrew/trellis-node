import { describe, test, expect } from 'vitest';
import { createIdentity } from '../../src/identity/identity.js';
import { signOp } from '../../src/identity/signing-middleware.js';
import type { IdentityResolver } from '../../src/identity/signing-middleware.js';
import {
  evaluatePolicy,
  createPolicy,
  type PolicyRule,
} from '../../src/identity/governance.js';
import { createVcsOp } from '../../src/vcs/ops.js';

// ---------------------------------------------------------------------------
// Policy creation
// ---------------------------------------------------------------------------

describe('createPolicy', () => {
  test('creates a policy with defaults', () => {
    const p = createPolicy({
      id: 'protect-main',
      target: 'branch',
      targetPattern: 'main',
      action: 'push',
      requiredSigners: ['identity:alice'],
    });

    expect(p.id).toBe('protect-main');
    expect(p.target).toBe('branch');
    expect(p.action).toBe('push');
    expect(p.minSignatures).toBe(1);
    expect(p.enabled).toBe(true);
  });

  test('respects custom minSignatures', () => {
    const p = createPolicy({
      id: 'two-sign',
      target: 'branch',
      targetPattern: 'main',
      action: 'merge',
      requiredSigners: ['identity:alice', 'identity:bob'],
      minSignatures: 2,
    });

    expect(p.minSignatures).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

describe('evaluatePolicy', () => {
  const alice = createIdentity({ displayName: 'Alice' });
  const bob = createIdentity({ displayName: 'Bob' });

  const resolver: IdentityResolver = {
    resolvePublicKey(entityId: string) {
      if (entityId === alice.entityId) return alice.publicKey;
      if (entityId === bob.entityId) return bob.publicKey;
      return null;
    },
  };

  test('allows op when no policies apply', async () => {
    const op = await createVcsOp('vcs:fileAdd', {
      agentId: alice.entityId,
      vcs: { filePath: 'src/test.ts', contentHash: 'abc' },
    });

    const result = evaluatePolicy(op, [], resolver);
    expect(result.allowed).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  test('allows signed op matching policy', async () => {
    const policy = createPolicy({
      id: 'protect-main',
      target: 'branch',
      targetPattern: 'main',
      action: 'deleteBranch',
      requiredSigners: [alice.entityId],
    });

    const op = await createVcsOp('vcs:branchDelete', {
      agentId: alice.entityId,
      vcs: { branchName: 'main' },
    });
    signOp(op, alice.privateKey, alice.entityId);

    const result = evaluatePolicy(op, [policy], resolver);
    expect(result.allowed).toBe(true);
  });

  test('rejects unsigned op when policy requires signature', async () => {
    const policy = createPolicy({
      id: 'protect-main',
      target: 'branch',
      targetPattern: 'main',
      action: 'deleteBranch',
      requiredSigners: [alice.entityId],
    });

    const op = await createVcsOp('vcs:branchDelete', {
      agentId: alice.entityId,
      vcs: { branchName: 'main' },
    });
    // Not signed

    const result = evaluatePolicy(op, [policy], resolver);
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].reason).toContain('requires');
  });

  test('rejects op signed by unauthorized identity', async () => {
    const policy = createPolicy({
      id: 'protect-main',
      target: 'branch',
      targetPattern: 'main',
      action: 'deleteBranch',
      requiredSigners: [alice.entityId], // Only Alice allowed
    });

    const op = await createVcsOp('vcs:branchDelete', {
      agentId: bob.entityId,
      vcs: { branchName: 'main' },
    });
    signOp(op, bob.privateKey, bob.entityId); // Bob signs but isn't authorized

    const result = evaluatePolicy(op, [policy], resolver);
    expect(result.allowed).toBe(false);
  });

  test('path-based policy matches file ops', async () => {
    const policy = createPolicy({
      id: 'protect-auth',
      target: 'path',
      targetPattern: 'src/auth/**',
      action: 'push',
      requiredSigners: [alice.entityId],
    });

    const op = await createVcsOp('vcs:fileModify', {
      agentId: alice.entityId,
      vcs: { filePath: 'src/auth/provider.ts', contentHash: 'abc' },
    });
    signOp(op, alice.privateKey, alice.entityId);

    const result = evaluatePolicy(op, [policy], resolver);
    expect(result.allowed).toBe(true);
  });

  test('path-based policy rejects unmatched path', async () => {
    const policy = createPolicy({
      id: 'protect-auth',
      target: 'path',
      targetPattern: 'src/auth/**',
      action: 'push',
      requiredSigners: [alice.entityId],
    });

    const op = await createVcsOp('vcs:fileModify', {
      agentId: bob.entityId,
      vcs: { filePath: 'src/utils/helper.ts', contentHash: 'abc' },
    });

    // This op targets a different path, so the policy shouldn't apply
    const result = evaluatePolicy(op, [policy], resolver);
    expect(result.allowed).toBe(true); // Policy doesn't match this path
  });

  test('disabled policy is skipped', async () => {
    const policy = createPolicy({
      id: 'protect-main',
      target: 'branch',
      targetPattern: 'main',
      action: 'deleteBranch',
      requiredSigners: [alice.entityId],
    });
    policy.enabled = false;

    const op = await createVcsOp('vcs:branchDelete', {
      agentId: bob.entityId,
      vcs: { branchName: 'main' },
    });

    const result = evaluatePolicy(op, [policy], resolver);
    expect(result.allowed).toBe(true);
  });

  test('milestone creation policy', async () => {
    const policy = createPolicy({
      id: 'signed-milestones',
      target: 'branch',
      targetPattern: '*',
      action: 'createMilestone',
      requiredSigners: [alice.entityId, bob.entityId],
    });

    // Note: milestoneCreate doesn't have branchName in vcs payload,
    // so branch-target policies won't match it by default.
    // This tests the "no match" path for milestone ops.
    const op = await createVcsOp('vcs:milestoneCreate', {
      agentId: alice.entityId,
      vcs: { milestoneId: 'ms:1', message: 'test' },
    });

    const result = evaluatePolicy(op, [policy], resolver);
    // Policy targets 'branch' but milestoneCreate has no branchName → doesn't match
    expect(result.allowed).toBe(true);
  });

  test('non-VCS op kinds return allowed', async () => {
    const policy = createPolicy({
      id: 'any',
      target: 'branch',
      targetPattern: 'main',
      action: 'push',
      requiredSigners: [alice.entityId],
    });

    const op = await createVcsOp('vcs:branchCreate', {
      agentId: alice.entityId,
      vcs: { branchName: 'feature' },
    });

    // branchCreate is not mapped to any governance action
    const result = evaluatePolicy(op, [policy], resolver);
    expect(result.allowed).toBe(true);
  });
});
