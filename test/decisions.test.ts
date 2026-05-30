import { describe, test, expect, beforeEach } from 'vitest';
import { TrellisVcsEngine } from '../src/engine.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { HookRegistry } from '../src/decisions/hooks.js';

const TEST_DIR = '/tmp/trellis-decision-test';

function setupTestRepo() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, 'src'), { recursive: true });
  writeFileSync(join(TEST_DIR, 'src', 'index.ts'), 'export const x = 1;');
}

async function initEngine(): Promise<TrellisVcsEngine> {
  const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
  await engine.initRepo();
  engine.open();
  return engine;
}

describe('Decision Traces', () => {
  beforeEach(() => {
    setupTestRepo();
  });

  // -------------------------------------------------------------------------
  // Recording & Querying
  // -------------------------------------------------------------------------

  test('recordDecision creates a decision entity in EAV store', async () => {
    const engine = await initEngine();

    const op = await engine.recordDecision({
      toolName: 'trellis_issue_create',
      input: { title: 'Add parser' },
      outputSummary: 'Created TRL-1',
    });

    expect(op.kind).toBe('vcs:decisionRecord');
    expect(op.vcs!.decisionId).toBe('DEC-1');
    expect(op.vcs!.decisionToolName).toBe('trellis_issue_create');
  });

  test('sequential decision IDs: DEC-1, DEC-2, DEC-3', async () => {
    const engine = await initEngine();

    const op1 = await engine.recordDecision({ toolName: 'tool_a' });
    const op2 = await engine.recordDecision({ toolName: 'tool_b' });
    const op3 = await engine.recordDecision({ toolName: 'tool_c' });

    expect(op1.vcs!.decisionId).toBe('DEC-1');
    expect(op2.vcs!.decisionId).toBe('DEC-2');
    expect(op3.vcs!.decisionId).toBe('DEC-3');
  });

  test('getDecision retrieves a single decision by ID', async () => {
    const engine = await initEngine();

    await engine.recordDecision({
      toolName: 'trellis_milestone',
      outputSummary: 'Created milestone v0.2',
      context: 'User requested a release checkpoint',
      rationale: 'All tests passing, feature complete',
    });

    const d = engine.getDecision('DEC-1');
    expect(d).not.toBeNull();
    expect(d!.id).toBe('DEC-1');
    expect(d!.toolName).toBe('trellis_milestone');
    expect(d!.outputSummary).toBe('Created milestone v0.2');
    expect(d!.context).toBe('User requested a release checkpoint');
    expect(d!.rationale).toBe('All tests passing, feature complete');
  });

  test('getDecision returns null for nonexistent ID', async () => {
    const engine = await initEngine();
    expect(engine.getDecision('DEC-999')).toBeNull();
  });

  test('queryDecisions returns all decisions', async () => {
    const engine = await initEngine();

    await engine.recordDecision({ toolName: 'trellis_status' });
    await engine.recordDecision({ toolName: 'trellis_issue_create' });
    await engine.recordDecision({ toolName: 'trellis_issue_start' });

    const all = engine.queryDecisions();
    expect(all.length).toBe(3);
  });

  test('queryDecisions filters by tool pattern', async () => {
    const engine = await initEngine();

    await engine.recordDecision({ toolName: 'trellis_status' });
    await engine.recordDecision({ toolName: 'trellis_issue_create' });
    await engine.recordDecision({ toolName: 'trellis_issue_start' });

    const issueDecisions = engine.queryDecisions({
      toolPattern: 'trellis_issue_*',
    });
    expect(issueDecisions.length).toBe(2);
    expect(issueDecisions.every((d) => d.toolName.startsWith('trellis_issue_'))).toBe(true);
  });

  test('queryDecisions respects limit', async () => {
    const engine = await initEngine();

    await engine.recordDecision({ toolName: 'tool_a' });
    await engine.recordDecision({ toolName: 'tool_b' });
    await engine.recordDecision({ toolName: 'tool_c' });

    const limited = engine.queryDecisions({ limit: 2 });
    expect(limited.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Decision Chains & Related Entities
  // -------------------------------------------------------------------------

  test('getDecisionChain returns decisions linked to an entity', async () => {
    const engine = await initEngine();

    await engine.recordDecision({
      toolName: 'trellis_issue_create',
      relatedEntities: ['issue:TRL-1'],
    });
    await engine.recordDecision({
      toolName: 'trellis_issue_start',
      relatedEntities: ['issue:TRL-1'],
    });
    await engine.recordDecision({
      toolName: 'trellis_status',
      // No related entities
    });

    const chain = engine.getDecisionChain('issue:TRL-1');
    expect(chain.length).toBe(2);
    expect(chain[0].toolName).toBe('trellis_issue_create');
    expect(chain[1].toolName).toBe('trellis_issue_start');
  });

  test('getDecisionChain returns empty for unlinked entity', async () => {
    const engine = await initEngine();

    await engine.recordDecision({
      toolName: 'trellis_issue_create',
      relatedEntities: ['issue:TRL-1'],
    });

    const chain = engine.getDecisionChain('issue:TRL-99');
    expect(chain.length).toBe(0);
  });

  test('queryDecisions filters by entityId', async () => {
    const engine = await initEngine();

    await engine.recordDecision({
      toolName: 'tool_a',
      relatedEntities: ['issue:TRL-1'],
    });
    await engine.recordDecision({
      toolName: 'tool_b',
      relatedEntities: ['issue:TRL-2'],
    });

    const filtered = engine.queryDecisions({ entityId: 'issue:TRL-1' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].toolName).toBe('tool_a');
  });

  // -------------------------------------------------------------------------
  // Alternatives stored as JSON
  // -------------------------------------------------------------------------

  test('decision with alternatives stores and retrieves them', async () => {
    const engine = await initEngine();

    await engine.recordDecision({
      toolName: 'trellis_branch',
      rationale: 'Need feature isolation',
      alternatives: ['work on main', 'use worktree'],
    });

    const d = engine.getDecision('DEC-1');
    expect(d!.alternatives).toEqual(['work on main', 'use worktree']);
  });
});

describe('HookRegistry', () => {
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

  test('post-hooks merge enrichments', async () => {
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

    // Should not throw
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
