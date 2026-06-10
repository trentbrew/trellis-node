/**
 * TrellisVCS Type Definitions
 *
 * VCS-specific operation kinds, payloads, and entity types
 * that extend the trellis-core kernel primitives.
 */

import type { KernelOp } from '../core/persist/backend.js';
import type { Fact, Link } from '../core/store/eav-store.js';

// ---------------------------------------------------------------------------
// VCS Operation Kinds
// ---------------------------------------------------------------------------

export type VcsOpKind =
  // Tier 0: File-level operations
  | 'vcs:fileAdd'
  | 'vcs:fileModify'
  | 'vcs:fileDelete'
  | 'vcs:fileRename'
  // Tier 1: Structural operations
  | 'vcs:dirAdd'
  | 'vcs:dirDelete'
  // VCS control operations
  | 'vcs:branchCreate'
  | 'vcs:branchDelete'
  | 'vcs:branchAdvance'
  | 'vcs:milestoneCreate'
  | 'vcs:checkpointCreate'
  | 'vcs:merge'
  // Tier 2: AST-level semantic patches (future)
  | 'vcs:symbolRename'
  | 'vcs:symbolMove'
  | 'vcs:symbolExtract'
  | 'vcs:signatureChange'
  // Issue tracking
  | 'vcs:issueCreate'
  | 'vcs:issueUpdate'
  | 'vcs:issueStart'
  | 'vcs:issuePause'
  | 'vcs:issueResume'
  | 'vcs:issueClose'
  | 'vcs:issueReopen'
  | 'vcs:criterionAdd'
  | 'vcs:criterionUpdate'
  // Issue blocking
  | 'vcs:issueBlock'
  | 'vcs:issueUnblock'
  // Decision traces
  | 'vcs:decisionRecord'
  // Agent lanes (ADR 0001, ADR 0005)
  | 'vcs:laneCreate'
  | 'vcs:laneDrop'
  | 'vcs:lanePromoteStart'
  | 'vcs:lanePromoteComplete'
  | 'vcs:lanePromoteAbort'
  // EAV store (CMS / knowledge graph)
  | 'vcs:storeAssert'
  | 'vcs:storeRetract'
  | 'vcs:storeLink'
  | 'vcs:storeUnlink';

// ---------------------------------------------------------------------------
// VCS Operation Payload
// ---------------------------------------------------------------------------

export interface VcsPayload {
  // File operations
  filePath?: string;
  oldFilePath?: string;
  contentHash?: string;
  oldContentHash?: string;
  size?: number;
  language?: string;

  // Branch operations
  branchName?: string;
  targetOpHash?: string;
  sourceBranch?: string;
  baseBranch?: string;
  baseOpHash?: string;

  // Milestone operations
  milestoneId?: string;
  message?: string;
  fromOpHash?: string;
  toOpHash?: string;

  // Checkpoint operations
  trigger?: 'green-build' | 'interval' | 'op-count' | 'manual';

  // Signature
  signature?: string;
  signedBy?: string;

  // Issue tracking
  issueId?: string;
  issueTitle?: string;
  issueStatus?: 'backlog' | 'queue' | 'in_progress' | 'paused' | 'closed';
  oldIssueStatus?: 'backlog' | 'queue' | 'in_progress' | 'paused' | 'closed';
  issuePriority?: 'critical' | 'high' | 'medium' | 'low';
  issueLabels?: string[];
  parentIssueId?: string;
  /** Previous parent when re-parenting or clearing via issueUpdate. */
  oldParentIssueId?: string;
  issueDescription?: string;
  issueAssignee?: string;
  pauseNote?: string;
  blockedByIssueId?: string;

  // Decision traces
  decisionId?: string;
  decisionContext?: string;
  decisionRationale?: string;
  decisionAlternatives?: string;
  decisionToolName?: string;
  decisionToolInput?: string;
  decisionToolOutput?: string;

  // Acceptance criteria
  criterionId?: string;
  criterionDescription?: string;
  criterionCommand?: string;
  criterionStatus?: 'pending' | 'passed' | 'failed';
  criterionOutput?: string;

  // Agent lanes
  laneId?: string;
  laneStatus?: 'active' | 'promoting' | 'promoted' | 'dropped';
  targetBranch?: string;
  parentLaneId?: string;
  forkKind?: 'sibling' | 'child';
  virtualBaseOpHash?: string;
  sessionId?: string;

  // EAV store (CMS / knowledge graph) — see ADR 0008
  facts?: Fact[];
  links?: Link[];
}

/**
 * A VcsOp mirrors KernelOp but widens `kind` to accept VCS-specific strings.
 * We don't extend KernelOp directly because the kernel types `kind` as a
 * narrow union; our VCS kinds are a superset.
 */
export interface VcsOp {
  hash: string;
  kind: VcsOpKind | string;
  timestamp: string;
  agentId: string;
  previousHash?: string;
  facts?: import('../core/store/eav-store.js').Fact[];
  links?: import('../core/store/eav-store.js').Link[];
  vcs?: VcsPayload;
}

// ---------------------------------------------------------------------------
// File Change Events (from watcher)
// ---------------------------------------------------------------------------

export interface FileChangeEvent {
  type: 'add' | 'modify' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  contentHash?: string;
  oldContentHash?: string;
  size?: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Entity ID Helpers
// ---------------------------------------------------------------------------

export function fileEntityId(path: string): string {
  return `file:${path}`;
}

export function dirEntityId(path: string): string {
  return `dir:${path}`;
}

export function branchEntityId(name: string): string {
  return `branch:${name}`;
}

export function milestoneEntityId(hash: string): string {
  return `milestone:${hash}`;
}

export function checkpointEntityId(hash: string): string {
  return `checkpoint:${hash}`;
}

export function issueEntityId(id: string): string {
  return id.startsWith('issue:') ? id : `issue:${id}`;
}

export function criterionEntityId(issueId: string, index: number): string {
  const bare = issueId.replace(/^issue:/, '');
  return `criterion:${bare}:ac-${index}`;
}

export function decisionEntityId(id: string): string {
  return id.startsWith('decision:') ? id : `decision:${id}`;
}

export function laneEntityId(id: string): string {
  return id.startsWith('lane:') ? id : `lane:${id}`;
}

// ---------------------------------------------------------------------------
// Repository Config
// ---------------------------------------------------------------------------

export interface TrellisVcsConfig {
  /** Absolute path to the repository root. */
  rootPath: string;

  /** Glob patterns to ignore (e.g. ['node_modules', '.git', '*.log']). */
  ignorePatterns: string[];

  /** Debounce interval for file watcher in ms. */
  debounceMs: number;

  /** Name of the default branch. */
  defaultBranch: string;

  /** Path to the .trellis database file. */
  dbPath: string;

  /** Whether init/watch should reconcile existing workspace files by default. */
  indexWorkspace: boolean;
}

export const DEFAULT_CONFIG: Omit<TrellisVcsConfig, 'rootPath'> = {
  ignorePatterns: [
    'node_modules',
    '.git',
    '.trellis',
    'dist',
    'build',
    '.DS_Store',
    '*.log',
  ],
  debounceMs: 300,
  defaultBranch: 'main',
  dbPath: '.trellis/trellis.db',
  indexWorkspace: true,
};
