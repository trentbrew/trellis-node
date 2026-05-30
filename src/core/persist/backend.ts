/**
 * Kernel persistence backend types.
 * Inlined from trellis-core for single-package publish.
 *
 * @module trellis/core
 */

import type { Fact, Link } from '../store/eav-store.js';

export type KernelOpKind =
  | 'addFacts'
  | 'addLinks'
  | 'deleteFacts'
  | 'deleteLinks';

export interface KernelOp {
  /**
   * Content hash of this operation (including previousHash).
   * Format: trellis:op:{hash}
   */
  hash: string;

  /**
   * Kind of operation.
   */
  kind: KernelOpKind;

  /**
   * ISO timestamp of when the op was created.
   */
  timestamp: string;

  /**
   * The ID of the agent that performed the operation.
   */
  agentId: string;

  /**
   * Hash of the previous operation in the local chain.
   */
  previousHash?: string;

  /**
   * The actual data payload.
   */
  facts?: Fact[];
  links?: Link[];

  /**
   * Facts to delete (for update/delete operations).
   */
  deleteFacts?: Fact[];

  /**
   * Links to delete (for update/delete operations).
   */
  deleteLinks?: Link[];
}

export interface KernelBackend {
  init(): void;
  append(op: KernelOp): void;
  readAll(): KernelOp[];
  readUntil(hash: string): KernelOp[];
  readAfter(hash: string): KernelOp[];
  readUntilTimestamp(isoTimestamp: string): KernelOp[];
  getByHash(hash: string): KernelOp | undefined;
  getLastOp(): KernelOp | undefined;
  getOpCount(): number;

  // Snapshot support
  saveSnapshot(lastOpHash: string, data: any): void;
  loadLatestSnapshot(): { lastOpHash: string; data: any } | undefined;

  close?(): void;
}
