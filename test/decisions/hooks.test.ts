import { describe, test, expect } from 'vitest';
import { HookRegistry } from '../../src/decisions/hooks.js';

describe('Decision Hook Registry', () => {
  test('pre-hooks match by glob pattern', async () => {
    const registry = new HookRegistry();
    const calls: string[] = [];

    registry.registerPreHook({
      name: 'test-pre',
      toolPattern: 'trellis_issue_*',
      handler: async (toolName) => {
        calls.push(toolName);
        return { prompt: 'test prompt' };
      },
    });

    const ctx = await registry.runPreHooks('trellis_issue_create', {});
    expect(calls).toEqual(['trellis_issue_create']);
    expect(ctx.prompt).toBe('test prompt');

    // Non-matching tool should not trigger hook
    await registry.runPreHooks('trellis_status', {});
    expect(calls.length).toBe(1);
  });

  test('pre-hooks inject context before tool execution', async () => {
    const registry = new HookRegistry();

    registry.registerPreHook({
      name: 'context-injector',
      toolPattern: '*',
      handler: async () => ({
        prompt: 'Fix the parser bug',
        conversationId: 'conv-123',
        agentModel: 'claude-4',
      }),
    });

    const ctx = await registry.runPreHooks('trellis_issue_create', { title: 'Fix parser' });
    expect(ctx.prompt).toBe('Fix the parser bug');
    expect(ctx.conversationId).toBe('conv-123');
    expect(ctx.agentModel).toBe('claude-4');
  });

  test('post-hooks enrich traces with rationale and alternatives', async () => {
    const registry = new HookRegistry();

    registry.registerPostHook({
      name: 'hook-a',
      toolPattern: '*',
      handler: async () => ({
        rationale: 'Because tests',
        alternatives: ['opt A'],
      }),
    });

    registry.registerPostHook({
      name: 'hook-b',
      toolPattern: '*',
      handler: async () => ({
        relatedEntities: ['issue:TRL-1'],
        custom: { model: 'gpt-4' },
      }),
    });

    const enrichment = await registry.runPostHooks('any_tool', {}, null, {});
    expect(enrichment.rationale).toBe('Because tests');
    expect(enrichment.alternatives).toEqual(['opt A']);
    expect(enrichment.relatedEntities).toEqual(['issue:TRL-1']);
    expect(enrichment.custom?.model).toBe('gpt-4');
  });

  test('removePreHook and removePostHook work', () => {
    const registry = new HookRegistry();

    registry.registerPreHook({
      name: 'to-remove',
      toolPattern: '*',
      handler: async () => ({}),
    });

    expect(registry.getPreHooks('anything').length).toBe(1);
    registry.removePreHook('to-remove');
    expect(registry.getPreHooks('anything').length).toBe(0);
  });

  test('hook errors do not break execution', async () => {
    const registry = new HookRegistry();

    registry.registerPreHook({
      name: 'broken',
      toolPattern: '*',
      handler: async () => {
        throw new Error('hook failed');
      },
    });

    const ctx = await registry.runPreHooks('trellis_status', {});
    expect(ctx).toEqual({});
  });

  test('clear removes all hooks', () => {
    const registry = new HookRegistry();

    registry.registerPreHook({
      name: 'a',
      toolPattern: '*',
      handler: async () => ({}),
    });
    registry.registerPostHook({
      name: 'b',
      toolPattern: '*',
      handler: async () => ({}),
    });

    registry.clear();
    expect(registry.getPreHooks('x').length).toBe(0);
    expect(registry.getPostHooks('x').length).toBe(0);
  });
});
