/**
 * CRDT Reconciler
 *
 * DESIGN.md §10.5 — Merges divergent op streams using causal ordering.
 * Each device maintains its own causal chain. The reconciler merges
 * divergent chains by:
 *   1. Finding the common ancestor (fork point)
 *   2. Collecting ops unique to each side
 *   3. Topologically sorting the combined set by causal dependencies
 *   4. Detecting conflicts using patch commutativity (§4.4)
 */

import type { VcsOp } from '../vcs/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  /** The merged op stream in causal order. */
  merged: VcsOp[];
  /** Ops that were only on side A. */
  uniqueToA: VcsOp[];
  /** Ops that were only on side B. */
  uniqueToB: VcsOp[];
  /** Common ancestor op hash (fork point). */
  forkPoint: string | null;
  /** Whether the merge was clean (no causal conflicts). */
  clean: boolean;
  /** Conflicting op pairs (both modify same file without commutativity). */
  conflicts: ReconcileConflict[];
}

export interface ReconcileConflict {
  opA: VcsOp;
  opB: VcsOp;
  filePath: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Core reconciliation
// ---------------------------------------------------------------------------

/**
 * Find the common ancestor (fork point) of two op streams.
 * Returns the hash of the last op that appears in both streams.
 */
export function findForkPoint(opsA: VcsOp[], opsB: VcsOp[]): string | null {
  const hashesB = new Set(opsB.map((o) => o.hash));
  let forkPoint: string | null = null;

  for (const op of opsA) {
    if (hashesB.has(op.hash)) {
      forkPoint = op.hash;
    }
  }

  return forkPoint;
}

/**
 * Reconcile two divergent op streams into a single merged stream.
 *
 * Algorithm:
 *   1. Find the fork point (last common op)
 *   2. Split each stream into shared prefix + unique suffix
 *   3. Check for conflicts in the unique portions
 *   4. Interleave unique ops in causal (timestamp) order
 */
export function reconcile(opsA: VcsOp[], opsB: VcsOp[]): ReconcileResult {
  const forkPoint = findForkPoint(opsA, opsB);

  // Split into shared prefix and unique suffixes
  const hashesA = new Set(opsA.map((o) => o.hash));
  const hashesB = new Set(opsB.map((o) => o.hash));

  const shared: VcsOp[] = [];
  const uniqueToA: VcsOp[] = [];
  const uniqueToB: VcsOp[] = [];

  for (const op of opsA) {
    if (hashesB.has(op.hash)) {
      shared.push(op);
    } else {
      uniqueToA.push(op);
    }
  }

  for (const op of opsB) {
    if (!hashesA.has(op.hash)) {
      uniqueToB.push(op);
    }
  }

  // If one side has no unique ops, it's a fast-forward
  if (uniqueToA.length === 0) {
    return {
      merged: [...shared, ...uniqueToB],
      uniqueToA: [],
      uniqueToB,
      forkPoint,
      clean: true,
      conflicts: [],
    };
  }

  if (uniqueToB.length === 0) {
    return {
      merged: [...shared, ...uniqueToA],
      uniqueToA,
      uniqueToB: [],
      forkPoint,
      clean: true,
      conflicts: [],
    };
  }

  // Both sides diverged — detect conflicts
  const conflicts = detectConflicts(uniqueToA, uniqueToB);

  // Merge unique ops by timestamp (causal ordering)
  const interleaved = interleaveByTimestamp(uniqueToA, uniqueToB);

  return {
    merged: [...shared, ...interleaved],
    uniqueToA,
    uniqueToB,
    forkPoint,
    clean: conflicts.length === 0,
    conflicts,
  };
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/** VcsOp kinds that represent file-level mutations. */
const FILE_MUTATION_KINDS = new Set([
  'vcs:fileAdd',
  'vcs:fileModify',
  'vcs:fileDelete',
  'vcs:fileRename',
]);

/**
 * Detect conflicts between two sets of unique ops.
 * Two ops conflict when they both mutate the same file.
 */
function detectConflicts(
  uniqueA: VcsOp[],
  uniqueB: VcsOp[],
): ReconcileConflict[] {
  const conflicts: ReconcileConflict[] = [];

  // Index A's file mutations
  const aMutations = new Map<string, VcsOp[]>();
  for (const op of uniqueA) {
    if (!FILE_MUTATION_KINDS.has(op.kind) || !op.vcs?.filePath) continue;
    const path = op.vcs.filePath;
    if (!aMutations.has(path)) aMutations.set(path, []);
    aMutations.get(path)!.push(op);
  }

  // Check B's file mutations against A's
  for (const op of uniqueB) {
    if (!FILE_MUTATION_KINDS.has(op.kind) || !op.vcs?.filePath) continue;
    const path = op.vcs.filePath;
    const aOps = aMutations.get(path);
    if (!aOps) continue;

    for (const aOp of aOps) {
      // Same file modified by both sides
      if (aOp.kind === 'vcs:fileModify' && op.kind === 'vcs:fileModify') {
        conflicts.push({
          opA: aOp,
          opB: op,
          filePath: path,
          reason: `Both sides modified ${path}`,
        });
      } else if (
        (aOp.kind === 'vcs:fileDelete' && op.kind === 'vcs:fileModify') ||
        (aOp.kind === 'vcs:fileModify' && op.kind === 'vcs:fileDelete')
      ) {
        conflicts.push({
          opA: aOp,
          opB: op,
          filePath: path,
          reason: `Delete/modify conflict on ${path}`,
        });
      } else if (aOp.kind === 'vcs:fileAdd' && op.kind === 'vcs:fileAdd') {
        // Both added same file — conflict if different content
        if (aOp.vcs?.contentHash !== op.vcs?.contentHash) {
          conflicts.push({
            opA: aOp,
            opB: op,
            filePath: path,
            reason: `Both sides added ${path} with different content`,
          });
        }
      }
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Interleaving
// ---------------------------------------------------------------------------

/**
 * Interleave two op arrays by timestamp, preserving causal ordering
 * within each array.
 */
function interleaveByTimestamp(a: VcsOp[], b: VcsOp[]): VcsOp[] {
  const result: VcsOp[] = [];
  let ai = 0;
  let bi = 0;

  while (ai < a.length && bi < b.length) {
    const tA = new Date(a[ai].timestamp).getTime();
    const tB = new Date(b[bi].timestamp).getTime();

    if (tA <= tB) {
      result.push(a[ai++]);
    } else {
      result.push(b[bi++]);
    }
  }

  while (ai < a.length) result.push(a[ai++]);
  while (bi < b.length) result.push(b[bi++]);

  return result;
}
