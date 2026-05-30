/**
 * Agent Evals & Observability Types
 * 
 * Testing agent success and asserting on graph state.
 */

import { AgentRun } from '../core/agents/types.js';

export interface EvalResult {
  runId: string;
  success: boolean;
  score: number; // 0.0 - 1.0
  rationale?: string;
}

export type AssertionKind = 'entityExists' | 'entityAttributeMatch' | 'linkExists' | 'toolInvocationsMatch';

export interface GraphAssertion {
  kind: AssertionKind;
  params: Record<string, unknown>;
  errorMessage?: string;
}

export interface EvalScenario {
  id: string;
  name: string;
  agentId: string;
  input: string;
  expectedAssertions: GraphAssertion[];
}

export interface EvalEngine {
  runScenario(scenario: EvalScenario): Promise<EvalResult>;
  runSuite(scenarios: EvalScenario[]): Promise<EvalResult[]>;
}
