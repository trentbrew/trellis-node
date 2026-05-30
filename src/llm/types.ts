/**
 * LLM Provider Interface and Types
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
}

export interface LLMToolChoice {
  type: 'function';
  function: {
    name: string;
  };
}

export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMCompletionOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
  tools?: LLMToolDefinition[];
  tool_choice?: 'none' | 'auto' | 'required' | LLMToolChoice;
  stream?: boolean;
}

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMCompletionChunk {
  id: string;
  choices: {
    delta: {
      content?: string;
      tool_calls?: LLMToolCall[];
    };
    finish_reason: string | null;
  }[];
}

export interface LLMCompletionResponse {
  id: string;
  model: string;
  choices: {
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: LLMToolCall[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMProvider {
  id: string;
  name: string;
  
  complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMCompletionResponse>;
  stream(messages: LLMMessage[], options?: LLMCompletionOptions): AsyncIterable<LLMCompletionChunk>;
}
