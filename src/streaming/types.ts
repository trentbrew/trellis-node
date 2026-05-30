/**
 * AI Agent Streaming Types
 * 
 * SSE-friendly event structures for streaming thoughts, tool calls, and final responses.
 */

export type AgentEventKind = 'thought' | 'tool_call' | 'tool_output' | 'final_response' | 'error';

export interface AgentEvent {
  kind: AgentEventKind;
  payload: unknown;
  timestamp: string;
}

export interface ThoughtEvent extends AgentEvent {
  kind: 'thought';
  payload: {
    content: string;
  };
}

export interface ToolCallEvent extends AgentEvent {
  kind: 'tool_call';
  payload: {
    toolId: string;
    input: Record<string, unknown>;
  };
}

export interface ToolOutputEvent extends AgentEvent {
  kind: 'tool_output';
  payload: {
    toolId: string;
    output: unknown;
    success: boolean;
  };
}

export interface FinalResponseEvent extends AgentEvent {
  kind: 'final_response';
  payload: {
    content: string;
  };
}

export interface AgentStreamer {
  // Methods to emit events for a run
  emit(runId: string, event: AgentEvent): void;
  // Methods to subscribe to events for a specific run
  subscribe(runId: string, callback: (event: AgentEvent) => void): void;
}
