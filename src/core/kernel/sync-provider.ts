/**
 * Sync Provider Interface
 *
 * Defines the contract for real-time sync and federation.
 * Implementations handle applying remote operations and broadcasting local changes.
 */

import type { KernelOp } from '../persist/backend.js';

/**
 * Incoming remote operation from another peer.
 */
export interface RemoteOp {
  op: KernelOp;
  sourcePeerId: string;
  timestamp: string;
}

/**
 * Sync provider interface.
 * Implement this to enable real-time sync between peers.
 */
export interface SyncProvider {
  /**
   * Initialize the sync provider.
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the sync network.
   */
  disconnect(): Promise<void>;

  /**
   * Check if connected.
   */
  isConnected(): boolean;

  /**
   * Apply a remote operation from another peer.
   * The kernel should apply this to its local store.
   */
  applyRemoteOperation(op: RemoteOp): Promise<void>;

  /**
   * Broadcast a local operation to other peers.
   */
  broadcast(op: KernelOp): Promise<void>;

  /**
   * Get the peer ID for this node.
   */
  getPeerId(): string;

  /**
   * Get list of connected peers.
   */
  getPeers(): string[];

  /**
   * Handle incoming operations (register callback).
   */
  onRemoteOp(callback: (op: RemoteOp) => void | Promise<void>): void;
}

/**
 * Create a no-op sync provider for local-only mode.
 */
export function createLocalSyncProvider(): SyncProvider {
  return {
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => false,
    applyRemoteOperation: async () => {},
    broadcast: async () => {},
    getPeerId: () => 'local',
    getPeers: () => [],
    onRemoteOp: () => {},
  };
}
