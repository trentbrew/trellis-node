/**
 * Diff Engine
 *
 * File-level diff with unified text output (Tier 0 / P3).
 * Compares two points in history by reconstructing file states from the
 * op stream and producing file-level diffs with optional unified text diffs
 * via the blob store.
 *
 * DESIGN.md §4.5 — "At Tier 0 (before AST parsing is available), the diff
 * engine falls back to file-level comparison."
 */

import type { VcsOp } from './types.js';
import type { BlobStore } from './blob-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileLevelDiff {
  kind: 'fileAdded' | 'fileModified' | 'fileDeleted' | 'fileRenamed';
  path: string;
  oldPath?: string;
  oldContentHash?: string;
  newContentHash?: string;
  /** Unified diff text (only for fileModified when blob content is available). */
  unifiedDiff?: string;
}

export interface DiffResult {
  diffs: FileLevelDiff[];
  filesChanged: string[];
  stats: {
    added: number;
    modified: number;
    removed: number;
    renamed: number;
  };
}

export interface FileState {
  contentHash?: string;
  deleted?: boolean;
}

// ---------------------------------------------------------------------------
// Core diff function
// ---------------------------------------------------------------------------

/**
 * Compute file-level diffs between two file state snapshots.
 * Optionally produces unified text diffs when a blob store is provided.
 */
export function diffFileStates(
  stateA: Map<string, FileState>,
  stateB: Map<string, FileState>,
  blobStore?: BlobStore | null,
): DiffResult {
  const diffs: FileLevelDiff[] = [];

  // Detect additions and modifications
  for (const [path, bState] of stateB) {
    if (bState.deleted) continue;

    const aState = stateA.get(path);

    if (!aState || aState.deleted) {
      // File added
      diffs.push({
        kind: 'fileAdded',
        path,
        newContentHash: bState.contentHash,
      });
    } else if (aState.contentHash !== bState.contentHash) {
      // File modified
      const diff: FileLevelDiff = {
        kind: 'fileModified',
        path,
        oldContentHash: aState.contentHash,
        newContentHash: bState.contentHash,
      };

      // Generate unified diff if blob store available
      if (blobStore && aState.contentHash && bState.contentHash) {
        const oldContent = blobStore.get(aState.contentHash);
        const newContent = blobStore.get(bState.contentHash);
        if (oldContent && newContent) {
          diff.unifiedDiff = generateUnifiedDiff(
            path,
            oldContent.toString('utf-8'),
            newContent.toString('utf-8'),
          );
        }
      }

      diffs.push(diff);
    }
  }

  // Detect deletions
  for (const [path, aState] of stateA) {
    if (aState.deleted) continue;

    const bState = stateB.get(path);
    if (!bState || bState.deleted) {
      diffs.push({
        kind: 'fileDeleted',
        path,
        oldContentHash: aState.contentHash,
      });
    }
  }

  const stats = {
    added: diffs.filter((d) => d.kind === 'fileAdded').length,
    modified: diffs.filter((d) => d.kind === 'fileModified').length,
    removed: diffs.filter((d) => d.kind === 'fileDeleted').length,
    renamed: diffs.filter((d) => d.kind === 'fileRenamed').length,
  };

  return {
    diffs,
    filesChanged: diffs.map((d) => d.path),
    stats,
  };
}

// ---------------------------------------------------------------------------
// File state reconstruction from ops
// ---------------------------------------------------------------------------

/**
 * Build cumulative file state from an array of ops up to (and including)
 * the op with the given hash. If no hash given, uses all ops.
 */
export function buildFileStateAtOp(
  ops: VcsOp[],
  atOpHash?: string,
): Map<string, FileState> {
  const state = new Map<string, FileState>();

  for (const op of ops) {
    if (op.vcs?.filePath) {
      switch (op.kind) {
        case 'vcs:fileAdd':
        case 'vcs:fileModify':
          state.set(op.vcs.filePath, { contentHash: op.vcs.contentHash });
          break;
        case 'vcs:fileDelete':
          state.set(op.vcs.filePath, { deleted: true });
          break;
        case 'vcs:fileRename':
          if (op.vcs.oldFilePath) {
            state.set(op.vcs.oldFilePath, { deleted: true });
          }
          state.set(op.vcs.filePath, { contentHash: op.vcs.contentHash });
          break;
      }
    }

    if (atOpHash && op.hash === atOpHash) break;
  }

  return state;
}

/**
 * Diff two op hashes in the same op stream.
 */
export function diffOpRange(
  ops: VcsOp[],
  fromHash: string,
  toHash: string,
  blobStore?: BlobStore | null,
): DiffResult {
  const stateA = buildFileStateAtOp(ops, fromHash);
  const stateB = buildFileStateAtOp(ops, toHash);
  return diffFileStates(stateA, stateB, blobStore);
}

// ---------------------------------------------------------------------------
// Unified diff generation (Myers algorithm)
// ---------------------------------------------------------------------------

interface EditOp {
  kind: 'equal' | 'insert' | 'delete';
  line: string;
}

/**
 * Generate a unified diff string from two text inputs.
 */
export function generateUnifiedDiff(
  filePath: string,
  oldText: string,
  newText: string,
  contextLines: number = 3,
): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const edits = myersDiff(oldLines, newLines);
  const hunks = buildHunks(edits, contextLines);

  if (hunks.length === 0) return '';

  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  for (const hunk of hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
    );
    for (const edit of hunk.edits) {
      switch (edit.kind) {
        case 'equal':
          lines.push(` ${edit.line}`);
          break;
        case 'delete':
          lines.push(`-${edit.line}`);
          break;
        case 'insert':
          lines.push(`+${edit.line}`);
          break;
      }
    }
  }

  return lines.join('\n');
}

/**
 * Myers diff algorithm — computes the shortest edit script between two
 * arrays of lines. Returns a sequence of equal/insert/delete operations.
 */
export function myersDiff(oldLines: string[], newLines: string[]): EditOp[] {
  const n = oldLines.length;
  const m = newLines.length;

  if (n === 0 && m === 0) return [];
  if (n === 0)
    return newLines.map((line) => ({ kind: 'insert' as const, line }));
  if (m === 0)
    return oldLines.map((line) => ({ kind: 'delete' as const, line }));

  const max = n + m;

  // v[k] = furthest x on diagonal k. Offset by max so indices are non-negative.
  const size = 2 * max + 1;
  const v = new Int32Array(size);
  const trace: Int32Array[] = [];

  const off = max; // offset so k=0 maps to index max

  // Forward pass
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + off] < v[k + 1 + off])) {
        x = v[k + 1 + off]; // move down (insert from new)
      } else {
        x = v[k - 1 + off] + 1; // move right (delete from old)
      }
      let y = x - k;

      // Follow diagonal (equal lines)
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }

      v[k + off] = x;

      if (x >= n && y >= m) break outer;
    }
  }

  // Backtrack to recover the edit path as a list of (x,y) waypoints
  let x = n;
  let y = m;
  const edits: EditOp[] = [];

  for (let d = trace.length - 1; d >= 0; d--) {
    const tv = trace[d];
    const k = x - y;

    // Determine which k-diagonal we came from
    let prevK: number;
    if (d === 0) {
      // We're at the start; emit remaining diagonals and break
      while (x > 0 && y > 0) {
        x--;
        y--;
        edits.push({ kind: 'equal', line: oldLines[x] });
      }
      break;
    }

    if (k === -d || (k !== d && tv[k - 1 + off] < tv[k + 1 + off])) {
      prevK = k + 1; // previous move was down (insert)
    } else {
      prevK = k - 1; // previous move was right (delete)
    }

    const prevX = tv[prevK + off];
    const prevY = prevX - prevK;

    // Emit diagonal (equal) lines from (x,y) back to just after the edit
    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.push({ kind: 'equal', line: oldLines[x] });
    }

    // Emit the edit itself
    if (prevK === k + 1) {
      // Was insert (moved down: y increased)
      y--;
      edits.push({ kind: 'insert', line: newLines[y] });
    } else {
      // Was delete (moved right: x increased)
      x--;
      edits.push({ kind: 'delete', line: oldLines[x] });
    }
  }

  edits.reverse();
  return edits;
}

// ---------------------------------------------------------------------------
// Hunk builder
// ---------------------------------------------------------------------------

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  edits: EditOp[];
}

function buildHunks(edits: EditOp[], contextLines: number): Hunk[] {
  if (edits.length === 0) return [];

  // Find change indices
  const changeIndices: number[] = [];
  for (let i = 0; i < edits.length; i++) {
    if (edits[i].kind !== 'equal') {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) return [];

  // Group changes into hunks with context
  const hunks: Hunk[] = [];
  let hunkStart = Math.max(0, changeIndices[0] - contextLines);
  let hunkEnd = Math.min(edits.length - 1, changeIndices[0] + contextLines);

  for (let i = 1; i < changeIndices.length; i++) {
    const changeStart = changeIndices[i] - contextLines;
    const changeEnd = Math.min(
      edits.length - 1,
      changeIndices[i] + contextLines,
    );

    if (changeStart <= hunkEnd + 1) {
      // Merge with current hunk
      hunkEnd = changeEnd;
    } else {
      // Emit current hunk and start new one
      hunks.push(createHunk(edits, hunkStart, hunkEnd));
      hunkStart = changeStart;
      hunkEnd = changeEnd;
    }
  }

  // Emit final hunk
  hunks.push(createHunk(edits, hunkStart, hunkEnd));

  return hunks;
}

function createHunk(edits: EditOp[], start: number, end: number): Hunk {
  const hunkEdits = edits.slice(start, end + 1);

  // Compute old/new line numbers
  let oldLine = 1;
  let newLine = 1;
  for (let i = 0; i < start; i++) {
    if (edits[i].kind === 'equal' || edits[i].kind === 'delete') oldLine++;
    if (edits[i].kind === 'equal' || edits[i].kind === 'insert') newLine++;
  }

  let oldCount = 0;
  let newCount = 0;
  for (const edit of hunkEdits) {
    if (edit.kind === 'equal' || edit.kind === 'delete') oldCount++;
    if (edit.kind === 'equal' || edit.kind === 'insert') newCount++;
  }

  return {
    oldStart: oldLine,
    oldCount,
    newStart: newLine,
    newCount,
    edits: hunkEdits,
  };
}
