/**
 * Peer Sync — Type Definitions
 *
 * DESIGN.md §3.5, §10.5 — Peer sync + CRDTs.
 * Types for peer identity, sync messages, causal DAG, and
 * branch concurrency modes.
 */

import type { VcsOp } from '../vcs/types.js';

// ---------------------------------------------------------------------------
// Peer Identity
// ---------------------------------------------------------------------------

export interface PeerId {
  /** Unique peer identifier (typically derived from identity DID). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Last seen timestamp. */
  lastSeen?: string;
}

// ---------------------------------------------------------------------------
// Sync Messages
// ---------------------------------------------------------------------------

/**
 * Wire protocol version. Bumped when the message shape or semantics change
 * in a way that older peers cannot safely ignore. All outbound messages
 * carry this value; receivers reject anything outside the supported range
 * with a `protocol-version` nack.
 */
export const PROTOCOL_VERSION = 1 as const;
export const MIN_SUPPORTED_VERSION = 1 as const;
export const MAX_SUPPORTED_VERSION = 1 as const;

export type SyncMessage =
  | SyncHaveMessage
  | SyncWantMessage
  | SyncOpsMessage
  | SyncAckMessage
  | SyncNackMessage
  | SyncSnapshotRequestMessage
  | SyncSnapshotMessage;

export type SyncMessageHandler = (
  message: SyncMessage,
) => void | Promise<void>;

/**
 * Categorical reasons a receiver may reject ops sent over the wire.
 *
 * Engine-level reasons (`invalid-kind`, `hash-mismatch`, `missing-dependency`,
 * `apply-failed`) mirror `IntegrateOpRejectReason` so engine rejections flow
 * back to the sender unchanged. Wire-level reasons (`protocol-version`)
 * describe failures detected by the sync layer itself. The union is kept
 * separate so the wire protocol does not drift with engine internals.
 */
export type NackReason =
  | 'invalid-kind'
  | 'hash-mismatch'
  | 'missing-dependency'
  | 'apply-failed'
  | 'protocol-version';

/** Advertise which op hashes we have. */
export interface SyncHaveMessage {
  version: number;
  type: 'have';
  peerId: string;
  /** Our head op hashes (one per branch). */
  heads: Record<string, string>;
  /** Total op count for quick comparison. */
  opCount: number;
}

/** Request ops we're missing. */
export interface SyncWantMessage {
  version: number;
  type: 'want';
  peerId: string;
  /** Op hashes we need (those the remote has but we don't). */
  wantHashes: string[];
  /** Alternatively: request all ops after a given hash. */
  afterHash?: string;
  /**
   * When set with empty `wantHashes` and no `afterHash`, request a truncated
   * tail snapshot instead of the full room log (late-joiner catch-up).
   */
  maxOps?: number;
}

/** Request a truncated tail snapshot from a room peer. */
export interface SyncSnapshotRequestMessage {
  version: number;
  type: 'sync-snapshot';
  peerId: string;
  /** Max ops in the tail. Default chosen by the room (usually 500). */
  maxOps?: number;
}

/**
 * Room response: recent tail of the canonical log plus metadata.
 * Clients integrate `ops` like a normal `ops` message.
 */
export interface SyncSnapshotMessage {
  version: number;
  type: 'snapshot';
  peerId: string;
  /** Head hash of the full room log (may be beyond the returned tail). */
  headHash?: string;
  /** Total ops in the room canonical log. */
  opCount: number;
  /** True when `ops` is a truncated tail, not the full log. */
  truncated: boolean;
  ops: VcsOp[];
}

/** Send a batch of ops. */
export interface SyncOpsMessage {
  version: number;
  type: 'ops';
  peerId: string;
  ops: VcsOp[];
}

/** Acknowledge receipt. */
export interface SyncAckMessage {
  version: number;
  type: 'ack';
  peerId: string;
  /** Hashes of ops we've integrated (or already had). */
  integrated: string[];
}

/**
 * Reject one or more ops. Grouped by `reason` so a single batch may produce
 * several nacks if rejections fall into multiple categories.
 */
export interface SyncNackMessage {
  version: number;
  type: 'nack';
  peerId: string;
  /** Hashes of ops that were rejected for this reason. */
  refs: string[];
  reason: NackReason;
  /** Optional human-readable detail for logs. */
  details?: string;
}

// ---------------------------------------------------------------------------
// Sync State
// ---------------------------------------------------------------------------

export interface SyncState {
  /** Our peer identity. */
  localPeerId: string;
  /** Known peers and their head hashes. */
  peerHeads: Map<string, Record<string, string>>;
  /** Ops we've sent but not yet acknowledged. */
  pendingAcks: Set<string>;
  /** Last sync timestamp per peer. */
  lastSync: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Branch Concurrency Policy
// ---------------------------------------------------------------------------

export interface BranchPolicy {
  /** If true, only fast-forward appends (one writer). Default. */
  linear: boolean;
}

// ---------------------------------------------------------------------------
// Sync Transport (abstract interface)
// ---------------------------------------------------------------------------

export interface SyncTransport {
  /** Send a message to a specific peer. */
  send(peerId: string, message: SyncMessage): Promise<void>;
  /** Register a handler for incoming messages. */
  onMessage(handler: SyncMessageHandler): void;
  /** List connected peers. */
  peers(): PeerId[];
}
