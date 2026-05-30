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

export type SyncMessage =
  | SyncHaveMessage
  | SyncWantMessage
  | SyncOpsMessage
  | SyncAckMessage;

/** Advertise which op hashes we have. */
export interface SyncHaveMessage {
  type: 'have';
  peerId: string;
  /** Our head op hashes (one per branch). */
  heads: Record<string, string>;
  /** Total op count for quick comparison. */
  opCount: number;
}

/** Request ops we're missing. */
export interface SyncWantMessage {
  type: 'want';
  peerId: string;
  /** Op hashes we need (those the remote has but we don't). */
  wantHashes: string[];
  /** Alternatively: request all ops after a given hash. */
  afterHash?: string;
}

/** Send a batch of ops. */
export interface SyncOpsMessage {
  type: 'ops';
  peerId: string;
  ops: VcsOp[];
}

/** Acknowledge receipt. */
export interface SyncAckMessage {
  type: 'ack';
  peerId: string;
  /** Hashes of ops we've integrated. */
  integrated: string[];
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
  onMessage(handler: (message: SyncMessage) => void): void;
  /** List connected peers. */
  peers(): PeerId[];
}
