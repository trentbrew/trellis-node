/**
 * Sync Module — Public Surface
 *
 * @module sync
 *
 * Re-exports the CRDT {@link reconcile|reconciler}, {@link SyncEngine} for
 * the have→want→ops→ack protocol, and {@link MemoryTransport} for testing.
 * Branch policies control whether sync uses linear (fast-forward) or
 * CRDT (concurrent append) mode.
 *
 * @see DESIGN.md §3.5 for the branch concurrency model.
 */

export type {
  PeerId,
  SyncMessage,
  SyncHaveMessage,
  SyncWantMessage,
  SyncOpsMessage,
  SyncAckMessage,
  SyncState,
  BranchPolicy,
  SyncTransport,
} from './types.js';

export { reconcile, findForkPoint } from './reconciler.js';

export type { ReconcileResult, ReconcileConflict } from './reconciler.js';

export { SyncEngine } from './sync-engine.js';

export { MemoryTransport } from './memory-transport.js';

export { HttpSyncTransport, createSyncHandler } from './http-transport.js';

export { WebSocketSyncTransport } from './ws-transport.js';

export {
  MultiRepoManager,
  parseCrossRepoRef,
  formatCrossRepoRef,
} from './multi-repo.js';
export type { LinkedRepo, CrossRepoRef } from './multi-repo.js';
