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
  SyncNackMessage,
  SyncSnapshotRequestMessage,
  SyncSnapshotMessage,
  NackReason,
  SyncState,
  BranchPolicy,
  SyncTransport,
} from './types.js';

export {
  PROTOCOL_VERSION,
  MIN_SUPPORTED_VERSION,
  MAX_SUPPORTED_VERSION,
} from './types.js';

export { reconcile, findForkPoint } from './reconciler.js';

export type { ReconcileResult, ReconcileConflict } from './reconciler.js';

export { SyncEngine } from './sync-engine.js';
export type {
  OpsReceivedRejection,
  OpsReceivedResult,
} from './sync-engine.js';

export { TrellisVcsSyncPeer } from './vcs-sync-peer.js';
export type {
  TrellisVcsSyncPeerOptions,
  TrellisVcsSyncResult,
  RemoteNackInfo,
} from './vcs-sync-peer.js';

export { MemoryTransport } from './memory-transport.js';

export { MemorySyncRoom, MemoryRoomTransport } from './memory-room.js';
export type {
  MemorySyncRoomAppendRejection,
  MemorySyncRoomAppendResult,
} from './memory-room.js';

export {
  SyncRoomCore,
  DEFAULT_SNAPSHOT_MAX_OPS,
} from './room-core.js';
export type {
  SyncRoomAppendRejection,
  SyncRoomAppendResult,
  SyncRoomDelivery,
  SyncRoomSnapshot,
} from './room-core.js';

export { SyncRoomServer } from './sync-room-server.js';
export type {
  SyncRoomServerConnection,
  SyncRoomServerOptions,
} from './sync-room-server.js';

export { createPartyKitRoomHandler } from './partykit-room.js';
export type {
  PartyKitRoomLike,
  PartyKitConnectionLike,
  PartyKitRoomHandlerOptions,
} from './partykit-room.js';

export { PartyKitRoomTransport } from './partykit-transport.js';
export type {
  PartyKitRoomTransportOptions,
  PartyKitReconnectOptions,
} from './partykit-transport.js';

export { HttpSyncTransport, createSyncHandler } from './http-transport.js';

export { WebSocketSyncTransport } from './ws-transport.js';

export {
  MultiRepoManager,
  parseCrossRepoRef,
  formatCrossRepoRef,
} from './multi-repo.js';
export type { LinkedRepo, CrossRepoRef } from './multi-repo.js';
