/**
 * Agent Harness — Runtime for managing agent definitions, runs, and decisions.
 *
 * Loads agent definitions from the graph (TrellisKernel), manages tool
 * registrations, executes runs, and records decision traces as kernel entities.
 *
 * @module trellis/core/agents
 */

import type { TrellisKernel } from '../kernel/trellis-kernel.js';
import type {
  AgentDef,
  ToolDef,
  ToolHandler,
  ToolResult,
  AgentRun,
  DecisionTrace,
  RunStatus,
  AgentHarnessConfig,
  RunTaskOptions,
} from './types.js';

// ---------------------------------------------------------------------------
// Agent Harness
// ---------------------------------------------------------------------------

export class AgentHarness {
  private kernel: TrellisKernel;
  private toolHandlers: Map<string, ToolHandler> = new Map();
  private config: AgentHarnessConfig;
  private runCounter: number = 0;

  constructor(kernel: TrellisKernel, config?: AgentHarnessConfig) {
    this.kernel = kernel;
    this.config = {
      recordDecisions: true,
      maxDecisionsPerRun: 100,
      ...config,
    };
  }

  // ... (existing methods)

  /**
   * Execute an autonomous task run using the configured LLM provider.
   *
   * When the configured contextManager is a GraphContextManager, conversations
   * are automatically created (or resumed) and linked to the agent run. Pass
   * `opts.conversationId` to resume an existing conversation.
   */
  async runAgentTask(agentId: string, input: string, opts?: RunTaskOptions): Promise<string> {
    if (!this.config.llmProvider) {
      throw new Error('AgentHarness: No llmProvider configured for autonomous tasks.');
    }

    const agent = this.getAgent(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" not found.`);

    const runId = await this.startRun(agentId, input);
    const context = this.config.contextManager;

    // If the context manager supports graph-backed conversations, wire it up.
    if (context && typeof (context as any).createConversation === 'function') {
      const gcm = context as import('../../plugins/agent-memory/graph-context-manager.js').GraphContextManager;
      if (opts?.conversationId) {
        await gcm.resumeConversation(opts.conversationId);
      } else {
        const convId = await gcm.createConversation({
          title: opts?.conversationTitle ?? input.slice(0, 80),
          agentId,
          model: agent.model,
        });
        // Link conversation to run
        await this.kernel.addLink(runId, 'hasConversation', convId);
      }
    }

    if (context && agent.systemPrompt) {
      context.addMessage({ role: 'system', content: agent.systemPrompt });
    }
    if (context) {
      context.addMessage({ role: 'user', content: input });
    }

    let turnCount = 0;
    const maxTurns = agent.maxTokens ?? 10; // Simple heuristic for now

    try {
      while (turnCount < maxTurns) {
        turnCount++;

        const messages = context ? context.getHistory() : [
          ...(agent.systemPrompt ? [{ role: 'system', content: agent.systemPrompt } as const] : []),
          { role: 'user', content: input } as const
        ];

        const response = await this.config.llmProvider.complete(messages as any, {
          model: agent.model,
          temperature: agent.temperature,
          tools: this._getAvailableTools(agent.tools),
        });

        const message = response.choices[0].message;
        if (context) context.addMessage(message);

        // Handle tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          let planPending = false;

          for (const call of message.tool_calls) {
            const result = await this.invokeTool(runId, call.function.name, JSON.parse(call.function.arguments));

            if (context) {
              context.addMessage({
                role: 'tool',
                tool_call_id: call.id,
                name: call.function.name,
                content: result.success ? JSON.stringify(result.output) : result.error ?? 'Unknown error'
              });
            }

            // Check if a tool signaled plan_pending (e.g., submitPlan)
            if (result.success && result.output && typeof result.output === 'object' && (result.output as any)._planPending) {
              planPending = true;
            }
          }

          // If a plan was submitted, pause the loop and yield to the caller
          if (planPending) {
            await this.kernel.updateEntity(runId, { status: 'plan_pending' });
            return runId;
          }

          continue; // Next turn after tool execution
        }

        // Final response received
        await this.completeRun(runId, message.content ?? '', response.usage?.total_tokens);
        return runId;
      }

      throw new Error(`Agent run exceeded maximum turns (${maxTurns}).`);
    } catch (err: any) {
      await this.failRun(runId, err.message);
      throw err;
    }
  }

  private _getAvailableTools(toolIds: string[]): any[] {
    return this.listTools()
      .filter(t => toolIds.includes(t.id))
      .map(t => ({
        type: 'function',
        function: {
          name: t.id,
          description: t.description,
          parameters: t.schema ? JSON.parse(t.schema) : { type: 'object', properties: {} }
        }
      }));
  }

  // -------------------------------------------------------------------------
  // Agent CRUD (via kernel entities)
  // -------------------------------------------------------------------------

  async createAgent(
    def: Omit<AgentDef, 'id' | 'capabilities' | 'tools'> & {
      id?: string;
      capabilities?: string[];
      tools?: string[];
    },
  ): Promise<AgentDef> {
    const id = def.id ?? `agent:${def.name.toLowerCase().replace(/\s+/g, '-')}`;
    await this.kernel.createEntity(id, 'Agent', {
      name: def.name,
      ...(def.description ? { description: def.description } : {}),
      ...(def.model ? { model: def.model } : {}),
      ...(def.provider ? { provider: def.provider } : {}),
      ...(def.systemPrompt ? { systemPrompt: def.systemPrompt } : {}),
      status: def.status ?? 'active',
    });

    // Add capability links
    if (def.capabilities) {
      for (const cap of def.capabilities) {
        await this.kernel.addLink(id, 'hasCapability', cap);
      }
    }

    // Add tool links
    if (def.tools) {
      for (const tool of def.tools) {
        await this.kernel.addLink(id, 'hasTool', tool);
      }
    }

    return this.getAgent(id)!;
  }

  getAgent(id: string): AgentDef | null {
    const entity = this.kernel.getEntity(id);
    if (!entity || entity.type !== 'Agent') return null;

    const store = this.kernel.getStore();
    const capLinks = store.getLinksByEntityAndAttribute(id, 'hasCapability');
    const toolLinks = store.getLinksByEntityAndAttribute(id, 'hasTool');

    return {
      id: entity.id,
      name: String(entity.facts.find((f) => f.a === 'name')?.v ?? ''),
      description: entity.facts.find((f) => f.a === 'description')?.v as
        | string
        | undefined,
      model: entity.facts.find((f) => f.a === 'model')?.v as string | undefined,
      provider: entity.facts.find((f) => f.a === 'provider')?.v as
        | string
        | undefined,
      systemPrompt: entity.facts.find((f) => f.a === 'systemPrompt')?.v as
        | string
        | undefined,
      status:
        (entity.facts.find((f) => f.a === 'status')?.v as AgentDef['status']) ??
        'active',
      capabilities: capLinks.map((l) => l.e2),
      tools: toolLinks.map((l) => l.e2),
    };
  }

  listAgents(status?: AgentDef['status']): AgentDef[] {
    const entities = this.kernel.listEntities(
      'Agent',
      status ? { status } : undefined,
    );
    return entities
      .map((e) => this.getAgent(e.id))
      .filter((a): a is AgentDef => a !== null);
  }

  // -------------------------------------------------------------------------
  // Tool registration
  // -------------------------------------------------------------------------

  async registerTool(
    def: Omit<ToolDef, 'id'> & { id?: string },
    handler: ToolHandler,
  ): Promise<string> {
    const id = def.id ?? `tool:${def.name.toLowerCase().replace(/\s+/g, '-')}`;

    // Create tool entity if it doesn't exist
    if (!this.kernel.getEntity(id)) {
      await this.kernel.createEntity(id, 'Tool', {
        name: def.name,
        ...(def.description ? { description: def.description } : {}),
        ...(def.schema ? { schema: def.schema } : {}),
        ...(def.endpoint ? { endpoint: def.endpoint } : {}),
      });
    }

    this.toolHandlers.set(id, handler);
    return id;
  }

  getToolHandler(toolId: string): ToolHandler | undefined {
    return this.toolHandlers.get(toolId);
  }

  listTools(): ToolDef[] {
    return this.kernel.listEntities('Tool').map((e) => ({
      id: e.id,
      name: String(e.facts.find((f) => f.a === 'name')?.v ?? ''),
      description: e.facts.find((f) => f.a === 'description')?.v as
        | string
        | undefined,
      schema: e.facts.find((f) => f.a === 'schema')?.v as string | undefined,
      endpoint: e.facts.find((f) => f.a === 'endpoint')?.v as
        | string
        | undefined,
    }));
  }

  // -------------------------------------------------------------------------
  // Run management
  // -------------------------------------------------------------------------

  async startRun(agentId: string, input?: string): Promise<string> {
    const agent = this.getAgent(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" not found.`);

    // Ensure unique run IDs even when called in rapid succession
    const runId = `run:${agentId.replace('agent:', '')}:${Date.now()}:${++this.runCounter}`;
    await this.kernel.createEntity(runId, 'AgentRun', {
      startedAt: new Date().toISOString(),
      status: 'running',
      ...(input ? { input } : {}),
    });
    await this.kernel.addLink(runId, 'executedBy', agentId);

    return runId;
  }

  async completeRun(
    runId: string,
    output?: string,
    tokenCount?: number,
  ): Promise<void> {
    const updates: Record<string, any> = {
      status: 'completed',
      completedAt: new Date().toISOString(),
    };
    if (output) updates.output = output;
    if (tokenCount !== undefined) updates.totalTokens = tokenCount;
    await this.kernel.updateEntity(runId, updates);
  }

  async failRun(runId: string, error: string): Promise<void> {
    await this.kernel.updateEntity(runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      output: `Error: ${error}`,
    });
  }

  getRun(runId: string): AgentRun | null {
    const entity = this.kernel.getEntity(runId);
    if (!entity || entity.type !== 'AgentRun') return null;

    const store = this.kernel.getStore();
    const agentLink = store.getLinksByEntityAndAttribute(runId, 'executedBy');
    const agentId = agentLink[0]?.e2 ?? '';

    // Get decisions for this run
    const decisionLinks = store.getLinksByAttribute('belongsToRun');
    const decisionIds = decisionLinks
      .filter((l) => l.e2 === runId)
      .map((l) => l.e1);
    const decisions = decisionIds
      .map((did) => this._buildDecisionTrace(did))
      .filter(Boolean) as DecisionTrace[];

    const get = (a: string) => entity.facts.find((f) => f.a === a)?.v;

    return {
      id: runId,
      agentId,
      startedAt: String(get('startedAt') ?? ''),
      completedAt: get('completedAt') as string | undefined,
      status: (get('status') as RunStatus) ?? 'running',
      input: get('input') as string | undefined,
      output: get('output') as string | undefined,
      totalTokens: get('totalTokens') as number | undefined,
      promptTokens: get('promptTokens') as number | undefined,
      completionTokens: get('completionTokens') as number | undefined,
      decisions,
    };
  }

  listRuns(agentId?: string): AgentRun[] {
    const runs = this.kernel.listEntities('AgentRun');
    return runs
      .map((e) => this.getRun(e.id))
      .filter((r): r is AgentRun => r !== null)
      .filter((r) => !agentId || r.agentId === agentId)
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );
  }

  // -------------------------------------------------------------------------
  // Decision trace recording
  // -------------------------------------------------------------------------

  async recordDecision(
    runId: string,
    toolName: string,
    input?: Record<string, unknown>,
    output?: string,
    opts?: {
      rationale?: string;
      alternatives?: string[];
      relatedEntities?: string[];
    },
  ): Promise<string> {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run "${runId}" not found.`);

    const decId = `decision:${runId.replace('run:', '')}:${Date.now()}`;
    await this.kernel.createEntity(decId, 'DecisionTrace', {
      toolName,
      timestamp: new Date().toISOString(),
      ...(input ? { input: JSON.stringify(input) } : {}),
      ...(output ? { output } : {}),
      ...(opts?.rationale ? { rationale: opts.rationale } : {}),
      ...(opts?.alternatives
        ? { alternatives: JSON.stringify(opts.alternatives) }
        : {}),
    });

    // Link decision to run and agent
    await this.kernel.addLink(decId, 'belongsToRun', runId);
    await this.kernel.addLink(decId, 'madeBy', run.agentId);

    // Link to related entities
    if (opts?.relatedEntities) {
      for (const eid of opts.relatedEntities) {
        await this.kernel.addLink(decId, 'relatedTo', eid);
      }
    }

    return decId;
  }

  /**
   * Invoke a registered tool within a run, auto-recording a decision trace.
   */
  async invokeTool(
    runId: string,
    toolId: string,
    input: Record<string, unknown>,
    opts?: { rationale?: string; relatedEntities?: string[] },
  ): Promise<ToolResult> {
    const handler = this.toolHandlers.get(toolId);
    if (!handler)
      throw new Error(`No handler registered for tool "${toolId}".`);

    const result = await handler(input);

    if (this.config.recordDecisions) {
      const toolEntity = this.kernel.getEntity(toolId);
      const toolName = toolEntity
        ? String(toolEntity.facts.find((f) => f.a === 'name')?.v ?? toolId)
        : toolId;

      await this.recordDecision(
        runId,
        toolName,
        input,
        result.success ? String(result.output ?? '') : `Error: ${result.error}`,
        opts,
      );
    }

    return result;
  }

  getDecisionChain(entityId: string): DecisionTrace[] {
    const store = this.kernel.getStore();
    const links = store.getLinksByAttribute('relatedTo');
    const decisionIds = links.filter((l) => l.e2 === entityId).map((l) => l.e1);
    return decisionIds
      .map((did) => this._buildDecisionTrace(did))
      .filter(Boolean) as DecisionTrace[];
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private _buildDecisionTrace(decId: string): DecisionTrace | null {
    const entity = this.kernel.getEntity(decId);
    if (!entity) return null;

    const get = (a: string) => entity.facts.find((f) => f.a === a)?.v;
    const store = this.kernel.getStore();

    const runLink = store.getLinksByEntityAndAttribute(decId, 'belongsToRun');
    const agentLink = store.getLinksByEntityAndAttribute(decId, 'madeBy');
    const relatedLinks = store.getLinksByEntityAndAttribute(decId, 'relatedTo');

    let inputParsed: Record<string, unknown> | undefined;
    const inputRaw = get('input') as string | undefined;
    if (inputRaw) {
      try {
        inputParsed = JSON.parse(inputRaw);
      } catch {
        inputParsed = { raw: inputRaw };
      }
    }

    let alternatives: string[] | undefined;
    const altRaw = get('alternatives') as string | undefined;
    if (altRaw) {
      try {
        alternatives = JSON.parse(altRaw);
      } catch {
        alternatives = [altRaw];
      }
    }

    return {
      id: decId,
      runId: runLink[0]?.e2 ?? '',
      agentId: agentLink[0]?.e2 ?? '',
      toolName: String(get('toolName') ?? ''),
      input: inputParsed,
      output: get('output') as string | undefined,
      rationale: get('rationale') as string | undefined,
      alternatives,
      timestamp: String(get('timestamp') ?? ''),
      relatedEntities: relatedLinks.map((l) => l.e2),
    };
  }
}
