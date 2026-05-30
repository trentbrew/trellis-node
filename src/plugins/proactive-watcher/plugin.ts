/**
 * Proactive Watcher Plugin
 *
 * Subscribes to Kernel events (op:applied, entity:updated, etc.) via the
 * Plugin EventBus. When specific patterns are detected, it invokes an agent
 * to generate suggestions (e.g. creating tasks, documenting changes).
 *
 * Suggestions are currently "suggestion-only" (v1) and can be surfaced
 * to the user without automatically executing.
 *
 * @module trellis/plugins/proactive-watcher
 */

import type { PluginDef, PluginContext } from '../../core/plugins/types.js';
import type { TrellisKernel } from '../../core/kernel/trellis-kernel.js';
import type { AgentHarness } from '../../core/agents/harness.js';
import { proactiveWatcherOntology } from './ontology.js';
import { WatcherManager } from './watcher-manager.js';

export function createProactiveWatcherPlugin(
  kernel: TrellisKernel,
  harness: AgentHarness,
): PluginDef & { manager: WatcherManager } {
  const manager = new WatcherManager(kernel, harness);

  return {
    id: 'trellis:proactive-watcher',
    name: 'Proactive Watcher',
    version: '1.0.0',
    description: 'Watches the graph for changes and proactively generates suggestions',

    ontologies: [proactiveWatcherOntology],

    eventHandlers: [
      {
        event: 'op:applied',
        handler: async (data: unknown) => {
          await manager.processOperation(data);
        },
      },
    ],

    onLoad: async (ctx: PluginContext) => {
      ctx.log('Proactive Watcher loaded');
      manager.setContext(ctx);
    },

    onUnload: async (ctx: PluginContext) => {
      ctx.log('Proactive Watcher unloaded');
      manager.setContext(null);
    },

    manager,
  };
}
