/**
 * Tests for the Heat-Map Context Manager — relevance-weighted pruning.
 */

import { describe, it, expect } from 'vitest';
import { HeatMapContextManager } from '../../src/context/heat-map-manager.js';

describe('HeatMapContextManager', () => {
  // -------------------------------------------------------------------------
  // Basic ContextManager behavior
  // -------------------------------------------------------------------------

  it('should add and retrieve messages', () => {
    const ctx = new HeatMapContextManager();
    ctx.addMessage({ role: 'system', content: 'You are helpful.' });
    ctx.addMessage({ role: 'user', content: 'Hello' });
    ctx.addMessage({ role: 'assistant', content: 'Hi!' });

    const history = ctx.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0].role).toBe('system');
    expect(history[1].role).toBe('user');
    expect(history[2].role).toBe('assistant');
  });

  it('should calculate token count', () => {
    const ctx = new HeatMapContextManager();
    expect(ctx.calculateTokenCount({ role: 'user', content: 'Hello world!' })).toBe(3); // 12/4
    expect(ctx.calculateTokenCount({ role: 'user', content: null })).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Heat decay
  // -------------------------------------------------------------------------

  it('should decay heat scores on advanceTurn()', () => {
    const ctx = new HeatMapContextManager({ decayFactor: 0.5 });
    ctx.addMessage({ role: 'user', content: 'First message' });

    const initial = ctx.getScoredMessages()[0].heat;
    expect(initial).toBe(1.0);

    ctx.advanceTurn();
    expect(ctx.getScoredMessages()[0].heat).toBe(0.5);

    ctx.advanceTurn();
    expect(ctx.getScoredMessages()[0].heat).toBe(0.25);
  });

  it('should NOT decay system message heat', () => {
    const ctx = new HeatMapContextManager({ decayFactor: 0.5 });
    ctx.addMessage({ role: 'system', content: 'System prompt' });

    ctx.advanceTurn();
    ctx.advanceTurn();
    ctx.advanceTurn();

    expect(ctx.getScoredMessages()[0].heat).toBe(1.0);
  });

  it('should track turn count', () => {
    const ctx = new HeatMapContextManager();
    expect(ctx.getTurnCount()).toBe(0);
    ctx.advanceTurn();
    expect(ctx.getTurnCount()).toBe(1);
    ctx.advanceTurn();
    ctx.advanceTurn();
    expect(ctx.getTurnCount()).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Reference boosting
  // -------------------------------------------------------------------------

  it('should boost heat for referenced messages', () => {
    const ctx = new HeatMapContextManager({ referenceBoost: 0.5 });
    ctx.addMessage({ role: 'user', content: 'The design system uses tokens for spacing and color' });
    ctx.addMessage({ role: 'user', content: 'We need to deploy to staging tonight' });

    // Simulate model response that references the first message
    ctx.boostReferencedMessages('I agree about the design system using tokens for spacing and color');

    const scores = ctx.getScoredMessages();
    expect(scores[0].heat).toBe(1.5); // base 1.0 + 0.5 boost
    expect(scores[0].referenceCount).toBe(1);
    expect(scores[1].heat).toBe(1.0); // unchanged
    expect(scores[1].referenceCount).toBe(0);
  });

  it('should only boost once per message per turn', () => {
    const ctx = new HeatMapContextManager({ referenceBoost: 0.5 });
    ctx.addMessage({
      role: 'user',
      content: 'The quick brown fox jumps over the lazy dog repeatedly',
    });

    // Response contains the content twice — should still only boost once
    ctx.boostReferencedMessages(
      'The quick brown fox jumps over the lazy dog repeatedly and The quick brown fox jumps',
    );

    expect(ctx.getScoredMessages()[0].heat).toBe(1.5);
    expect(ctx.getScoredMessages()[0].referenceCount).toBe(1);
  });

  it('should manually boost a message', () => {
    const ctx = new HeatMapContextManager({ referenceBoost: 0.3 });
    ctx.addMessage({ role: 'user', content: 'Important context' });
    ctx.addMessage({ role: 'user', content: 'Less important' });

    ctx.boostMessage(0, 1.0);

    expect(ctx.getScoredMessages()[0].heat).toBe(2.0);
    expect(ctx.getScoredMessages()[1].heat).toBe(1.0);
  });

  // -------------------------------------------------------------------------
  // Heat-aware pruning
  // -------------------------------------------------------------------------

  it('should prune lowest-heat messages first', async () => {
    const ctx = new HeatMapContextManager({ decayFactor: 0.5 });

    ctx.addMessage({ role: 'user', content: 'A'.repeat(200) }); // 50 tokens
    ctx.advanceTurn(); // heat decays to 0.5

    ctx.addMessage({ role: 'user', content: 'B'.repeat(200) }); // 50 tokens, heat 1.0
    ctx.advanceTurn(); // A→0.25, B→0.5

    ctx.addMessage({ role: 'user', content: 'C'.repeat(200) }); // 50 tokens, heat 1.0

    // Total: 150 tokens. Prune to 100 → should drop 'A' (lowest heat: 0.25)
    await ctx.prune(100);

    const history = ctx.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe('B'.repeat(200));
    expect(history[1].content).toBe('C'.repeat(200));
  });

  it('should NEVER prune system messages', async () => {
    const ctx = new HeatMapContextManager({ decayFactor: 0.1 });

    ctx.addMessage({ role: 'system', content: 'S'.repeat(200) }); // 50 tokens

    // Decay aggressively — system still shouldn't be pruned
    for (let i = 0; i < 10; i++) ctx.advanceTurn();

    ctx.addMessage({ role: 'user', content: 'U'.repeat(200) }); // 50 tokens

    // Total: 100 tokens. Prune to 60 → should drop user, keep system
    await ctx.prune(60);

    const history = ctx.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe('system');
  });

  it('should keep high-heat messages during pruning', async () => {
    const ctx = new HeatMapContextManager({ decayFactor: 0.5, referenceBoost: 2.0 });

    ctx.addMessage({ role: 'user', content: 'Old but referenced message here!' });
    ctx.addMessage({ role: 'user', content: 'New but unreferenced message!!' });

    // Decay the old message
    ctx.advanceTurn();
    ctx.advanceTurn();
    // Old message heat: 1.0 * 0.5 * 0.5 = 0.25
    // New message heat: 1.0 * 0.5 = 0.5

    // Boost the old one via reference
    ctx.boostReferencedMessages('Old but referenced message here!');
    // Old message heat: 0.25 + 2.0 = 2.25

    // Prune — old message should survive because it's been referenced
    await ctx.prune(10);

    const history = ctx.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('Old but referenced message here!');
  });

  it('should not prune when already under budget', async () => {
    const ctx = new HeatMapContextManager();
    ctx.addMessage({ role: 'user', content: 'Short' }); // ~1.25 tokens

    await ctx.prune(1000);

    expect(ctx.getHistory()).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Heat map inspection
  // -------------------------------------------------------------------------

  it('should return a readable heat map', () => {
    const ctx = new HeatMapContextManager();
    ctx.addMessage({ role: 'system', content: 'System prompt for the agent' });
    ctx.addMessage({ role: 'user', content: 'Hello there, how are you doing?' });

    const map = ctx.getHeatMap();
    expect(map).toHaveLength(2);
    expect(map[0].role).toBe('system');
    expect(map[0].heat).toBe(1);
    expect(map[0].preview).toBe('System prompt for the agent');
    expect(map[1].role).toBe('user');
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('should handle empty content messages', () => {
    const ctx = new HeatMapContextManager();
    ctx.addMessage({ role: 'assistant', content: null });

    expect(ctx.getHistory()).toHaveLength(1);
    expect(ctx.calculateTokenCount(ctx.getHistory()[0])).toBe(0);
  });

  it('should handle boost with very short messages', () => {
    const ctx = new HeatMapContextManager();
    ctx.addMessage({ role: 'user', content: 'Hi' }); // Too short for overlap detection

    // Should not crash or boost
    ctx.boostReferencedMessages('Hi there');
    expect(ctx.getScoredMessages()[0].referenceCount).toBe(0);
  });

  it('should handle pruning with all system messages', async () => {
    const ctx = new HeatMapContextManager();
    ctx.addMessage({ role: 'system', content: 'A'.repeat(400) });
    ctx.addMessage({ role: 'system', content: 'B'.repeat(400) });

    // Both are system — nothing can be pruned
    await ctx.prune(10);

    expect(ctx.getHistory()).toHaveLength(2);
  });

  it('should summarize with cold messages', async () => {
    const ctx = new HeatMapContextManager({ decayFactor: 0.01, pruneThreshold: 0.1 });
    ctx.addMessage({ role: 'user', content: 'Getting cold' });

    // Decay heavily
    for (let i = 0; i < 5; i++) ctx.advanceTurn();

    const summary = await ctx.summarize();
    expect(summary).toContain('1 low-relevance');
  });
});
