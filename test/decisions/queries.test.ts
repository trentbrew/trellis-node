import { describe, test, expect, beforeEach } from 'vitest';
import { TrellisVcsEngine } from '../../src/engine.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = '/tmp/trellis-decision-queries-test';

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

describe('Decision Queries', () => {
  beforeEach(() => {
    setupTestRepo();
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

  test('queryDecisions respects limit', async () => {
    const engine = await initEngine();

    await engine.recordDecision({ toolName: 'tool_a' });
    await engine.recordDecision({ toolName: 'tool_b' });
    await engine.recordDecision({ toolName: 'tool_c' });

    const limited = engine.queryDecisions({ limit: 2 });
    expect(limited.length).toBe(2);
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
    expect(d!.rationale).toBe('All tests passing, feature complete');
  });

  test('getDecision returns null for nonexistent ID', async () => {
    const engine = await initEngine();
    expect(engine.getDecision('DEC-999')).toBeNull();
  });

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
});
