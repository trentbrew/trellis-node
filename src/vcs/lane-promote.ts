/**
 * Agent Lane promotion — conflict detection and replay planning (ADR 0002, ADR 0003).
 */

import { EAVStore, type Atom, type Fact } from '../core/store/eav-store.js';
import type { BlobStore } from './blob-store.js';
import { decompose } from './decompose.js';
import { buildFileStateAtOp, type FileState } from './diff.js';
import { threeWayTextMerge } from './merge.js';
import { createVcsOp } from './ops.js';
import type { LaneMeta } from './lane.js';
import type { VcsOp, VcsOpKind } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LaneConflict {
  class: 'safe' | 'soft' | 'hard' | 'file';
  laneOpHash: string;
  entityId?: string;
  attribute?: string;
  filePath?: string;
  integrationValue?: unknown;
  laneValue?: unknown;
  suggestion?: 'accept-ours' | 'accept-theirs' | 'manual';
  message?: string;
}

export interface PromoteOpAction {
  sourceOp: VcsOp;
  /** Populated when a clean three-way file merge produced new content. */
  mergedContent?: string;
}

export interface LanePromotePlan {
  laneId: string;
  targetBranch: string;
  snapshotHead: string;
  baseOpHash: string;
  opsToReplay: PromoteOpAction[];
  conflicts: LaneConflict[];
  blockingConflicts: LaneConflict[];
  safeOpCount: number;
  canPromote: boolean;
}

export interface LanePromoteResult extends LanePromotePlan {
  promoted: boolean;
  integrationOpsAppended?: number;
  completeOpHash?: string;
}

export interface PlanLanePromoteParams {
  laneId: string;
  meta: LaneMeta;
  targetBranch: string;
  snapshotHead: string;
  integrationOps: VcsOp[];
  laneOps: VcsOp[];
  /** Parent lane journal when meta.forkKind === 'child' (ADR 0007). */
  parentLaneOps?: VcsOp[];
  blobStore?: BlobStore | null;
}

const SKIP_PROMOTE_KINDS = new Set<string>([
  'vcs:branchAdvance',
  'vcs:laneCreate',
  'vcs:laneDrop',
  'vcs:lanePromoteStart',
  'vcs:lanePromoteComplete',
  'vcs:lanePromoteAbort',
]);

const FILE_OP_KINDS = new Set<string>([
  'vcs:fileAdd',
  'vcs:fileModify',
  'vcs:fileDelete',
  'vcs:fileRename',
]);

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

function replayOpIntoStore(store: EAVStore, op: VcsOp): void {
  const d = decompose(op);
  if (d.deleteFacts.length > 0) store.deleteFacts(d.deleteFacts);
  if (d.deleteLinks.length > 0) store.deleteLinks(d.deleteLinks);
  if (d.addFacts.length > 0) store.addFacts(d.addFacts);
  if (d.addLinks.length > 0) store.addLinks(d.addLinks);
}

export function resolveBranchHeadFromOps(
  ops: VcsOp[],
  branchName: string,
): string | undefined {
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]!;
    if (
      op.kind === 'vcs:branchAdvance' &&
      op.vcs?.branchName === branchName &&
      op.vcs.targetOpHash
    ) {
      return op.vcs.targetOpHash;
    }
  }
  return ops[ops.length - 1]?.hash;
}

export function buildStoreUpTo(ops: VcsOp[], atOpHash?: string): EAVStore {
  const store = new EAVStore();
  for (const op of ops) {
    replayOpIntoStore(store, op);
    if (atOpHash && op.hash === atOpHash) break;
  }
  return store;
}

function getFactValue(
  store: EAVStore,
  entity: string,
  attribute: string,
): Atom | undefined {
  const facts = store.getFactsByEntity(entity).filter((f) => f.a === attribute);
  return facts[facts.length - 1]?.v;
}

function entityAttributes(store: EAVStore, entity: string): Map<string, Atom> {
  const map = new Map<string, Atom>();
  for (const fact of store.getFactsByEntity(entity)) {
    map.set(fact.a, fact.v);
  }
  return map;
}

function collectTouchedAttributes(op: VcsOp): Map<string, Set<string>> {
  const d = decompose(op);
  const map = new Map<string, Set<string>>();
  const touch = (fact: Fact) => {
    if (!map.has(fact.e)) map.set(fact.e, new Set());
    map.get(fact.e)!.add(fact.a);
  };
  for (const f of d.addFacts) touch(f);
  for (const f of d.deleteFacts) touch(f);
  return map;
}

function collectTouchedEntities(op: VcsOp): Set<string> {
  const d = decompose(op);
  const entities = new Set<string>();
  for (const f of [...d.addFacts, ...d.deleteFacts]) entities.add(f.e);
  for (const l of [...d.addLinks, ...d.deleteLinks]) {
    entities.add(l.e1);
    entities.add(l.e2);
  }
  return entities;
}

function atomsEqual(a: Atom | undefined, b: Atom | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return String(a) === String(b);
}

function buildLaneFileState(laneOps: VcsOp[], throughIndex: number): Map<string, FileState> {
  const slice = laneOps.slice(0, throughIndex + 1);
  return buildFileStateAtOp(slice);
}

function filePathsFromOp(op: VcsOp): string[] {
  const paths: string[] = [];
  if (op.vcs?.filePath) paths.push(op.vcs.filePath);
  if (op.vcs?.oldFilePath) paths.push(op.vcs.oldFilePath);
  return paths;
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

function detectEntityConflicts(
  op: VcsOp,
  baseStore: EAVStore,
  headStore: EAVStore,
): LaneConflict[] {
  const conflicts: LaneConflict[] = [];
  const d = decompose(op);
  const touchedEntities = collectTouchedEntities(op);
  const laneAttrsByEntity = collectTouchedAttributes(op);

  for (const fact of d.addFacts) {
    const headValue = getFactValue(headStore, fact.e, fact.a);
    const baseValue = getFactValue(baseStore, fact.e, fact.a);

    if (atomsEqual(headValue, fact.v)) continue;

    if (!atomsEqual(headValue, baseValue) && headValue !== undefined) {
      conflicts.push({
        class: 'hard',
        laneOpHash: op.hash,
        entityId: fact.e,
        attribute: fact.a,
        integrationValue: headValue,
        laneValue: fact.v,
        suggestion: 'manual',
        message: `Integration changed ${fact.e}.${fact.a} since fork`,
      });
    }
  }

  for (const entityId of touchedEntities) {
    const laneAttrs = laneAttrsByEntity.get(entityId) ?? new Set();
    // Links can touch an entity without editing it — only soft-conflict when this
    // op actually adds/deletes facts on that entity (parallel work on other attrs).
    if (laneAttrs.size === 0) continue;

    const baseAttrs = entityAttributes(baseStore, entityId);
    const headAttrs = entityAttributes(headStore, entityId);

    for (const [attribute, headValue] of headAttrs) {
      if (laneAttrs.has(attribute)) continue;
      const baseValue = baseAttrs.get(attribute);
      if (!atomsEqual(headValue, baseValue)) {
        conflicts.push({
          class: 'soft',
          laneOpHash: op.hash,
          entityId,
          attribute,
          integrationValue: headValue,
          suggestion: 'manual',
          message: `Integration updated ${entityId}.${attribute} while lane touched the same entity`,
        });
      }
    }
  }

  return conflicts;
}

function blobText(
  blobStore: BlobStore | null | undefined,
  hash?: string,
): string | undefined {
  if (!hash || !blobStore) return undefined;
  const content = blobStore.get(hash);
  if (!content) return undefined;
  const text = content.toString('utf-8');
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

function mergeLaneFile(
  path: string,
  base: Map<string, FileState>,
  ours: Map<string, FileState>,
  theirs: Map<string, FileState>,
  blobStore?: BlobStore | null,
): { clean: boolean; merged?: string; conflictKind?: string } {
  const b = base.get(path);
  const o = ours.get(path);
  const t = theirs.get(path);

  const baseHash = b && !b.deleted ? b.contentHash : undefined;
  const oursHash = o && !o.deleted ? o.contentHash : undefined;
  const theirsHash = t && !t.deleted ? t.contentHash : undefined;

  if (oursHash === theirsHash) return { clean: true };
  if (theirsHash === baseHash && oursHash !== baseHash) return { clean: true };
  if (oursHash === baseHash && theirsHash !== baseHash) {
    const theirsContent = blobText(blobStore, theirsHash);
    return { clean: true, merged: theirsContent };
  }

  const baseContent = blobText(blobStore, baseHash) ?? '';
  const oursContent = blobText(blobStore, oursHash);
  const theirsContent = blobText(blobStore, theirsHash);

  if (oursContent === undefined || theirsContent === undefined) {
    return { clean: false, conflictKind: 'modify-modify' };
  }

  const textResult = threeWayTextMerge(baseContent, oursContent, theirsContent);
  if (textResult.clean) {
    return { clean: true, merged: textResult.merged };
  }
  return { clean: false, conflictKind: 'modify-modify' };
}

function detectFileConflict(
  op: VcsOp,
  integrationOps: VcsOp[],
  laneOps: VcsOp[],
  laneOpIndex: number,
  baseOpHash: string,
  snapshotHead: string,
  blobStore?: BlobStore | null,
): { conflict?: LaneConflict; mergedContent?: string } {
  const paths = filePathsFromOp(op);
  if (paths.length === 0) return {};

  const base = buildFileStateAtOp(integrationOps, baseOpHash);
  const ours = buildFileStateAtOp(integrationOps, snapshotHead);
  const theirs = buildLaneFileState(laneOps, laneOpIndex);

  for (const path of paths) {
    const baseState = base.get(path);
    const headState = ours.get(path);
    const laneState = theirs.get(path);

    const baseHash = baseState && !baseState.deleted ? baseState.contentHash : undefined;
    const headHash = headState && !headState.deleted ? headState.contentHash : undefined;
    const laneHash = laneState && !laneState.deleted ? laneState.contentHash : undefined;

    if (headHash === laneHash) continue;
    if (headHash === baseHash && laneHash !== baseHash) continue;
    if (laneHash === baseHash && headHash !== baseHash) continue;

    const mergeResult = mergeLaneFile(path, base, ours, theirs, blobStore);
    if (mergeResult.clean) {
      if (mergeResult.merged !== undefined) {
        return { mergedContent: mergeResult.merged };
      }
      continue;
    }

    return {
      conflict: {
        class: 'file',
        laneOpHash: op.hash,
        filePath: path,
        suggestion: 'manual',
        message: `File conflict on ${path} (${mergeResult.conflictKind ?? 'modify-modify'})`,
      },
    };
  }

  return {};
}

function isBlockingConflict(conflict: LaneConflict): boolean {
  return conflict.class === 'soft' || conflict.class === 'hard' || conflict.class === 'file';
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export async function planLanePromote(
  params: PlanLanePromoteParams,
): Promise<LanePromotePlan> {
  const {
    laneId,
    meta,
    targetBranch,
    snapshotHead,
    integrationOps,
    laneOps,
    parentLaneOps,
    blobStore,
  } = params;

  const baseStore = buildStoreUpTo(integrationOps, meta.baseOpHash);
  const headStore = buildStoreUpTo(integrationOps, snapshotHead);

  const fileLaneOps =
    meta.forkKind === 'child' && parentLaneOps?.length
      ? [...parentLaneOps, ...laneOps]
      : laneOps;
  const childOpOffset = parentLaneOps?.length ?? 0;

  const opsToReplay: PromoteOpAction[] = [];
  const conflicts: LaneConflict[] = [];
  let safeOpCount = 0;

  for (let i = 0; i < laneOps.length; i++) {
    const op = laneOps[i]!;
    if (SKIP_PROMOTE_KINDS.has(op.kind)) continue;

    if (FILE_OP_KINDS.has(op.kind)) {
      const fileResult = detectFileConflict(
        op,
        integrationOps,
        fileLaneOps,
        childOpOffset + i,
        meta.baseOpHash,
        snapshotHead,
        blobStore,
      );
      if (fileResult.conflict) {
        conflicts.push(fileResult.conflict);
        continue;
      }
      opsToReplay.push({
        sourceOp: op,
        mergedContent: fileResult.mergedContent,
      });
      safeOpCount++;
      continue;
    }

    const decomposed = decompose(op);
    if (
      decomposed.addFacts.length > 0 &&
      decomposed.deleteFacts.length === 0 &&
      decomposed.addFacts.every((fact) =>
        atomsEqual(getFactValue(headStore, fact.e, fact.a), fact.v),
      )
    ) {
      continue;
    }

    const entityConflicts = detectEntityConflicts(op, baseStore, headStore);
    const blockingEntity = entityConflicts.filter(isBlockingConflict);
    conflicts.push(...entityConflicts);

    if (blockingEntity.length > 0) continue;

    opsToReplay.push({ sourceOp: op });
    safeOpCount++;
    replayOpIntoStore(headStore, op);
  }

  const blockingConflicts = conflicts.filter(isBlockingConflict);

  return {
    laneId,
    targetBranch,
    snapshotHead,
    baseOpHash: meta.baseOpHash,
    opsToReplay,
    conflicts,
    blockingConflicts,
    safeOpCount,
    canPromote: blockingConflicts.length === 0 && opsToReplay.length > 0,
  };
}

export async function rechainOpForIntegration(
  op: VcsOp,
  previousHash: string | undefined,
): Promise<VcsOp> {
  if (!isVcsOpKindSafe(op.kind)) {
    throw new Error(`Cannot rechain op kind '${op.kind}' for integration replay`);
  }
  return createVcsOp(op.kind as VcsOpKind, {
    agentId: op.agentId,
    previousHash,
    vcs: { ...op.vcs },
  });
}

function isVcsOpKindSafe(kind: string): kind is VcsOpKind {
  return kind.startsWith('vcs:');
}

// ---------------------------------------------------------------------------
// Explain formatting
// ---------------------------------------------------------------------------

export function formatPromoteExplain(plan: LanePromotePlan): string {
  const lines: string[] = [
    `Lane promote plan: ${plan.laneId}`,
    `  Target branch: ${plan.targetBranch}`,
    `  Fork base:     ${plan.baseOpHash}`,
    `  Snapshot head: ${plan.snapshotHead}`,
    `  Ops to replay: ${plan.opsToReplay.length}`,
    `  Safe ops:      ${plan.safeOpCount}`,
  ];

  if (plan.blockingConflicts.length === 0) {
    lines.push('', plan.canPromote ? '✓ Ready to promote' : 'No ops to replay');
    return lines.join('\n');
  }

  lines.push('', `Blocking conflicts (${plan.blockingConflicts.length}):`);
  for (const c of plan.blockingConflicts) {
    const where =
      c.filePath ??
      (c.entityId && c.attribute ? `${c.entityId}.${c.attribute}` : c.entityId);
    lines.push(`  [${c.class}] ${where ?? c.laneOpHash.slice(0, 24)}`);
    if (c.message) lines.push(`    ${c.message}`);
    if (c.integrationValue !== undefined) {
      lines.push(`    integration: ${String(c.integrationValue)}`);
    }
    if (c.laneValue !== undefined) {
      lines.push(`    lane:        ${String(c.laneValue)}`);
    }
  }

  return lines.join('\n');
}
