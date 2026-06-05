import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { TrellisVcsEngine } from '../src/engine.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_DIR = '/tmp/trellis-issue-test';

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

describe('Issue Primitives', () => {
  beforeEach(() => {
    setupTestRepo();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('createIssue produces EAV entity with correct facts', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Add Python parser', {
      priority: 'high',
      labels: ['parser', 'semantic'],
    });

    expect(op.kind).toBe('vcs:issueCreate');
    expect(op.vcs?.issueId).toMatch(/^TRL-\d+$/);

    const issue = engine.getIssue(op.vcs!.issueId!);
    expect(issue).not.toBeNull();
    expect(issue!.title).toBe('Add Python parser');
    expect(issue!.status).toBe('backlog');
    expect(issue!.priority).toBe('high');
    expect(issue!.labels).toEqual(['parser', 'semantic']);
  });

  test('createIssue with criteria adds criterion entities', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Test issue', {
      criteria: [
        { description: 'Unit tests pass', command: 'echo ok' },
        { description: 'Manual review done' },
      ],
    });

    const issue = engine.getIssue(op.vcs!.issueId!);
    expect(issue).not.toBeNull();
    expect(issue!.criteria.length).toBe(2);
    expect(issue!.criteria[0].description).toBe('Unit tests pass');
    expect(issue!.criteria[0].command).toBe('echo ok');
    expect(issue!.criteria[0].status).toBe('pending');
    expect(issue!.criteria[1].description).toBe('Manual review done');
    expect(issue!.criteria[1].command).toBeUndefined();
  });

  test('create sub-task with childOf link', async () => {
    const engine = await initEngine();

    const parentOp = await engine.createIssue('Parser expansion', {
      priority: 'high',
    });
    const parentId = parentOp.vcs!.issueId!;

    const childOp = await engine.createIssue('Python parser', {
      parentId,
    });
    const childId = childOp.vcs!.issueId!;

    const child = engine.getIssue(childId);
    expect(child).not.toBeNull();
    expect(child!.parentId).toBe(parentId);

    // Filter by parent
    const children = engine.listIssues({ parentId });
    expect(children.length).toBe(1);
    expect(children[0].id).toBe(childId);
  });

  test('updateIssue can set, change, and clear parent', async () => {
    const engine = await initEngine();

    const epicOp = await engine.createIssue('Import epic');
    const epicId = epicOp.vcs!.issueId!;

    const orphanOp = await engine.createIssue('Import from Notion');
    const orphanId = orphanOp.vcs!.issueId!;

    await engine.updateIssue(orphanId, { parentId: epicId });
    expect(engine.getIssue(orphanId)!.parentId).toBe(epicId);

    const otherEpicOp = await engine.createIssue('Other epic');
    const otherEpicId = otherEpicOp.vcs!.issueId!;

    await engine.updateIssue(orphanId, { parentId: otherEpicId });
    expect(engine.getIssue(orphanId)!.parentId).toBe(otherEpicId);
    expect(engine.listIssues({ parentId: epicId }).length).toBe(0);
    expect(engine.listIssues({ parentId: otherEpicId }).length).toBe(1);

    await engine.updateIssue(orphanId, { parentId: null });
    expect(engine.getIssue(orphanId)!.parentId).toBeUndefined();
  });

  test('startIssue sets in_progress, creates branch, auto-assigns', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Test feature');
    const id = op.vcs!.issueId!;

    await engine.startIssue(id);

    const issue = engine.getIssue(id);
    expect(issue!.status).toBe('in_progress');
    expect(issue!.branchName).toMatch(/^issue\/TRL-\d+-test-feature$/);
    expect(issue!.assignee).toBeTruthy();
    expect(issue!.startedAt).toBeTruthy();

    // Branch should be current
    expect(engine.getCurrentBranch()).toBe(issue!.branchName);
  });

  test('pauseIssue sets paused and switches to default branch', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Pausable work');
    const id = op.vcs!.issueId!;
    await engine.startIssue(id);

    await engine.pauseIssue(id, 'Waiting for API spec before continuing');

    const issue = engine.getIssue(id);
    expect(issue!.status).toBe('paused');
    expect(issue!.pauseNote).toBe('Waiting for API spec before continuing');
    expect(engine.getCurrentBranch()).toBe('main');
  });

  test('resumeIssue sets in_progress and switches to issue branch', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Resumable work');
    const id = op.vcs!.issueId!;
    await engine.startIssue(id);
    const branchName = engine.getIssue(id)!.branchName!;

    await engine.pauseIssue(id, 'Context switch to urgent fix');
    expect(engine.getCurrentBranch()).toBe('main');

    await engine.resumeIssue(id);
    expect(engine.getIssue(id)!.status).toBe('in_progress');
    expect(engine.getIssue(id)!.pauseNote).toBeUndefined();
    expect(engine.getCurrentBranch()).toBe(branchName);
  });

  test('addCriterion appends criterion to existing issue', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Criterion test');
    const id = op.vcs!.issueId!;

    await engine.addCriterion(id, 'Tests pass', 'echo pass');
    await engine.addCriterion(id, 'Manual check');

    const issue = engine.getIssue(id);
    expect(issue!.criteria.length).toBe(2);
    expect(issue!.criteria[0].command).toBe('echo pass');
    expect(issue!.criteria[1].command).toBeUndefined();
  });

  test('runCriteria with passing command sets status=passed', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Pass test', {
      criteria: [{ description: 'Echo succeeds', command: 'echo hello' }],
    });
    const id = op.vcs!.issueId!;

    const results = await engine.runCriteria(id);
    expect(results.length).toBe(1);
    expect(results[0].status).toBe('passed');
    expect(results[0].exitCode).toBe(0);

    // Criterion should be updated in store
    const issue = engine.getIssue(id);
    expect(issue!.criteria[0].status).toBe('passed');
  });

  test('runCriteria with failing command sets status=failed', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Fail test', {
      criteria: [{ description: 'Exit 1', command: 'exit 1' }],
    });
    const id = op.vcs!.issueId!;

    const results = await engine.runCriteria(id);
    expect(results.length).toBe(1);
    expect(results[0].status).toBe('failed');

    const issue = engine.getIssue(id);
    expect(issue!.criteria[0].status).toBe('failed');
  });

  test('closeIssue with all criteria passing + confirm closes', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Closable', {
      criteria: [{ description: 'OK', command: 'echo ok' }],
    });
    const id = op.vcs!.issueId!;
    await engine.startIssue(id);

    // Run criteria first
    await engine.runCriteria(id);

    // Close with confirm
    const result = await engine.closeIssue(id, { confirm: true });
    expect(result.op).toBeTruthy();
    expect(result.op!.kind).toBe('vcs:issueClose');

    const issue = engine.getIssue(id);
    expect(issue!.status).toBe('closed');
    expect(issue!.closedAt).toBeTruthy();
  });

  test('closeIssue with failing criteria throws', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Unclosable', {
      criteria: [{ description: 'Fails', command: 'exit 1' }],
    });
    const id = op.vcs!.issueId!;

    // Run criteria (will fail)
    await engine.runCriteria(id);

    await expect(engine.closeIssue(id, { confirm: true })).rejects.toThrow(
      /criteria not passing/,
    );

    // Still open
    expect(engine.getIssue(id)!.status).not.toBe('closed');
  });

  test('closeIssue without confirm returns results but does not close', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('No confirm', {
      criteria: [{ description: 'OK', command: 'echo ok' }],
    });
    const id = op.vcs!.issueId!;
    await engine.runCriteria(id);

    const result = await engine.closeIssue(id);
    expect(result.op).toBeUndefined();
    expect(result.criteriaResults.length).toBe(1);

    // Not closed
    expect(engine.getIssue(id)!.status).not.toBe('closed');
  });

  test('reopenIssue sets status back to open', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Reopen me', {
      criteria: [{ description: 'OK', command: 'echo ok' }],
    });
    const id = op.vcs!.issueId!;
    await engine.startIssue(id);
    await engine.runCriteria(id);
    await engine.closeIssue(id, { confirm: true });

    expect(engine.getIssue(id)!.status).toBe('closed');

    await engine.reopenIssue(id);
    expect(engine.getIssue(id)!.status).toBe('queue');
  });

  test('assignIssue updates assignee fact', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Assign test');
    const id = op.vcs!.issueId!;

    await engine.assignIssue(id, 'agent:cascade');
    expect(engine.getIssue(id)!.assignee).toBe('agent:cascade');
  });

  test('listIssues filters by status, assignee, label', async () => {
    const engine = await initEngine();

    await engine.createIssue('Open one', {
      priority: 'high',
      labels: ['parser'],
    });
    const op2 = await engine.createIssue('Started one', { labels: ['cli'] });
    await engine.startIssue(op2.vcs!.issueId!);

    // Filter by status (default is now 'backlog')
    const backlogIssues = engine.listIssues({ status: 'backlog' });
    expect(backlogIssues.length).toBe(1);
    expect(backlogIssues[0].title).toBe('Open one');

    const activeIssues = engine.listIssues({ status: 'in_progress' });
    expect(activeIssues.length).toBe(1);
    expect(activeIssues[0].title).toBe('Started one');

    // Filter by label
    const parserIssues = engine.listIssues({ label: 'parser' });
    expect(parserIssues.length).toBe(1);
  });

  test('getActiveIssues returns all in_progress issues', async () => {
    const engine = await initEngine();

    const op1 = await engine.createIssue('Active 1');
    const op2 = await engine.createIssue('Active 2');
    await engine.createIssue('Not started');

    await engine.startIssue(op1.vcs!.issueId!);
    await engine.startIssue(op2.vcs!.issueId!);

    const active = engine.getActiveIssues();
    expect(active.length).toBe(2);
  });

  test('sequential ID generation produces TRL-1, TRL-2, TRL-3', async () => {
    const engine = await initEngine();

    const op1 = await engine.createIssue('First');
    const op2 = await engine.createIssue('Second');
    const op3 = await engine.createIssue('Third');

    expect(op1.vcs!.issueId).toBe('TRL-1');
    expect(op2.vcs!.issueId).toBe('TRL-2');
    expect(op3.vcs!.issueId).toBe('TRL-3');
  });

  test('lane-scoped ID generation produces canonical offline-safe issue IDs', async () => {
    const engine = await initEngine();

    const laneA1 = await engine.createIssue('Lane A first', {
      laneId: 'lane-a',
      criteria: [{ description: 'Acceptance criterion' }],
    });
    const laneA2 = await engine.createIssue('Lane A second', {
      laneId: 'lane-a',
    });
    const laneB1 = await engine.createIssue('Lane B first', {
      laneId: 'lane-b',
    });
    const global = await engine.createIssue('Global issue');

    expect(laneA1.vcs!.issueId).toBe('issue:lane-a:1');
    expect(laneA2.vcs!.issueId).toBe('issue:lane-a:2');
    expect(laneB1.vcs!.issueId).toBe('issue:lane-b:1');
    expect(global.vcs!.issueId).toBe('TRL-1');

    const issue = engine.getIssue('issue:lane-a:1');
    expect(issue).not.toBeNull();
    expect(issue!.id).toBe('issue:lane-a:1');
    expect(issue!.criteria).toHaveLength(1);
    expect(issue!.criteria[0].description).toBe('Acceptance criterion');
  });

  test('displayId mirrors id for legacy TRL-N, undefined for lane-scoped', async () => {
    const engine = await initEngine();

    await engine.createIssue('Legacy');
    await engine.createIssue('Lane-scoped', { laneId: 'lane-a' });

    const legacy = engine.getIssue('TRL-1')!;
    const laned = engine.getIssue('issue:lane-a:1')!;

    expect(legacy.id).toBe('TRL-1');
    expect(legacy.displayId).toBe('TRL-1');

    expect(laned.id).toBe('issue:lane-a:1');
    expect(laned.displayId).toBeUndefined();
  });

  test('startIssue sanitizes lane-scoped IDs in branch names', async () => {
    const engine = await initEngine();
    const op = await engine.createIssue('Lane scoped branch', {
      laneId: 'lane-a',
    });

    await engine.startIssue(op.vcs!.issueId!, { lane: false });

    const issue = engine.getIssue(op.vcs!.issueId!)!;
    expect(issue.branchName).toBe('issue/lane-a-1-lane-scoped-branch');
    expect(engine.getCurrentBranch()).toBe(issue.branchName);
  });

  test('blockIssue creates blockedBy link and sets isBlocked', async () => {
    const engine = await initEngine();

    const op1 = await engine.createIssue('Feature A');
    const op2 = await engine.createIssue('Feature B');
    const idA = op1.vcs!.issueId!;
    const idB = op2.vcs!.issueId!;

    await engine.blockIssue(idB, idA); // B is blocked by A

    const issueB = engine.getIssue(idB)!;
    expect(issueB.isBlocked).toBe(true);
    expect(issueB.blockedBy).toEqual([idA]);

    const issueA = engine.getIssue(idA)!;
    expect(issueA.blocking).toEqual([idB]);
    expect(issueA.isBlocked).toBe(false);
  });

  test('unblockIssue removes blockedBy link', async () => {
    const engine = await initEngine();

    const op1 = await engine.createIssue('Dep');
    const op2 = await engine.createIssue('Blocked');
    const idDep = op1.vcs!.issueId!;
    const idBlocked = op2.vcs!.issueId!;

    await engine.blockIssue(idBlocked, idDep);
    expect(engine.getIssue(idBlocked)!.isBlocked).toBe(true);

    await engine.unblockIssue(idBlocked, idDep);
    const after = engine.getIssue(idBlocked)!;
    expect(after.isBlocked).toBe(false);
    expect(after.blockedBy).toEqual([]);
  });

  test('isBlocked becomes false when blocker is closed', async () => {
    const engine = await initEngine();

    const op1 = await engine.createIssue('Blocker');
    const op2 = await engine.createIssue('Blocked');
    const idBlocker = op1.vcs!.issueId!;
    const idBlocked = op2.vcs!.issueId!;

    await engine.blockIssue(idBlocked, idBlocker);
    expect(engine.getIssue(idBlocked)!.isBlocked).toBe(true);

    // Close the blocker — isBlocked should become false (derived)
    await engine.startIssue(idBlocker);
    await engine.closeIssue(idBlocker, { confirm: true });

    const after = engine.getIssue(idBlocked)!;
    expect(after.isBlocked).toBe(false);
    // blockedBy still has the link, but the blocker is closed
    expect(after.blockedBy).toEqual([idBlocker]);
  });

  test('blockIssue throws when blocking self', async () => {
    const engine = await initEngine();
    const op = await engine.createIssue('Self');
    const id = op.vcs!.issueId!;

    await expect(engine.blockIssue(id, id)).rejects.toThrow(
      'cannot block itself',
    );
  });

  test('listIssues filters by blocked status', async () => {
    const engine = await initEngine();

    const op1 = await engine.createIssue('Blocker');
    const op2 = await engine.createIssue('Blocked one');
    const op3 = await engine.createIssue('Free');

    await engine.blockIssue(op2.vcs!.issueId!, op1.vcs!.issueId!);

    const blocked = engine.listIssues({ blocked: true });
    expect(blocked.length).toBe(1);
    expect(blocked[0].id).toBe(op2.vcs!.issueId!);

    const notBlocked = engine.listIssues({ blocked: false });
    expect(notBlocked.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Queue & Pause Workflow
  // -------------------------------------------------------------------------

  test('triageIssue sets status to queue', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Triage me');
    const id = op.vcs!.issueId!;
    expect(engine.getIssue(id)!.status).toBe('backlog');

    await engine.triageIssue(id);
    expect(engine.getIssue(id)!.status).toBe('queue');
  });

  test('createIssue with status queue works', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Queue item', { status: 'queue' });
    const id = op.vcs!.issueId!;
    expect(engine.getIssue(id)!.status).toBe('queue');
  });

  test('listIssues filters by queue status', async () => {
    const engine = await initEngine();

    await engine.createIssue('Backlog item');
    await engine.createIssue('Queue item', { status: 'queue' });

    const queueIssues = engine.listIssues({ status: 'queue' });
    expect(queueIssues.length).toBe(1);
    expect(queueIssues[0].title).toBe('Queue item');
  });

  test('pauseIssue without note throws', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('No note');
    const id = op.vcs!.issueId!;
    await engine.startIssue(id);

    await expect(engine.pauseIssue(id, '')).rejects.toThrow(
      /pause note is required/i,
    );

    await expect(engine.pauseIssue(id, '   ')).rejects.toThrow(
      /pause note is required/i,
    );
  });

  test('pauseNote is stored and cleared on resume', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Note lifecycle');
    const id = op.vcs!.issueId!;
    await engine.startIssue(id);

    await engine.pauseIssue(id, 'Waiting for design review');
    const paused = engine.getIssue(id)!;
    expect(paused.pauseNote).toBe('Waiting for design review');

    await engine.resumeIssue(id);
    const resumed = engine.getIssue(id)!;
    expect(resumed.pauseNote).toBeUndefined();
  });

  test('checkCompletionReadiness returns ready when all closed/backlog', async () => {
    const engine = await initEngine();

    await engine.createIssue('Backlog item');
    const op2 = await engine.createIssue('Closable');
    await engine.startIssue(op2.vcs!.issueId!);
    await engine.closeIssue(op2.vcs!.issueId!, { confirm: true });

    const result = engine.checkCompletionReadiness();
    expect(result.ready).toBe(true);
    expect(result.queue).toHaveLength(0);
    expect(result.paused).toHaveLength(0);
    expect(result.inProgress).toHaveLength(0);
    expect(result.summary).toContain('All clear');
  });

  test('checkCompletionReadiness returns not-ready with queue/paused/in_progress', async () => {
    const engine = await initEngine();

    // Create one in each blocking state
    await engine.createIssue('Queued', { status: 'queue' });
    const op2 = await engine.createIssue('Active');
    await engine.startIssue(op2.vcs!.issueId!);

    const op3 = await engine.createIssue('Will pause');
    await engine.startIssue(op3.vcs!.issueId!);
    await engine.pauseIssue(op3.vcs!.issueId!, 'Blocked on external dep');

    const result = engine.checkCompletionReadiness();
    expect(result.ready).toBe(false);
    expect(result.queue).toHaveLength(1);
    expect(result.inProgress).toHaveLength(1);
    expect(result.paused).toHaveLength(1);
    expect(result.summary).toContain('Not ready');
    expect(result.summary).toContain('Queue');
    expect(result.summary).toContain('In progress');
    expect(result.summary).toContain('Paused');
  });

  test('reopenIssue sets status to queue (not open)', async () => {
    const engine = await initEngine();

    const op = await engine.createIssue('Reopen check');
    const id = op.vcs!.issueId!;
    await engine.startIssue(id);
    await engine.closeIssue(id, { confirm: true });
    expect(engine.getIssue(id)!.status).toBe('closed');

    await engine.reopenIssue(id);
    expect(engine.getIssue(id)!.status).toBe('queue');
  });

  test('concurrent writers do not drop issueCreate ops', async () => {
    const primary = await initEngine();
    const secondary = new TrellisVcsEngine({ rootPath: TEST_DIR });
    secondary.open();

    const primaryIssue = await primary.createIssue('Primary writer issue');
    const secondaryIssue = await secondary.createIssue('Secondary writer issue');

    expect(primaryIssue.vcs!.issueId).toBe('TRL-1');
    expect(secondaryIssue.vcs!.issueId).toBe('TRL-2');

    // Reopen from disk to assert both ops persisted in the op log.
    const verifier = new TrellisVcsEngine({ rootPath: TEST_DIR });
    verifier.open();
    const issues = verifier.listIssues();

    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.id).sort()).toEqual(['TRL-1', 'TRL-2']);
  });
});
