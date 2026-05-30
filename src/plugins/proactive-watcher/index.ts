/**
 * Proactive Watcher — Trellis plugin that monitors the graph and surfaces
 * agent suggestions proactively.
 *
 * @module trellis/plugins/proactive-watcher
 *
 * @example
 * ```typescript
 * import { createProactiveWatcherPlugin } from 'trellis/plugins/proactive-watcher';
 *
 * const plugin = createProactiveWatcherPlugin(kernel, harness);
 *
 * // Add custom heuristic rules
 * plugin.manager.addRule({
 *   id: 'missing-docs',
 *   description: 'Suggests docs when new feature flags are added',
 *   condition: (op) => op.facts?.some(f => f.v === 'FeatureFlag') ?? false,
 *   agentId: 'proactive-agent',
 *   promptFactory: (op) => `A new feature flag was added: ${JSON.stringify(op)}. Suggest writing docs.`
 * });
 *
 * pluginRegistry.register(plugin);
 * ```
 */

export { proactiveWatcherOntology } from './ontology.js';
export { createProactiveWatcherPlugin } from './plugin.js';
export {
  WatcherManager,
  type WatcherRule,
} from './watcher-manager.js';
