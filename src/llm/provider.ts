/**
 * Base LLM Provider Implementation
 */

import { 
  LLMProvider, 
  LLMMessage, 
  LLMCompletionOptions, 
  LLMCompletionResponse, 
  LLMCompletionChunk 
} from './types.js';

export abstract class BaseLLMProvider implements LLMProvider {
  abstract id: string;
  abstract name: string;

  abstract complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMCompletionResponse>;
  
  async *stream(messages: LLMMessage[], options?: LLMCompletionOptions): AsyncIterable<LLMCompletionChunk> {
    throw new Error('Streaming not implemented for this provider.');
  }
}
