/**
 * Agent Memory — Trellis plugin for graph-persisted agent conversations.
 *
 * @module trellis/plugins/agent-memory
 *
 * @example
 * ```typescript
 * import { createAgentMemoryPlugin, agentMemoryOntology, GraphContextManager } from 'trellis/plugins/agent-memory';
 *
 * // 1. Register the plugin
 * const plugin = createAgentMemoryPlugin();
 * pluginRegistry.register(plugin);
 * await pluginRegistry.load('trellis:agent-memory', kernel, ontologyRegistry);
 *
 * // 2. Use graph-backed context manager with agent harness
 * const contextManager = new GraphContextManager(kernel);
 * const conversationId = await contextManager.createConversation({
 *   title: 'Design review',
 *   agentId: 'agent:trellis',
 * });
 *
 * // Messages are auto-persisted as graph entities
 * contextManager.addMessage({ role: 'user', content: 'Review the color tokens' });
 * const history = contextManager.getHistory(); // reads from graph
 * ```
 */

// Ontology
export { agentMemoryOntology } from './ontology.js';

// Plugin
export { createAgentMemoryPlugin } from './plugin.js';

// Graph-backed context manager
export { GraphContextManager, type ConversationOptions } from './graph-context-manager.js';
