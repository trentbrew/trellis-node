/**
 * Merge Engine
 *
 * Three-way file-level merge with text-based fallback (Tier 0 / P3).
 * Merges a source branch into the current branch by:
 *   1. Finding the common ancestor (fork point) in the op stream
 *   2. Building file states at ancestor, ours, and theirs
 *   3. Producing a merged file state or conflicts
 *
 * DESIGN.md §4.4 — Patch Commutativity and Conflict Detection
 */

import type { VcsOp } from './types.js';
import type { BlobStore } from './blob-store.js';
import { buildFileStateAtOp, type FileState } from './diff.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergeConflict {
  path: string;
  kind: 'modify-modify' | 'modify-delete' | 'add-add';
  /** Content from the current (ours) branch. */
  ours?: string;
  /** Content from the source (theirs) branch. */
  theirs?: string;
  /** Content from the common ancestor. */
  base?: string;
  /** For text conflicts: attempted merge with conflict markers. */
  mergedWithMarkers?: string;
}

export interface MergeResult {
  /** True if merge completed without conflicts. */
  clean: boolean;
  /** Merged file states to apply (path → content string). */
  mergedFiles: Map<string, string | null>; // null = delete
  /** Conflicts requiring manual resolution. */
  conflicts: MergeConflict[];
  /** Summary stats. */
  stats: {
    added: number;
    modified: number;
    deleted: number;
    conflicted: number;
  };
}

// ---------------------------------------------------------------------------
// Three-way merge
// ---------------------------------------------------------------------------

/**
 * Perform a three-way merge given ancestor, ours, and theirs file states.
 */
export function threeWayMerge(
  base: Map<string, FileState>,
  ours: Map<string, FileState>,
  theirs: Map<string, FileState>,
  blobStore?: BlobStore | null,
): MergeResult {
  const mergedFiles = new Map<string, string | null>();
  const conflicts: MergeConflict[] = [];

  // Collect all file paths across all three states
  const allPaths = new Set<string>();
  for (const [p, s] of base) if (!s.deleted) allPaths.add(p);
  for (const [p, s] of ours) if (!s.deleted) allPaths.add(p);
  for (const [p, s] of theirs) if (!s.deleted) allPaths.add(p);

  // Also track deleted paths
  for (const [p, s] of ours) if (s.deleted) allPaths.add(p);
  for (const [p, s] of theirs) if (s.deleted) allPaths.add(p);

  for (const path of allPaths) {
    const b = base.get(path);
    const o = ours.get(path);
    const t = theirs.get(path);

    const baseExists = b && !b.deleted;
    const oursExists = o && !o.deleted;
    const theirsExists = t && !t.deleted;

    const baseHash = baseExists ? b.contentHash : undefined;
    const oursHash = oursExists ? o.contentHash : undefined;
    const theirsHash = theirsExists ? t.contentHash : undefined;

    // Neither side changed
    if (oursHash === theirsHash) {
      // Both same — no-op (keep ours)
      continue;
    }

    // Only ours changed (theirs same as base)
    if (theirsHash === baseHash && oursHash !== baseHash) {
      if (!oursExists) {
        mergedFiles.set(path, null); // we deleted
      }
      // else keep ours (already in our state)
      continue;
    }

    // Only theirs changed (ours same as base)
    if (oursHash === baseHash && theirsHash !== baseHash) {
      if (!theirsExists) {
        mergedFiles.set(path, null); // they deleted
      } else if (theirsHash && blobStore) {
        const content = blobStore.get(theirsHash);
        if (content) {
          mergedFiles.set(path, content.toString('utf-8'));
        }
      }
      continue;
    }

    // Both sides changed — potential conflict

    // Case: both added (not in base)
    if (!baseExists && oursExists && theirsExists) {
      if (oursHash === theirsHash) {
        continue; // identical add — no conflict
      }
      const oursContent = oursHash && blobStore ? blobStore.get(oursHash)?.toString('utf-8') : undefined;
      const theirsContent = theirsHash && blobStore ? blobStore.get(theirsHash)?.toString('utf-8') : undefined;

      // Try text merge with empty base
      if (oursContent !== undefined && theirsContent !== undefined) {
        const textResult = threeWayTextMerge('', oursContent, theirsContent);
        if (textResult.clean) {
          mergedFiles.set(path, textResult.merged);
          continue;
        }
        conflicts.push({
          path,
          kind: 'add-add',
          ours: oursContent,
          theirs: theirsContent,
          mergedWithMarkers: textResult.merged,
        });
      } else {
        conflicts.push({ path, kind: 'add-add', ours: oursContent, theirs: theirsContent });
      }
      continue;
    }

    // Case: one side deleted, other modified
    if (oursExists && !theirsExists) {
      conflicts.push({
        path,
        kind: 'modify-delete',
        ours: oursHash && blobStore ? blobStore.get(oursHash)?.toString('utf-8') : undefined,
      });
      continue;
    }
    if (!oursExists && theirsExists) {
      conflicts.push({
        path,
        kind: 'modify-delete',
        theirs: theirsHash && blobStore ? blobStore.get(theirsHash)?.toString('utf-8') : undefined,
      });
      continue;
    }

    // Case: both modified (both exist, different hashes)
    if (oursExists && theirsExists && oursHash !== theirsHash) {
      const baseContent = baseHash && blobStore ? blobStore.get(baseHash)?.toString('utf-8') : undefined;
      const oursContent = oursHash && blobStore ? blobStore.get(oursHash)?.toString('utf-8') : undefined;
      const theirsContent = theirsHash && blobStore ? blobStore.get(theirsHash)?.toString('utf-8') : undefined;

      if (baseContent !== undefined && oursContent !== undefined && theirsContent !== undefined) {
        const textResult = threeWayTextMerge(baseContent, oursContent, theirsContent);
        if (textResult.clean) {
          mergedFiles.set(path, textResult.merged);
        } else {
          conflicts.push({
            path,
            kind: 'modify-modify',
            base: baseContent,
            ours: oursContent,
            theirs: theirsContent,
            mergedWithMarkers: textResult.merged,
          });
        }
      } else {
        conflicts.push({
          path,
          kind: 'modify-modify',
          base: baseContent,
          ours: oursContent,
          theirs: theirsContent,
        });
      }
      continue;
    }
  }

  const added = [...mergedFiles.values()].filter((v) => v !== null).length;
  const deleted = [...mergedFiles.values()].filter((v) => v === null).length;

  return {
    clean: conflicts.length === 0,
    mergedFiles,
    conflicts,
    stats: {
      added,
      modified: added, // in a merge context, additions from theirs are "modified"
      deleted,
      conflicted: conflicts.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Three-way text merge
// ---------------------------------------------------------------------------

export interface TextMergeResult {
  clean: boolean;
  merged: string;
}

/**
 * Three-way line-level text merge.
 * Uses a simple approach: diff base→ours and base→theirs, then interleave.
 * Produces conflict markers when both sides change the same region.
 */
export function threeWayTextMerge(
  baseText: string,
  oursText: string,
  theirsText: string,
): TextMergeResult {
  const baseLines = baseText.split('\n');
  const oursLines = oursText.split('\n');
  const theirsLines = theirsText.split('\n');

  // Build change maps: line index in base → what each side did
  const oursChanges = computeLineChanges(baseLines, oursLines);
  const theirsChanges = computeLineChanges(baseLines, theirsLines);

  const result: string[] = [];
  let clean = true;

  let baseIdx = 0;
  let oursIdx = 0;
  let theirsIdx = 0;

  while (baseIdx < baseLines.length || oursIdx < oursLines.length || theirsIdx < theirsLines.length) {
    const oursChange = oursChanges.get(baseIdx);
    const theirsChange = theirsChanges.get(baseIdx);

    if (baseIdx >= baseLines.length) {
      // Past base — append remaining from both sides
      // Ours remaining
      while (oursIdx < oursLines.length) {
        result.push(oursLines[oursIdx++]);
      }
      // Theirs remaining
      while (theirsIdx < theirsLines.length) {
        result.push(theirsLines[theirsIdx++]);
      }
      break;
    }

    if (!oursChange && !theirsChange) {
      // Both kept the line unchanged
      result.push(baseLines[baseIdx]);
      baseIdx++;
      oursIdx++;
      theirsIdx++;
    } else if (oursChange && !theirsChange) {
      // Only ours changed
      applyChange(oursChange, result);
      baseIdx += oursChange.baseCount;
      oursIdx += oursChange.newCount;
      theirsIdx += oursChange.baseCount;
    } else if (!oursChange && theirsChange) {
      // Only theirs changed
      applyChange(theirsChange, result);
      baseIdx += theirsChange.baseCount;
      oursIdx += theirsChange.baseCount;
      theirsIdx += theirsChange.newCount;
    } else if (oursChange && theirsChange) {
      // Both changed — check if identical
      if (
        oursChange.baseCount === theirsChange.baseCount &&
        oursChange.newLines.join('\n') === theirsChange.newLines.join('\n')
      ) {
        // Identical change — apply once
        applyChange(oursChange, result);
        baseIdx += oursChange.baseCount;
        oursIdx += oursChange.newCount;
        theirsIdx += theirsChange.newCount;
      } else {
        // Conflict
        clean = false;
        result.push('<<<<<<< ours');
        for (const line of oursChange.newLines) result.push(line);
        result.push('=======');
        for (const line of theirsChange.newLines) result.push(line);
        result.push('>>>>>>> theirs');
        baseIdx += Math.max(oursChange.baseCount, theirsChange.baseCount);
        oursIdx += oursChange.newCount;
        theirsIdx += theirsChange.newCount;
      }
    }
  }

  return { clean, merged: result.join('\n') };
}

// ---------------------------------------------------------------------------
// Line change detection
// ---------------------------------------------------------------------------

interface LineChange {
  baseStart: number;
  baseCount: number;
  newCount: number;
  newLines: string[];
}

function applyChange(change: LineChange, result: string[]): void {
  for (const line of change.newLines) {
    result.push(line);
  }
}

/**
 * Compute a map of base line index → change region.
 * Uses LCS (longest common subsequence) to detect changed regions.
 */
function computeLineChanges(
  baseLines: string[],
  newLines: string[],
): Map<number, LineChange> {
  const changes = new Map<number, LineChange>();
  const matches = lcsMatch(baseLines, newLines);

  let baseIdx = 0;
  let newIdx = 0;

  for (const match of matches) {
    // Process gap before this match
    if (baseIdx < match.baseIdx || newIdx < match.newIdx) {
      const baseCount = match.baseIdx - baseIdx;
      const newCount = match.newIdx - newIdx;
      if (baseCount > 0 || newCount > 0) {
        changes.set(baseIdx, {
          baseStart: baseIdx,
          baseCount,
          newCount,
          newLines: newLines.slice(newIdx, newIdx + newCount),
        });
      }
    }
    baseIdx = match.baseIdx + 1;
    newIdx = match.newIdx + 1;
  }

  // Handle trailing gap
  if (baseIdx < baseLines.length || newIdx < newLines.length) {
    const baseCount = baseLines.length - baseIdx;
    const newCount = newLines.length - newIdx;
    if (baseCount > 0 || newCount > 0) {
      changes.set(baseIdx, {
        baseStart: baseIdx,
        baseCount,
        newCount,
        newLines: newLines.slice(newIdx),
      });
    }
  }

  return changes;
}

interface LCSMatch {
  baseIdx: number;
  newIdx: number;
}

/**
 * Find the LCS (longest common subsequence) matches between two line arrays.
 * Returns an ordered list of matched line index pairs.
 */
function lcsMatch(a: string[], b: string[]): LCSMatch[] {
  const n = a.length;
  const m = b.length;

  if (n === 0 || m === 0) return [];

  // DP table
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const matches: LCSMatch[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      matches.unshift({ baseIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return matches;
}
