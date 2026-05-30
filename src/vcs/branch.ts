/**
 * Branch Management Module
 *
 * Extracted from engine.ts per DESIGN.md §8.1.
 * Handles create, switch, list, delete branch operations.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createVcsOp } from './ops.js';
import type { VcsOp } from './types.js';
import type { EngineContext } from './engine-context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  createdAt?: string;
}

export interface BranchState {
  currentBranch: string;
  /** Active agent lane (W1.1). */
  activeLaneId?: string;
}

const BRANCH_ADVANCE_SKIP_KINDS = new Set([
  'vcs:branchAdvance',
  'vcs:branchCreate',
  'vcs:branchDelete',
  'vcs:checkpointCreate',
]);

/** Whether an integration-journal op should emit a follow-up branchAdvance (ADR 0004). */
export function shouldAdvanceBranchHead(kind: string): boolean {
  return !BRANCH_ADVANCE_SKIP_KINDS.has(kind);
}

/** Read branch:NAME headOpHash from the materialized store (latest wins). */
export function getBranchHeadOpHash(
  ctx: EngineContext,
  branchName: string,
): string | undefined {
  const facts = ctx.store
    .getFactsByEntity(`branch:${branchName}`)
    .filter((f) => f.a === 'headOpHash');
  return facts[facts.length - 1]?.v as string | undefined;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Create a new branch forked from the current branch.
 */
export async function createBranch(
  ctx: EngineContext,
  name: string,
  currentBranch: string,
): Promise<VcsOp> {
  const existing = ctx.store
    .getFactsByAttribute('type')
    .filter((f) => f.v === 'Branch' && f.e === `branch:${name}`);
  if (existing.length > 0) {
    throw new Error(`Branch '${name}' already exists`);
  }

  const op = await createVcsOp('vcs:branchCreate', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: {
      branchName: name,
      baseBranch: currentBranch,
      targetOpHash: ctx.getLastOp()?.hash,
    },
  });
  await ctx.applyOp(op);
  return op;
}

/**
 * Switch to an existing branch.
 */
export function switchBranch(
  ctx: EngineContext,
  name: string,
): void {
  const branchFacts = ctx.store
    .getFactsByEntity(`branch:${name}`)
    .filter((f) => f.a === 'type' && f.v === 'Branch');
  if (branchFacts.length === 0) {
    throw new Error(`Branch '${name}' does not exist`);
  }
}

/**
 * List all branches.
 */
export function listBranches(
  ctx: EngineContext,
  currentBranch: string,
): BranchInfo[] {
  const branchFacts = ctx.store
    .getFactsByAttribute('type')
    .filter((f) => f.v === 'Branch');

  return branchFacts.map((f) => {
    const nameFact = ctx.store
      .getFactsByEntity(f.e)
      .find((ef) => ef.a === 'name');
    const createdFact = ctx.store
      .getFactsByEntity(f.e)
      .find((ef) => ef.a === 'createdAt');
    const name = (nameFact?.v as string) ?? f.e.replace('branch:', '');
    return {
      name,
      isCurrent: name === currentBranch,
      createdAt: createdFact?.v as string | undefined,
    };
  });
}

/**
 * Delete a branch (cannot delete the current branch).
 */
export async function deleteBranch(
  ctx: EngineContext,
  name: string,
  currentBranch: string,
): Promise<VcsOp> {
  if (name === currentBranch) {
    throw new Error(`Cannot delete the current branch '${name}'`);
  }
  const branchFacts = ctx.store
    .getFactsByEntity(`branch:${name}`)
    .filter((f) => f.a === 'type' && f.v === 'Branch');
  if (branchFacts.length === 0) {
    throw new Error(`Branch '${name}' does not exist`);
  }

  const op = await createVcsOp('vcs:branchDelete', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { branchName: name },
  });
  await ctx.applyOp(op);
  return op;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function saveBranchState(rootPath: string, state: BranchState): void {
  const statePath = join(rootPath, '.trellis', 'state.json');
  writeFileSync(statePath, JSON.stringify(state));
}

export function loadBranchState(rootPath: string): BranchState {
  const statePath = join(rootPath, '.trellis', 'state.json');
  if (existsSync(statePath)) {
    try {
      const raw = readFileSync(statePath, 'utf-8');
      const state = JSON.parse(raw);
      if (state.currentBranch) {
        return {
          currentBranch: state.currentBranch,
          activeLaneId: state.activeLaneId,
        };
      }
    } catch {}
  }
  return { currentBranch: 'main' };
}
