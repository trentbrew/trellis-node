/**
 * Plugin System — Public API Surface
 *
 * @module trellis/core/plugins
 */

export { PluginRegistry, EventBus } from './registry.js';

export type {
  PluginDef,
  PluginContext,
  PluginManifest,
  EventCallback,
  EventHandler,
  WellKnownEvent,
  WorkspaceConfig,
} from './types.js';
