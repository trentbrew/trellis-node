/**
 * Tests for the Proactive Watcher Plugin
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'vitest';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { SqliteKernelBackend } from '../../src/core/persist/sqlite-backend.js';
import { AgentHarness } from '../../src/core/agents/harness.js';
import { PluginRegistry } from '../../src/core/plugins/registry.js';
import { createProactiveWatcherPlugin } from '../../src/plugins/proactive-watcher/plugin.js';
import type { KernelOp } from '../../src/core/persist/backend.js';
import type {
  LLMProvider,
  LLMCompletionResponse,
} from '../../src/llm/types.js';

class MockLLMProvider implements LLMProvider {
  id = 'mock';
  name = 'Mock LLM';
  private callCount = 0;

  async complete(): Promise<LLMCompletionResponse> {
    this.callCount++;

    // First turn: call the tool
    if (this.callCount === 1) {
      return {
        id: 'mock_resp_1',
        model: 'mock-model',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'createSuggestion',
                    arguments: JSON.stringify({
                      title: 'Document new feature',
                      description: 'Write docs for FeatureFlag',
                      type: 'documentation',
                      confidence: 0.9,
                      relatedEntityId: 'e-1',
                    }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
      };
    }

    return {
      id: 'mock_resp_2',
      model: 'mock-model',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'I have created the suggestion.',
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 60, completion_tokens: 10, total_tokens: 70 },
    };
  }

  async *stream() {
    yield { id: '1', choices: [{ delta: {}, finish_reason: 'stop' }] };
  }
}

describe('Proactive Watcher', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;
  let harness: AgentHarness;
  let registry: PluginRegistry;
  let provider: MockLLMProvider;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-watcher-'));
    kernel = new TrellisKernel({
      backend: new SqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    kernel.boot();

    provider = new MockLLMProvider();
    harness = new AgentHarness(kernel, {
      llmProvider: provider,
      recordDecisions: false,
    });
    registry = new PluginRegistry();
  });

  afterEach(() => {
    kernel.close();
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {}
  });

  it('should generate an AgentSuggestion when a rule matches', async () => {
    const plugin = createProactiveWatcherPlugin(kernel, harness);

    plugin.manager.addRule({
      id: 'feature-flag-docs',
      description: 'Suggest docs for new feature flags',
      agentId: 'proactive-agent',
      condition: (op: any) =>
        op.facts?.some((f: any) => f.a === 'type' && f.v === 'FeatureFlag') ??
        false,
      promptFactory: (op: any) => `A FeatureFlag was added.`,
    });

    registry.register(plugin);
    // Explicitly load the plugin to attach event handlers
    await registry.load('trellis:proactive-watcher');

    // Simulate an operation that matches
    const testOp: KernelOp = {
      hash: 'trellis:op:123',
      kind: 'addFacts',
      timestamp: new Date().toISOString(),
      agentId: 'user',
      facts: [{ e: 'e-1', a: 'type', v: 'FeatureFlag' }],
    };

    // Emit the event using the PluginRegistry EventBus (which the plugin subscribed to)
    await registry.emit('op:applied', testOp);

    // Poll until the suggestion and its links are created, up to 3000ms
    let suggestions: any[] = [];
    for (let i = 0; i < 150; i++) {
      suggestions = kernel.listEntities('AgentSuggestion');
      const hasLinks =
        suggestions.length === 1 &&
        kernel
          .getStore()
          .getLinksByEntityAndAttribute(suggestions[0].id, 'suggestsFor')
          .length === 1;
      if (hasLinks) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Verify the suggestion was created in the graph
    expect(suggestions).toHaveLength(1);

    const suggestion = suggestions[0];

    expect(suggestion.facts.find((f) => f.a === 'title')?.v).toBe(
      'Document new feature',
    );
    expect(suggestion.facts.find((f) => f.a === 'status')?.v).toBe('pending');

    const links = kernel
      .getStore()
      .getLinksByEntityAndAttribute(suggestion.id, 'suggestsFor');
    expect(links).toHaveLength(1);
    expect(links[0].e2).toBe('e-1'); // From LLM output relatedEntityId
  });

  it('should ignore operations that do not match rules', async () => {
    const plugin = createProactiveWatcherPlugin(kernel, harness);
    plugin.manager.addRule({
      id: 'feature-flag-docs',
      description: 'Suggest docs',
      agentId: 'proactive-agent',
      condition: (op: any) =>
        op.facts?.some((f: any) => f.a === 'type' && f.v === 'FeatureFlag') ??
        false,
      promptFactory: () => `Flag added.`,
    });
    registry.register(plugin);
    await registry.load('trellis:proactive-watcher');

    // Mismatched op
    const testOp: KernelOp = {
      hash: 'trellis:op:456',
      kind: 'addFacts',
      timestamp: new Date().toISOString(),
      agentId: 'user',
      facts: [{ e: 'e-2', a: 'type', v: 'Unrelated' }],
    };

    await registry.emit('op:applied', testOp);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const suggestions = kernel.listEntities('AgentSuggestion');
    expect(suggestions).toHaveLength(0);
  });

  it('should ignore operations creating suggestions (avoid loop)', async () => {
    const plugin = createProactiveWatcherPlugin(kernel, harness);

    let ruleEvaluated = false;
    plugin.manager.addRule({
      id: 'catch-all',
      description: 'Catches everything',
      agentId: 'proactive-agent',
      condition: () => {
        ruleEvaluated = true;
        return true;
      },
      promptFactory: () => `Anything.`,
    });
    registry.register(plugin);
    await registry.load('trellis:proactive-watcher');

    // Op that creates a suggestion
    const testOp: KernelOp = {
      hash: 'trellis:op:789',
      kind: 'addFacts',
      timestamp: new Date().toISOString(),
      agentId: 'user',
      facts: [{ e: 's-1', a: 'type', v: 'AgentSuggestion' }],
    };

    await registry.emit('op:applied', testOp);

    // Condition shouldn't even be called
    expect(ruleEvaluated).toBe(false);
  });
});
