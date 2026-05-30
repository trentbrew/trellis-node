/**
 * Agent Orchestration Types
 * 
 * Multi-agent coordination, routing, and handoffs.
 */

import { AgentHarness } from '../core/agents/harness.js';
import { LLMMessage } from '../llm/types.js';

export interface Route {
  sourceAgentId: string;
  targetAgentId: string;
  condition?: string; // Prompt-based or logic-based
}

export interface SupervisorConfig {
  agents: string[]; // List of candidate agents
  strategy: 'rule' | 'llm'; // Rule-based or LLM-based routing
}

export interface Orchestrator {
  harness: AgentHarness;
  
  // High-level routing
  route(input: string, context?: LLMMessage[]): Promise<string>;
  
  // Handoffs
  handoff(runId: string, fromAgentId: string, toAgentId: string): Promise<void>;
}
