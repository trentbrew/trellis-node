import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

let testDir: string;

function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
  const cliPath = join(process.cwd(), 'src/cli/index.ts');
  try {
    const stdout = execSync(`bun ${cliPath} ${args.join(' ')}`, {
      cwd: testDir,
      env: { ...process.env, HOME: testDir, NO_COLOR: '1' },
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: any) {
    return { 
      stdout: err.stdout?.toString() ?? '', 
      stderr: err.stderr?.toString() ?? '', 
      code: err.status ?? 1 
    };
  }
}

beforeEach(() => {
  testDir = join(tmpdir(), `trellis-onboarding-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('onboarding: fresh init flow with cursor default', () => {
    const r = runCli(['init', '--no-interactive', '--path', '.']);
    expect(r.code).toBe(0);
    expect(existsSync(join(testDir, '.trellis'))).toBe(true);
    expect(existsSync(join(testDir, '.cursor'))).toBe(true);
    expect(existsSync(join(testDir, '.trellis', 'ops.json'))).toBe(true);
    expect(existsSync(join(testDir, '.trellis', 'config.json'))).toBe(true);
    expect(r.stdout).toContain('Initialized Trellis repository');
});

test('onboarding: init with custom frameworks and IDEs', () => {
    const r = runCli([
        'init', 
        '--no-interactive', 
        '--path', '.', 
        '--framework', 'next', 
        '--ides', 'windsurf', 'claude'
    ]);
    expect(r.code).toBe(0);
    expect(existsSync(join(testDir, '.cursor'))).toBe(false);
    expect(existsSync(join(testDir, '.windsurf'))).toBe(true);
    expect(existsSync(join(testDir, '.claude'))).toBe(true);
    
    const windsurf = readFileSync(join(testDir, '.windsurf', 'rules.md'), 'utf-8');
    expect(windsurf.toLowerCase()).toContain('next');
    const claude = readFileSync(join(testDir, '.claude', 'settings.md'), 'utf-8');
    expect(claude.toLowerCase()).toContain('next');
});

test('onboarding: idempotency check', () => {
    runCli(['init', '--no-interactive']);
    const r2 = runCli(['init', '--no-interactive']);
    expect(r2.stdout).toContain('Already a Trellis workspace');
});

test('onboarding: post-init status check', () => {
    runCli(['init', '--no-interactive']);
    const rS = runCli(['status']);
    expect(rS.code).toBe(0);
    expect(rS.stdout).toContain('TrellisVCS Status');
    expect(rS.stdout).toContain('Branch:');
    expect(rS.stdout).toContain('main');
});

test('onboarding: post-init log check', () => {
    runCli(['init', '--no-interactive']);
    const rL = runCli(['log']);
    expect(rL.code).toBe(0);
    expect(rL.stdout).toContain('Causal Stream');
    // Should have at least one branch creation op (human-readable log label)
    expect(rL.stdout).toContain('⊕branch');
});

test('onboarding: profile creation (global fallback)', () => {
    runCli(['init', '--no-interactive']);
    // HOME was testDir, check if profile was shadowed there
    expect(existsSync(join(testDir, '.trellis', 'profile.json'))).toBe(true);
});
