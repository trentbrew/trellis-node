import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../..');
const HARNESS_CLI = join(REPO_ROOT, 'templates/trellis-harness/trellis-cli.sh');
const TEST_ROOT = '/tmp/trellis-harness-edit-root';

function bashEval(script: string): string {
  return execSync(script, {
    shell: '/bin/bash',
    encoding: 'utf-8',
  }).trim();
}

describe('trellis_harness_edit_root', () => {
  const laneId = 'lane-edit-root-test';

  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(join(TEST_ROOT, '.trellis/lanes', laneId), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('returns repo root when no lane worktree', () => {
    writeFileSync(
      join(TEST_ROOT, '.trellis/lanes', laneId, 'meta.json'),
      JSON.stringify({ id: laneId }),
    );
    const out = bashEval(
      `source "${HARNESS_CLI}" && export TRELLIS_VCS_ROOT="${TEST_ROOT}" TRELLIS_LANE_ID="${laneId}" && trellis_harness_edit_root`,
    );
    expect(out).toBe(TEST_ROOT);
  });

  test('returns worktree path when meta.worktreePath is set', () => {
    const wt = join(TEST_ROOT, '.trellis/worktrees/abc12345');
    mkdirSync(wt, { recursive: true });
    writeFileSync(
      join(TEST_ROOT, '.trellis/lanes', laneId, 'meta.json'),
      JSON.stringify({ id: laneId, worktreePath: wt }),
    );
    const out = bashEval(
      `source "${HARNESS_CLI}" && export TRELLIS_VCS_ROOT="${TEST_ROOT}" TRELLIS_LANE_ID="${laneId}" && trellis_harness_edit_root`,
    );
    expect(out).toBe(wt);
  });

  test('desk session-context.sh sources harness without error when VCS present', () => {
    const sessionHook = join(REPO_ROOT, '../.cursor/hooks/session-context.sh');
    if (!existsSync(sessionHook)) {
      // mac-compat desk may be sibling; skip if not in monorepo layout
      return;
    }
    mkdirSync(join(TEST_ROOT, '.trellis'), { recursive: true });
    writeFileSync(join(TEST_ROOT, '.trellis/config.json'), '{}');
    const out = execSync(`bash "${sessionHook}"`, {
      cwd: TEST_ROOT,
      env: {
        ...process.env,
        TRELLIS_DESK_ROOT: join(REPO_ROOT, '..'),
        TRELLIS_LANE_ID: laneId,
        PWD: TEST_ROOT,
      },
      encoding: 'utf-8',
    });
    expect(out).toContain('Lane edit root');
  });
});
