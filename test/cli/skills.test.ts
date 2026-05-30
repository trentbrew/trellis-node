import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

let testDir: string;

function runCli(args: string[]): {
  stdout: string;
  stderr: string;
  code: number;
} {
  const cliPath = join(process.cwd(), 'src/cli/index.ts');
  try {
    const stdout = execSync(`bun ${cliPath} ${args.join(' ')}`, {
      cwd: testDir,
      env: {
        ...process.env,
        HOME: testDir,
        NO_COLOR: '1',
        TRELLIS_CLI_DRY_RUN: '1',
      },
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      code: err.status ?? 1,
    };
  }
}

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `trellis-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('cli: skills command registers and prints help', () => {
  const r = runCli(['skills', '--help']);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain(
    'Install Trellis agent skills using the skills CLI',
  );
});

test('cli: skills command constructs correct skills CLI execution arguments', () => {
  // We pass invalid flags/args so that it outputs the constructing log and exits/fails cleanly
  const r = runCli([
    'skills',
    '--skill',
    'trellis-graph',
    '--invalid-test-flag',
  ]);

  // It should print our custom logging statement showing the correctly parsed parameters
  expect(r.stdout).toContain('Installing Trellis agent skills...');
  expect(r.stdout).toContain(
    'npx skills add trentbrew/trellis --skill trellis-graph --invalid-test-flag',
  );
});
