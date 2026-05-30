/**
 * Agent System Types
 *
 * Types for the generic agent harness that loads agent definitions
 * from the graph, manages runs, and records decision traces.
 *
 * @module trellis/core/agents
 */

// ---------------------------------------------------------------------------
// Agent definition (stored as graph entities)
// ---------------------------------------------------------------------------

import type { LLMProvider } from '../../llm/types.js';
import type { ContextManager } from '../../context/types.js';

// ---------------------------------------------------------------------------
// Agent definition (stored as graph entities)
// ---------------------------------------------------------------------------

export interface AgentDef {
  id: string;
  name: string;
  description?: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
  status: 'active' | 'inactive' | 'deprecated';
  capabilities: string[];
  tools: string[];
  temperature?: number;
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export interface ToolDef {
  id: string;
  name: string;
  description?: string;
  schema?: string;
  endpoint?: string;
}

export type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Agent run
// ---------------------------------------------------------------------------

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'plan_pending';

export interface AgentRun {
  id: string;
  agentId: string;
  startedAt: string;
  completedAt?: string;
  status: RunStatus;
  input?: string;
  output?: string;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  decisions: DecisionTrace[];
}

// ---------------------------------------------------------------------------
// Decision trace (kernel-native, not VCS-dependent)
// ---------------------------------------------------------------------------

export interface DecisionTrace {
  id: string;
  runId: string;
  agentId: string;
  toolName: string;
  input?: Record<string, unknown>;
  output?: string;
  rationale?: string;
  alternatives?: string[];
  timestamp: string;
  relatedEntities?: string[];
}

// ---------------------------------------------------------------------------
// Harness config
// ---------------------------------------------------------------------------

export interface AgentHarnessConfig {
  /** Whether to auto-record decision traces on tool invocations. */
  recordDecisions?: boolean;
  /** Maximum decisions per run before auto-stopping. */
  maxDecisionsPerRun?: number;
  /** Integration with an LLM provider for autonomous reasoning. */
  llmProvider?: LLMProvider;
  /** Context manager for handling agent memory. */
  contextManager?: ContextManager;
}

// ---------------------------------------------------------------------------
// Run task options
// ---------------------------------------------------------------------------

export interface RunTaskOptions {
  /** Resume an existing conversation instead of creating a new one. */
  conversationId?: string;
  /** Title for a new conversation (defaults to first 80 chars of input). */
  conversationTitle?: string;
}
