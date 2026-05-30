/**
 * Base Context Manager Implementation
 */

import type { LLMMessage } from '../llm/types.js';
import { ContextManager } from './types.js';

export class BaseContextManager implements ContextManager {
  private history: LLMMessage[] = [];
  
  constructor(initialHistory: LLMMessage[] = []) {
    this.history = initialHistory;
  }

  addMessage(message: LLMMessage): void {
    this.history.push(message);
  }

  getHistory(): LLMMessage[] {
    return this.history;
  }

  async prune(targetTokenCount: number): Promise<void> {
    // Basic pruning (FIFO) - In a real implementation this would use token counts.
    while (this.history.length > 20) { // arbitrary limit for now
      this.history.shift();
    }
  }

  async summarize(): Promise<string> {
    return 'Context summary not yet implemented.';
  }

  async injectRagContext(query: string, limit?: number): Promise<void> {
    // To be integrated with src/embeddings/
  }

  calculateTokenCount(message: LLMMessage): number {
    return (message.content?.length ?? 0) / 4; // very rough estimate (4 chars/token)
  }
}
