/**
 * Agent Memory Plugin — Trellis plugin for graph-persisted conversations.
 *
 * Registers the agent memory ontology and subscribes to entity events
 * so consumers can react to conversation/message lifecycle changes.
 *
 * @module trellis/plugins/agent-memory
 */

import type { PluginDef } from '../../core/plugins/types.js';
import { agentMemoryOntology } from './ontology.js';

/**
 * Create the agent memory plugin instance.
 *
 * Returns a PluginDef that registers Conversation/Message schemas
 * and emits well-known events on conversation lifecycle changes.
 */
export function createAgentMemoryPlugin(): PluginDef {
  const isMemoryEntity = (data: unknown): boolean => {
    if (!data || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    return d.type === 'Conversation' || d.type === 'Message';
  };

  return {
    id: 'trellis:agent-memory',
    name: 'Agent Memory',
    version: '1.0.0',
    description: 'Graph-persisted agent conversations and message history',

    ontologies: [agentMemoryOntology],

    eventHandlers: [
      {
        event: 'entity:created',
        handler: (data) => {
          if (!isMemoryEntity(data)) return;
          // Future: trigger context window recalculation, notify watchers
        },
      },
      {
        event: 'entity:updated',
        handler: (data) => {
          if (!isMemoryEntity(data)) return;
          // Future: handle status transitions (active → archived)
        },
      },
      {
        event: 'entity:deleted',
        handler: (data) => {
          if (!isMemoryEntity(data)) return;
          // Future: capture for Idea Garden (Phase 6)
        },
      },
    ],

    onLoad: async (ctx) => {
      ctx.log('Agent memory system loaded');
    },

    onUnload: async (ctx) => {
      ctx.log('Agent memory system unloaded');
    },
  };
}
