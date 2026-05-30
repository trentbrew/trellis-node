/**
 * Context Management Interface and Types
 */

import type { LLMMessage } from '../llm/types.js';

export interface ContextWindow {
  maxTokens: number;
  currentTokens: number;
  messages: LLMMessage[];
  
  // RAG-based context injection
  availableRagResults?: string[];
  
  // Graph-based context
  relatedEntityIds?: string[];
}

export interface ContextManager {
  addMessage(message: LLMMessage): void;
  getHistory(): LLMMessage[];
  
  // Context pruning/summarization
  prune(targetTokenCount: number): Promise<void>;
  summarize(): Promise<string>;
  
  // Vector search integration
  injectRagContext(query: string, limit?: number): Promise<void>;
  
  // Token calculation
  calculateTokenCount(message: LLMMessage): number;
}
