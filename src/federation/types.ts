/**
 * Trellis Federation — Type Definitions
 *
 * Simple remote pull model for federated graphs across workspaces.
 * Read-only mirroring with watermark-based incremental sync.
 */

export interface RemoteConfig {
  /** Remote workspace name */
  name: string;
  /** Path to remote .trellis directory */
  path: string;
  /** Last pulled op ID (watermark for incremental sync) */
  lastOpId?: string;
  /** Timestamp of last pull */
  pulledAt?: string;
}

export interface RemotesConfig {
  /** All configured remotes */
  remotes: Record<string, RemoteConfig>;
}

export interface PullResult {
  /** Remote name */
  remote: string;
  /** Number of new ops pulled */
  newOps: number;
  /** Latest op ID after pull */
  latestOpId: string;
  /** Pull duration in milliseconds */
  durationMs: number;
  /** Errors encountered */
  errors: string[];
}

export interface PullAllResult {
  /** Results per remote */
  results: PullResult[];
  /** Total new ops across all remotes */
  totalNewOps: number;
  /** Total duration */
  totalDurationMs: number;
}
