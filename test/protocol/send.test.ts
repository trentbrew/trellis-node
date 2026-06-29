import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { TrellisVcsEngine } from '../../src/engine.js';
import {
  validateEnvelope,
  formatIssueDescription,
} from '../../src/protocol/envelope.js';
import { findWaitingOnYou } from '../../src/protocol/whereami.js';

const TEST_ROOT = '/tmp/trellis-protocol-send';

describe('protocol send flow', () => {
  let engine: TrellisVcsEngine;

  beforeEach(async () => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_ROOT, { recursive: true });
    engine = new TrellisVcsEngine({ rootPath: TEST_ROOT });
    await engine.initRepo({ indexWorkspace: false });
    engine.setCheckpointThreshold(0);
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('creates label:message child with validated envelope', async () => {
    const parent = await engine.createIssue('Parent wedge', { status: 'queue' });
    const parentId = parent.vcs!.issueId!;

    const envelope = {
      from: 'executor' as const,
      to: 'reviewer' as const,
      re: 'TRL-41',
      status: 'HANDOFF' as const,
      body: 'ready for review',
    };
    expect(validateEnvelope(envelope).ok).toBe(true);

    const child = await engine.createIssue(`msg: HANDOFF ${envelope.re}`, {
      parentId,
      labels: ['message'],
      description: formatIssueDescription(envelope, 'impl'),
      status: 'queue',
    });

    const childId = child.vcs!.issueId!;
    const listed = engine.listIssues({ parentId });
    expect(listed.some((i) => i.id === childId)).toBe(true);
    expect(listed.find((i) => i.id === childId)?.labels).toContain('message');
  });

  test('decision child surfaces in findWaitingOnYou', async () => {
    const parent = await engine.createIssue('Parent', { status: 'queue' });
    await engine.createIssue('msg: DECISION TRL-9', {
      parentId: parent.vcs!.issueId!,
      labels: ['decision'],
      description: formatIssueDescription({
        from: 'strategist',
        to: 'human',
        re: 'TRL-9',
        status: 'DECISION',
        body: 'Ship?',
      }),
      status: 'queue',
    });

    expect(findWaitingOnYou(engine).length).toBe(1);
  });
});
