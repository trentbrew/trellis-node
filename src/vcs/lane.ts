/**
 * Agent Lane metadata and paths (ADR 0001, terminology ADR 0005).
 * Journal I/O: {@link LaneOpLog} in ./op-log.js
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { VcsOp } from './types.js';

export type LaneStatus =
  | 'active'
  | 'promoting'
  | 'promoted'
  | 'dropped';

/** ADR 0006 sibling; ADR 0007 child with virtualBaseOpHash. */
export type LaneForkKind = 'sibling' | 'child';

export interface LaneMeta {
  id: string;
  status: LaneStatus;
  baseBranch: string;
  baseOpHash: string;
  targetBranch: string;
  headOpHash?: string;
  agentId: string;
  issueId?: string;
  sessionId?: string;
  parentLaneId?: string;
  forkKind?: LaneForkKind;
  forkedAt?: string;
  /** Parent lane head at child fork (ADR 0007). */
  virtualBaseOpHash?: string;
  worktreePath?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export function lanesRoot(trellisDir: string): string {
  return join(trellisDir, 'lanes');
}

export function laneDir(trellisDir: string, laneId: string): string {
  return join(lanesRoot(trellisDir), laneId);
}

export function laneMetaPath(trellisDir: string, laneId: string): string {
  return join(laneDir(trellisDir, laneId), 'meta.json');
}

export function newLaneId(): string {
  return `lane-${randomUUID()}`;
}

export function loadLaneMeta(
  trellisDir: string,
  laneId: string,
): LaneMeta | undefined {
  const path = laneMetaPath(trellisDir, laneId);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8')) as LaneMeta;
}

export function saveLaneMeta(
  trellisDir: string,
  meta: LaneMeta,
): void {
  const dir = laneDir(trellisDir, meta.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    laneMetaPath(trellisDir, meta.id),
    JSON.stringify(meta, null, 2) + '\n',
  );
}

export function listLaneIds(trellisDir: string): string[] {
  const root = lanesRoot(trellisDir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('lane-'))
    .map((d) => d.name);
}

export interface CreateLaneParams {
  baseBranch: string;
  baseOpHash: string;
  agentId: string;
  targetBranch?: string;
  issueId?: string;
  sessionId?: string;
  parentLaneId?: string;
  forkKind?: LaneForkKind;
  forkedAt?: string;
  virtualBaseOpHash?: string;
  worktreePath?: string;
  leaseExpiresAt?: string;
}

/** Lane journal tail, else meta head, else integration fork base. */
export function resolveLaneHeadFromJournal(
  meta: LaneMeta,
  laneOps: VcsOp[],
): string {
  return laneOps.at(-1)?.hash ?? meta.headOpHash ?? meta.baseOpHash;
}

export function createLaneMeta(
  trellisDir: string,
  params: CreateLaneParams,
): LaneMeta {
  const now = new Date().toISOString();
  const meta: LaneMeta = {
    id: newLaneId(),
    status: 'active',
    baseBranch: params.baseBranch,
    baseOpHash: params.baseOpHash,
    targetBranch: params.targetBranch ?? params.baseBranch,
    headOpHash: params.baseOpHash,
    agentId: params.agentId,
    issueId: params.issueId,
    sessionId: params.sessionId,
    parentLaneId: params.parentLaneId,
    forkKind: params.forkKind,
    forkedAt: params.forkedAt,
    virtualBaseOpHash: params.virtualBaseOpHash,
    worktreePath: params.worktreePath,
    leaseExpiresAt: params.leaseExpiresAt,
    createdAt: now,
    updatedAt: now,
  };
  saveLaneMeta(trellisDir, meta);
  return meta;
}

export function updateLaneHead(
  trellisDir: string,
  laneId: string,
  headOpHash: string,
): void {
  const meta = loadLaneMeta(trellisDir, laneId);
  if (!meta) return;
  meta.headOpHash = headOpHash;
  meta.updatedAt = new Date().toISOString();
  saveLaneMeta(trellisDir, meta);
}

export function listLaneMetas(trellisDir: string): LaneMeta[] {
  return listLaneIds(trellisDir)
    .map((id) => loadLaneMeta(trellisDir, id))
    .filter((m): m is LaneMeta => m !== undefined);
}
