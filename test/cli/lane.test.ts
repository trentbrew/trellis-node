import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Skip CLI tests outside Bun — they shell out to `bun run` which is not
// available in Node-only CI or when the package is consumed as `trellis`.
const isBun = !!(process as any).isBun;
const bunTest = isBun ? test : test.skip;

let testDir: string;
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cliPath = join(__dirname, '../../src/cli/index.ts');

function shellQuote(arg: string): string {
  if (/^[a-zA-Z0-9_./:-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function runCli(
  args: string[],
  opts?: { env?: Record<string, string> },
): { stdout: string; stderr: string; code: number } {
  const withPath =
    args.includes('-p') || args.includes('--path')
      ? args
      : [...args, '-p', testDir];
  const cmd = `npx tsx ${cliPath} ${withPath.map(shellQuote).join(' ')}`;
  try {
    const stdout = execSync(cmd, {
      cwd: join(__dirname, '../..'),
      env: { ...process.env, HOME: testDir, NO_COLOR: '1', ...opts?.env },
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      code: e.status ?? 1,
    };
  }
}

beforeEach(() => {
  if (!isBun) return;
  testDir = join(
    tmpdir(),
    `trellis-lane-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  const r = runCli(['init', '--no-interactive', '-p', testDir]);
  expect(r.code).toBe(0);
});

afterEach(() => {
  if (!isBun || !existsSync(testDir)) return;
  rmSync(testDir, { recursive: true, force: true });
});

bunTest('lane create and status golden path', () => {
  const created = runCli(['lane', 'create']);
  expect(created.code).toBe(0);
  expect(created.stdout).toContain('Lane created:');
  const laneId = created.stdout.match(/lane-[0-9a-f-]+/)?.[0];
  expect(laneId).toBeTruthy();

  const enter = runCli(['lane', 'enter', laneId!]);
  expect(enter.code).toBe(0);
  expect(enter.stdout).toContain('Entered lane');

  const status = runCli(['lane', 'status']);
  expect(status.code).toBe(0);
  expect(status.stdout).toContain('(active)');
});

bunTest('lane list shows created lane', () => {
  runCli(['lane', 'create']);
  const list = runCli(['lane', 'list']);
  expect(list.code).toBe(0);
  expect(list.stdout).toContain('lane-');
});

bunTest('TRELLIS_LANE_ID auto-enters on lane status', () => {
  const created = runCli(['lane', 'create']);
  const laneId = created.stdout.match(/lane-[0-9a-f-]+/)?.[0]!;

  const status = runCli(['lane', 'status'], {
    env: { TRELLIS_LANE_ID: laneId },
  });
  expect(status.code).toBe(0);
  expect(status.stdout).toContain('(active)');
});

bunTest('issue start creates and enters lane', () => {
  const createIssue = runCli(['issue', 'create', '-t', 'Lane CLI test']);
  expect(createIssue.code).toBe(0);
  const match = createIssue.stdout.match(/TRL-\d+/);
  expect(match).toBeTruthy();
  const issueId = match![0];

  const start = runCli(['issue', 'start', issueId]);
  expect(start.code).toBe(0);
  expect(start.stdout).toContain('Lane:');
  expect(start.stdout).toContain('lane-');
});

bunTest('lane promote dry-run reports plan', () => {
  const created = runCli(['lane', 'create']);
  const laneId = created.stdout.match(/lane-[0-9a-f-]+/)?.[0]!;

  const dryRun = runCli(['lane', 'promote', laneId, '--dry-run', '--explain']);
  expect(dryRun.code).toBe(0);
  expect(dryRun.stdout).toContain('Lane promote plan');
  expect(dryRun.stdout).toContain(laneId);
});

bunTest('lane fork --child creates child lane from parent head', () => {
  const created = runCli(['lane', 'create']);
  const parentId = created.stdout.match(/lane-[0-9a-f-]+/)?.[0]!;
  runCli(['lane', 'enter', parentId]);
  runCli(['issue', 'create', '-t', 'fork seed']);
  runCli(['lane', 'leave']);

  const forked = runCli([
    'lane',
    'fork',
    parentId,
    '--child',
    '--session',
    'sess-child',
  ]);
  expect(forked.code).toBe(0);
  expect(forked.stdout).toContain('Fork kind:  child');
  expect(forked.stdout).toContain('Virtual base:');

  const childId = forked.stdout.match(/lane-[0-9a-f-]+/)?.[0]!;
  const status = runCli(['lane', 'status', childId]);
  expect(status.stdout).toContain('Fork kind:  child');
});

bunTest('lane fork creates sibling from parent', () => {
  const created = runCli(['lane', 'create', '--issue', 'TRL-fork-test']);
  const parentId = created.stdout.match(/lane-[0-9a-f-]+/)?.[0]!;
  runCli(['lane', 'enter', parentId]);
  runCli(['lane', 'leave']);

  const forked = runCli(['lane', 'fork', parentId, '--session', 'sess-cli']);
  expect(forked.code).toBe(0);
  expect(forked.stdout).toContain('Lane forked:');
  expect(forked.stdout).toContain(`Parent:   ${parentId}`);

  const childId = forked.stdout.match(/lane-[0-9a-f-]+/)?.[0]!;
  expect(childId).not.toBe(parentId);

  const status = runCli(['lane', 'status', childId]);
  expect(status.code).toBe(0);
  expect(status.stdout).toContain(`Parent:      ${parentId}`);
  expect(status.stdout).toContain('Fork kind:  sibling');
});

bunTest('lane leave clears active session', () => {
  const created = runCli(['lane', 'create']);
  const laneId = created.stdout.match(/lane-[0-9a-f-]+/)?.[0]!;
  runCli(['lane', 'enter', laneId]);

  const leave = runCli(['lane', 'leave']);
  expect(leave.code).toBe(0);
  expect(leave.stdout).toContain('Left lane');

  const status = runCli(['lane', 'status']);
  expect(status.stdout).toContain('No active lane');
});
