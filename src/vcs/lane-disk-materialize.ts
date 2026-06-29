/**
 * Materialize lane file ops to disk from the blob store (ADR 0014 Phase 2).
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { BlobStore } from './blob-store.js';
import { buildFileStateAtOp, type FileState } from './diff.js';
import type { LaneMeta } from './lane.js';
import type { VcsOp } from './types.js';

function applyFileOpToState(state: Map<string, FileState>, op: VcsOp): void {
  if (!op.vcs?.filePath) return;

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

/** Cumulative file map for a lane's materialized view at enter time. */
export function collectLaneFileStates(
  integrationOps: VcsOp[],
  laneOps: VcsOp[],
  meta: LaneMeta,
  parentLaneOps?: VcsOp[],
): Map<string, FileState> {
  const state = buildFileStateAtOp(integrationOps, meta.baseOpHash);
  for (const op of parentLaneOps ?? []) {
    applyFileOpToState(state, op);
  }
  for (const op of laneOps) {
    applyFileOpToState(state, op);
  }
  return state;
}

export function materializeToDisk(
  rootPath: string,
  fileStates: Map<string, FileState>,
  blobStore: BlobStore,
): void {
  for (const [relPath, fileState] of fileStates.entries()) {
    const absPath = join(rootPath, relPath);

    if (fileState.deleted) {
      if (existsSync(absPath)) {
        unlinkSync(absPath);
      }
      continue;
    }

    if (!fileState.contentHash) continue;

    const content = blobStore.get(fileState.contentHash);
    if (!content) continue;

    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content);
  }
}
