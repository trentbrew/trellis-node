/**
 * Agent Memory Ontology — Schema definitions for Conversation and Message entities.
 *
 * Two entity types, one relation:
 * - Conversation: a thread of messages between user and agent
 * - Message: a single message within a conversation
 * - hasMessage: links a conversation to its messages
 *
 * @module trellis/plugins/agent-memory
 */

import type { OntologySchema } from '../../core/ontology/types.js';

export const agentMemoryOntology: OntologySchema = {
  id: 'trellis:agent-memory',
  name: 'Agent Memory',
  version: '1.0.0',
  description: 'Graph-persisted agent conversations and message history',
  entities: [
    {
      name: 'Conversation',
      description: 'A thread of messages between user and agent',
      attributes: [
        { name: 'title', type: 'string', required: true },
        { name: 'model', type: 'string', description: 'LLM model used for this conversation' },
        {
          name: 'status',
          type: 'string',
          enum: ['active', 'archived'],
          default: 'active',
        },
        { name: 'createdAt', type: 'string', required: true, description: 'ISO 8601 timestamp' },
        { name: 'createdBy', type: 'string', description: 'Agent or user ID that initiated' },
        { name: 'agentId', type: 'ref', description: 'Agent entity this conversation belongs to', refTypes: ['Agent'] },
        { name: 'runId', type: 'ref', description: 'AgentRun this conversation is associated with', refTypes: ['AgentRun'] },
      ],
    },
    {
      name: 'Message',
      description: 'A single message within a conversation',
      attributes: [
        {
          name: 'role',
          type: 'string',
          required: true,
          enum: ['system', 'user', 'assistant', 'tool'],
        },
        { name: 'content', type: 'string', description: 'Message content (may be null for tool-call-only messages)' },
        { name: 'timestamp', type: 'string', required: true, description: 'ISO 8601 timestamp' },
        { name: 'tokenCount', type: 'number', description: 'Estimated token count' },
        { name: 'name', type: 'string', description: 'Tool name for tool messages' },
        { name: 'toolCallId', type: 'string', description: 'Tool call ID for tool response messages' },
        {
          name: 'status',
          type: 'string',
          enum: ['active', 'archived'],
          default: 'active',
          description: 'Archived messages are preserved for Idea Garden but excluded from active context',
        },
      ],
    },
  ],
  relations: [
    {
      name: 'hasMessage',
      sourceTypes: ['Conversation'],
      targetTypes: ['Message'],
      cardinality: 'many',
    },
  ],
};
