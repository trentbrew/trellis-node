/**
 * Plugin System Types
 *
 * Defines the plugin interface, manifest format, lifecycle hooks,
 * and event system for extensibility.
 *
 * @module trellis/core/plugins
 */

import type { KernelMiddleware } from '../kernel/middleware.js';
import type { OntologySchema } from '../ontology/types.js';
import type { DatalogRule } from '../query/types.js';
import type { KernelOp } from '../persist/backend.js';

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export interface PluginDef {
  /** Unique plugin identifier (e.g. "trellis:security", "my-org:custom"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Semantic version. */
  version: string;
  /** Description. */
  description?: string;
  /** Plugin dependencies (other plugin IDs). */
  dependencies?: string[];

  /** Kernel middleware provided by this plugin. */
  middleware?: KernelMiddleware[];
  /** Ontology schemas provided by this plugin. */
  ontologies?: OntologySchema[];
  /** Datalog rules provided by this plugin. */
  rules?: DatalogRule[];
  /** Event listeners provided by this plugin. */
  eventHandlers?: EventHandler[];

  /** Called when the plugin is loaded. */
  onLoad?: (ctx: PluginContext) => void | Promise<void>;
  /** Called when the plugin is unloaded. */
  onUnload?: (ctx: PluginContext) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin context — what the plugin receives during lifecycle
// ---------------------------------------------------------------------------

export interface PluginContext {
  /** The plugin's own ID. */
  pluginId: string;
  /** Subscribe to events. */
  on: (event: string, handler: EventCallback) => void;
  /** Emit an event. */
  emit: (event: string, data?: unknown) => void;
  /** Get workspace config value. */
  getConfig: (key: string) => unknown;
  /** Log a message. */
  log: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Event system
// ---------------------------------------------------------------------------

export type EventCallback = (data: unknown) => void | Promise<void>;

export interface EventHandler {
  /** Event name pattern (e.g. "op:*", "entity:created", "milestone:created"). */
  event: string;
  /** Handler function. */
  handler: EventCallback;
}

/** Well-known event names. */
export type WellKnownEvent =
  | 'op:applied'
  | 'entity:created'
  | 'entity:updated'
  | 'entity:deleted'
  | 'link:added'
  | 'link:removed'
  | 'milestone:created'
  | 'issue:created'
  | 'issue:closed'
  | 'plugin:loaded'
  | 'plugin:unloaded';

// ---------------------------------------------------------------------------
// Workspace configuration
// ---------------------------------------------------------------------------

export interface WorkspaceConfig {
  /** Active ontology IDs. */
  ontologies?: string[];
  /** Active plugin IDs. */
  plugins?: string[];
  /** Tracked file patterns (globs). */
  trackedPaths?: string[];
  /** Ignore patterns. */
  ignorePaths?: string[];
  /** Branch policies. */
  branchPolicies?: Record<string, { linear?: boolean }>;
  /** Embedding model override. */
  embeddingModel?: string;
  /** Snapshot threshold (ops between auto-snapshots). */
  snapshotThreshold?: number;
  /** Custom key-value settings. */
  settings?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Plugin manifest (for on-disk .trellis/plugins.json)
// ---------------------------------------------------------------------------

export interface PluginManifest {
  /** Plugin ID. */
  id: string;
  /** Installed version. */
  version: string;
  /** Whether the plugin is enabled. */
  enabled: boolean;
  /** Plugin-specific configuration. */
  config?: Record<string, unknown>;
}
