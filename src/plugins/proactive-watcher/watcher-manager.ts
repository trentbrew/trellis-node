/**
 * Watcher Manager
 *
 * Processes kernel operations asynchronously, evaluates simple heuristics,
 * and launches background agent tasks to generate Proactive Suggestions.
 */

import type { TrellisKernel } from '../../core/kernel/trellis-kernel.js';
import type { AgentHarness } from '../../core/agents/harness.js';
import type { KernelOp } from '../../core/persist/backend.js';
import type { PluginContext } from '../../core/plugins/types.js';

export interface WatcherRule {
  id: string;
  description: string;
  /** Evaluate if the rule matches this operation */
  condition: (op: KernelOp, kernel: TrellisKernel) => boolean;
  /** Agent ID to invoke if condition matches */
  agentId: string;
  /** Generate the prompt for the agent based on the operation */
  promptFactory: (op: KernelOp) => string;
}

export class WatcherManager {
  private kernel: TrellisKernel;
  private harness: AgentHarness;
  private ctx: PluginContext | null = null;
  private rules: WatcherRule[] = [];
  private suggestionCounter = 0;

  constructor(kernel: TrellisKernel, harness: AgentHarness) {
    this.kernel = kernel;
    this.harness = harness;
  }

  setContext(ctx: PluginContext | null): void {
    this.ctx = ctx;
  }

  addRule(rule: WatcherRule): void {
    this.rules.push(rule);
  }

  /**
   * Called by the event handler on `op:applied`.
   */
  async processOperation(data: unknown): Promise<void> {
    // Basic validation of KernelOp
    if (!data || typeof data !== 'object') return;
    const op = data as KernelOp;
    if (!op.kind || !op.hash) return;

    // Fast return if operation was just creating suggestions
    // to prevent infinite loops of suggestions generating suggestions
    if (op.facts?.some((f) => f.a === 'type' && f.v === 'AgentSuggestion')) {
      return;
    }

    const matchedRules = this.rules.filter((rule) => {
      try {
        return rule.condition(op, this.kernel);
      } catch {
        return false;
      }
    });

    if (matchedRules.length === 0) return;

    for (const rule of matchedRules) {
      this.ctx?.log(`Rule "${rule.id}" matched op ${op.hash}. Spawning agent "${rule.agentId}"...`);
      // Spawn background agent evaluation
      this._evaluateRule(rule, op).catch((err) => {
        this.ctx?.log(`Error evaluating rule "${rule.id}": ${err}`);
      });
    }
  }

  private async _evaluateRule(rule: WatcherRule, op: KernelOp): Promise<void> {
    // 1. Ensure the agent exists
    let agent = this.harness.getAgent(rule.agentId);
    if (!agent) {
      // Auto-create a default proactive agent if it doesn't exist
      agent = await this.harness.createAgent({
        id: rule.agentId,
        name: 'Proactive Watcher Agent',
        description: 'Analyzes graph changes and proposes proactive suggestions',
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: `You are a proactive monitoring agent. Your job is to look at recent changes to the system graph 
and generate helpful suggestions (AgentSuggestion) for the user.
If you decide a suggestion is warranted, use the 'createSuggestion' tool to submit it.
If no suggestion is needed, simply respond that no action is necessary.`,
        tools: ['createSuggestion'],
        status: 'active',
      });
    }

    // Ensure tool is registered on the harness
    if (!this.harness.getToolHandler('createSuggestion')) {
      await this.harness.registerTool(
        {
          id: 'createSuggestion',
          name: 'createSuggestion',
          description: 'Create an AgentSuggestion entity in the graph.',
          schema: JSON.stringify({
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              type: { type: 'string' },
              confidence: { type: 'number' },
              relatedEntityId: { type: 'string' },
            },
            required: ['title', 'description', 'type'],
          }),
        },
        async (input) => {
          const { title, description, type, confidence, relatedEntityId } =
            input as Record<string, any>;
            
          const suggestionId = `suggestion:${Date.now()}:${++this.suggestionCounter}`;
          
          await this.kernel.createEntity(suggestionId, 'AgentSuggestion', {
            title,
            description,
            type,
            status: 'pending',
            ...(confidence !== undefined ? { confidence } : {}),
          });

          if (relatedEntityId) {
            await this.kernel.addLink(suggestionId, 'suggestsFor', relatedEntityId);
          }
          await this.kernel.addLink(suggestionId, 'generatedByRule', rule.id);

          return { success: true, output: { suggestionId } };
        }
      );
    }

    const prompt = rule.promptFactory(op);

    // 2. Run the agent task
    try {
      await this.harness.runAgentTask(agent.id, prompt);
    } catch (err: any) {
      this.ctx?.log(`Agent task failed for rule "${rule.id}": ${err.message}`);
    }
  }
}
