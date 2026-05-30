import { describe, test, expect, beforeEach } from 'vitest';
import { TrellisVcsEngine } from '../../src/engine.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = '/tmp/trellis-decision-autocapture-test';

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

describe('Decision Auto-Capture', () => {
  beforeEach(() => {
    setupTestRepo();
  });

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

  test('decision ops include toolName, input summary, output summary', async () => {
    const engine = await initEngine();

    const op = await engine.recordDecision({
      toolName: 'trellis_milestone',
      input: { message: 'v0.2.0 release' },
      outputSummary: 'Milestone created with 15 ops',
    });

    expect(op.vcs!.decisionToolName).toBe('trellis_milestone');
    expect(op.vcs!.decisionToolInput).toContain('v0.2.0 release');
    expect(op.vcs!.decisionToolOutput).toBe('Milestone created with 15 ops');
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

  test('decision with context and rationale stores them', async () => {
    const engine = await initEngine();

    await engine.recordDecision({
      toolName: 'trellis_branch',
      context: 'User asked for feature isolation',
      rationale: 'Need separate branch for experimental parser',
      alternatives: ['work on main', 'use worktree'],
    });

    const d = engine.getDecision('DEC-1');
    expect(d).not.toBeNull();
    expect(d!.context).toBe('User asked for feature isolation');
    expect(d!.rationale).toBe('Need separate branch for experimental parser');
    expect(d!.alternatives).toEqual(['work on main', 'use worktree']);
  });
});
