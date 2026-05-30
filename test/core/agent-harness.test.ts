/**
 * Tests for the Agent Harness — agent CRUD, runs, tools, decision traces.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { SqliteKernelBackend } from '../../src/core/persist/sqlite-backend.js';
import { AgentHarness } from '../../src/core/agents/harness.js';

describe('AgentHarness', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;
  let harness: AgentHarness;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-agent-'));
    kernel = new TrellisKernel({
      backend: new SqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    kernel.boot();
    harness = new AgentHarness(kernel);
  });

  afterEach(() => {
    kernel.close();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  // -----------------------------------------------------------------------
  // Agent CRUD
  // -----------------------------------------------------------------------

  it('should create an agent', async () => {
    const agent = await harness.createAgent({
      name: 'Code Reviewer',
      description: 'Reviews pull requests',
      model: 'gpt-4',
      provider: 'openai',
      status: 'active',
    });

    expect(agent.name).toBe('Code Reviewer');
    expect(agent.model).toBe('gpt-4');
    expect(agent.status).toBe('active');
  });

  it('should get an agent by ID', async () => {
    await harness.createAgent({
      id: 'agent:reviewer',
      name: 'Reviewer',
      status: 'active',
    });

    const agent = harness.getAgent('agent:reviewer');
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe('Reviewer');
  });

  it('should list agents', async () => {
    await harness.createAgent({ name: 'Agent A', status: 'active' });
    await harness.createAgent({ name: 'Agent B', status: 'inactive' });

    const all = harness.listAgents();
    expect(all).toHaveLength(2);

    const active = harness.listAgents('active');
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('Agent A');
  });

  it('should create agent with capabilities and tools', async () => {
    const toolId = await harness.registerTool(
      { name: 'grep', description: 'Search files' },
      async () => ({ success: true, output: 'found' }),
    );

    await kernel.createEntity('cap:code-review', 'AgentCapability', {
      name: 'Code Review',
    });

    const agent = await harness.createAgent({
      name: 'Reviewer',
      status: 'active',
      capabilities: ['cap:code-review'],
      tools: [toolId],
    });

    expect(agent.capabilities).toContain('cap:code-review');
    expect(agent.tools).toContain(toolId);
  });

  // -----------------------------------------------------------------------
  // Tool registration
  // -----------------------------------------------------------------------

  it('should register and list tools', async () => {
    await harness.registerTool(
      { name: 'search', description: 'Search the codebase' },
      async () => ({ success: true, output: 'results' }),
    );
    await harness.registerTool(
      { name: 'edit', description: 'Edit a file' },
      async () => ({ success: true, output: 'edited' }),
    );

    const tools = harness.listTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(['edit', 'search']);
  });

  it('should invoke a registered tool', async () => {
    const agentDef = await harness.createAgent({ name: 'Test', status: 'active' });
    const runId = await harness.startRun(agentDef.id);

    await harness.registerTool(
      { name: 'echo', description: 'Echo input' },
      async (input) => ({ success: true, output: input }),
    );

    const result = await harness.invokeTool(runId, 'tool:echo', { msg: 'hello' });
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ msg: 'hello' });
  });

  // -----------------------------------------------------------------------
  // Run management
  // -----------------------------------------------------------------------

  it('should start and complete a run', async () => {
    const agent = await harness.createAgent({ name: 'Worker', status: 'active' });
    const runId = await harness.startRun(agent.id, 'Fix the bug');

    const run = harness.getRun(runId);
    expect(run).not.toBeNull();
    expect(run!.status).toBe('running');
    expect(run!.input).toBe('Fix the bug');
    expect(run!.agentId).toBe(agent.id);

    await harness.completeRun(runId, 'Bug fixed', 1500);

    const completed = harness.getRun(runId);
    expect(completed!.status).toBe('completed');
    expect(completed!.output).toBe('Bug fixed');
    expect(completed!.totalTokens).toBe(1500);
  });

  it('should fail a run', async () => {
    const agent = await harness.createAgent({ name: 'Worker', status: 'active' });
    const runId = await harness.startRun(agent.id);

    await harness.failRun(runId, 'Out of tokens');

    const run = harness.getRun(runId);
    expect(run!.status).toBe('failed');
    expect(run!.output).toContain('Out of tokens');
  });

  it('should list runs', async () => {
    const a1 = await harness.createAgent({ name: 'A1', status: 'active' });
    const a2 = await harness.createAgent({ name: 'A2', status: 'active' });

    await harness.startRun(a1.id);
    await harness.startRun(a1.id);
    await harness.startRun(a2.id);

    const allRuns = harness.listRuns();
    expect(allRuns).toHaveLength(3);

    const a1Runs = harness.listRuns(a1.id);
    expect(a1Runs).toHaveLength(2);
  });

  it('should throw when starting run for non-existent agent', async () => {
    await expect(harness.startRun('agent:nonexistent'))
      .rejects.toThrow('not found');
  });

  // -----------------------------------------------------------------------
  // Decision traces
  // -----------------------------------------------------------------------

  it('should record decision traces', async () => {
    const agent = await harness.createAgent({ name: 'Tracer', status: 'active' });
    const runId = await harness.startRun(agent.id);

    const decId = await harness.recordDecision(
      runId,
      'file_search',
      { query: 'authentication' },
      'Found 3 files',
      { rationale: 'Need to find auth-related code' },
    );

    expect(decId).toBeTruthy();

    const run = harness.getRun(runId);
    expect(run!.decisions).toHaveLength(1);
    expect(run!.decisions[0].toolName).toBe('file_search');
    expect(run!.decisions[0].output).toBe('Found 3 files');
    expect(run!.decisions[0].rationale).toBe('Need to find auth-related code');
  });

  it('should auto-record decisions on tool invocations', async () => {
    const agent = await harness.createAgent({ name: 'AutoTracer', status: 'active' });
    const runId = await harness.startRun(agent.id);

    await harness.registerTool(
      { name: 'grep', description: 'Search' },
      async (input) => ({ success: true, output: `Found: ${input.pattern}` }),
    );

    await harness.invokeTool(runId, 'tool:grep', { pattern: 'TODO' });
    await harness.invokeTool(runId, 'tool:grep', { pattern: 'FIXME' });

    const run = harness.getRun(runId);
    expect(run!.decisions).toHaveLength(2);
    expect(run!.decisions[0].toolName).toBe('grep');
  });

  it('should track decision chains for entities', async () => {
    const agent = await harness.createAgent({ name: 'ChainTest', status: 'active' });
    const runId = await harness.startRun(agent.id);

    await kernel.createEntity('proj:target', 'Project', { name: 'Target' });

    await harness.recordDecision(runId, 'analyze', {}, 'analyzed', {
      relatedEntities: ['proj:target'],
    });
    await harness.recordDecision(runId, 'modify', {}, 'modified', {
      relatedEntities: ['proj:target'],
    });

    const chain = harness.getDecisionChain('proj:target');
    expect(chain).toHaveLength(2);
    expect(chain[0].toolName).toBe('analyze');
  });

  it('should not record decisions when disabled', async () => {
    const quietHarness = new AgentHarness(kernel, { recordDecisions: false });
    const agent = await quietHarness.createAgent({ name: 'Quiet', status: 'active' });
    const runId = await quietHarness.startRun(agent.id);

    await quietHarness.registerTool(
      { name: 'silent', description: 'No trace' },
      async () => ({ success: true, output: 'done' }),
    );

    await quietHarness.invokeTool(runId, 'tool:silent', {});

    const run = quietHarness.getRun(runId);
    expect(run!.decisions).toHaveLength(0);
  });
});
