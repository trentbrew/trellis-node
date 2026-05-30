/**
 * Heat-Map Context Manager — Relevance-weighted message retention.
 *
 * Replaces naive FIFO pruning with a heat-score system that considers:
 * - Recency: newer messages score higher
 * - Reference frequency: messages the LLM referenced score higher
 * - Role priority: system messages are never pruned
 *
 * Heat scores decay each turn, and messages the model referenced get
 * boosted. When pruning to a target token budget, lowest-heat messages
 * are dropped first.
 *
 * @module trellis/context
 */

import type { LLMMessage } from '../llm/types.js';
import type { ContextManager } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeatMapConfig {
  /**
   * Decay multiplier applied to all heat scores each turn.
   * Lower values = faster decay. Default: 0.85
   */
  decayFactor?: number;

  /**
   * Base heat score assigned to new messages.
   * Default: 1.0
   */
  baseHeat?: number;

  /**
   * Heat boost applied when a message is referenced.
   * Default: 0.5
   */
  referenceBoost?: number;

  /**
   * Minimum heat score — messages below this during pruning are
   * prioritized for removal. Default: 0.1
   */
  pruneThreshold?: number;
}

export interface ScoredMessage {
  message: LLMMessage;
  heat: number;
  addedAtTurn: number;
  referenceCount: number;
}

// ---------------------------------------------------------------------------
// Heat-Map Context Manager
// ---------------------------------------------------------------------------

export class HeatMapContextManager implements ContextManager {
  private messages: ScoredMessage[] = [];
  private turnCount: number = 0;
  private config: Required<HeatMapConfig>;

  constructor(config?: HeatMapConfig) {
    this.config = {
      decayFactor: config?.decayFactor ?? 0.85,
      baseHeat: config?.baseHeat ?? 1.0,
      referenceBoost: config?.referenceBoost ?? 0.5,
      pruneThreshold: config?.pruneThreshold ?? 0.1,
    };
  }

  // -------------------------------------------------------------------------
  // ContextManager implementation
  // -------------------------------------------------------------------------

  addMessage(message: LLMMessage): void {
    this.messages.push({
      message,
      heat: this.config.baseHeat,
      addedAtTurn: this.turnCount,
      referenceCount: 0,
    });
  }

  getHistory(): LLMMessage[] {
    return this.messages.map((m) => m.message);
  }

  async prune(targetTokenCount: number): Promise<void> {
    let totalTokens = this._totalTokens();
    if (totalTokens <= targetTokenCount) return;

    // Sort prunable messages by heat score (ascending = lowest heat first)
    // System messages are never pruned.
    const prunable = this.messages
      .map((m, idx) => ({ ...m, idx }))
      .filter((m) => m.message.role !== 'system')
      .sort((a, b) => a.heat - b.heat);

    for (const candidate of prunable) {
      if (totalTokens <= targetTokenCount) break;

      const tokens = this.calculateTokenCount(candidate.message);
      totalTokens -= tokens;

      // Mark for removal by setting heat to -1
      this.messages[candidate.idx].heat = -1;
    }

    // Remove pruned messages
    this.messages = this.messages.filter((m) => m.heat >= 0);
  }

  async summarize(): Promise<string> {
    const coldMessages = this.messages.filter(
      (m) => m.heat < this.config.pruneThreshold && m.message.role !== 'system',
    );
    if (coldMessages.length === 0) return '';
    return `[${coldMessages.length} low-relevance messages, ${this.messages.length} total]`;
  }

  async injectRagContext(_query: string, _limit?: number): Promise<void> {
    // Future: integrate with src/embeddings/ for semantic context injection
  }

  calculateTokenCount(message: LLMMessage): number {
    return (message.content?.length ?? 0) / 4;
  }

  // -------------------------------------------------------------------------
  // Heat-map operations
  // -------------------------------------------------------------------------

  /**
   * Advance the turn counter and decay all heat scores.
   * Call this at the start of each LLM turn.
   */
  advanceTurn(): void {
    this.turnCount++;
    for (const m of this.messages) {
      // System messages maintain max heat
      if (m.message.role === 'system') continue;
      m.heat *= this.config.decayFactor;
    }
  }

  /**
   * Boost heat for messages that were referenced in the model's response.
   *
   * Detection is based on content overlap: if the response contains
   * substrings from a previous message, that message gets boosted.
   *
   * @param response - The model's response content to check for references
   * @param minOverlap - Minimum substring length to count as a reference (default: 20)
   */
  boostReferencedMessages(response: string, minOverlap: number = 20): void {
    if (!response || response.length < minOverlap) return;

    const responseLower = response.toLowerCase();

    for (const m of this.messages) {
      if (m.message.role === 'system') continue;
      if (!m.message.content) continue;

      // Check if any significant substring of this message appears in the response
      const content = m.message.content.toLowerCase();
      if (content.length < minOverlap) continue;

      // Sample substrings from the message to check for overlap
      const samples = this._extractSamples(content, minOverlap);

      for (const sample of samples) {
        if (responseLower.includes(sample)) {
          m.heat += this.config.referenceBoost;
          m.referenceCount++;
          break; // One boost per message per turn
        }
      }
    }
  }

  /**
   * Manually boost a specific message's heat score.
   * Useful when the caller knows a particular message is relevant.
   */
  boostMessage(index: number, boost?: number): void {
    if (index >= 0 && index < this.messages.length) {
      this.messages[index].heat += boost ?? this.config.referenceBoost;
      this.messages[index].referenceCount++;
    }
  }

  /**
   * Get the heat scores for all messages.
   */
  getHeatMap(): Array<{ role: string; heat: number; referenceCount: number; preview: string }> {
    return this.messages.map((m) => ({
      role: m.message.role,
      heat: Math.round(m.heat * 1000) / 1000,
      referenceCount: m.referenceCount,
      preview: (m.message.content ?? '').slice(0, 60),
    }));
  }

  /**
   * Get the current turn count.
   */
  getTurnCount(): number {
    return this.turnCount;
  }

  /**
   * Get scored messages (for inspection/testing).
   */
  getScoredMessages(): ReadonlyArray<ScoredMessage> {
    return this.messages;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private _totalTokens(): number {
    return this.messages.reduce(
      (sum, m) => sum + this.calculateTokenCount(m.message),
      0,
    );
  }

  /**
   * Extract representative substrings from content for overlap detection.
   * Takes samples from the beginning, middle, and end.
   */
  private _extractSamples(content: string, length: number): string[] {
    const samples: string[] = [];
    if (content.length < length) return samples;

    // Beginning
    samples.push(content.slice(0, length));

    // Middle
    const mid = Math.floor(content.length / 2) - Math.floor(length / 2);
    if (mid > 0) {
      samples.push(content.slice(mid, mid + length));
    }

    // End
    if (content.length > length * 2) {
      samples.push(content.slice(-length));
    }

    return samples;
  }
}
