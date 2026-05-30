/**
 * Engine Context
 *
 * Shared interface that module functions (branch, milestone, checkpoint)
 * use to access engine internals without depending on the engine class.
 */

import type { EAVStore, Fact } from '../core/store/eav-store.js';
import type { VcsOp } from './types.js';

/** Options for engine op ingestion (integration vs lane journals). */
export interface ApplyOpOptions {
  /** Skip emitting vcs:branchAdvance after this op (replay, promote, advance ops). */
  skipBranchAdvance?: boolean;
  /** Write to integration journal while a lane is active (lane create/drop, promote). */
  allowIntegrationWrite?: boolean;
}

export interface EngineContext {
  /** The EAV store for querying/mutating graph state. */
  store: EAVStore;

  /** Agent ID for op attribution. */
  agentId: string;

  /** Get all ops from the log. */
  readAllOps(): VcsOp[];

  /** Get the last op in the log. */
  getLastOp(): VcsOp | undefined;

  /** Apply an op (decompose + persist + branch advance + auto-checkpoint flag). */
  applyOp(op: VcsOp, opts?: ApplyOpOptions): Promise<void>;
}
