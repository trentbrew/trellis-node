/**
 * CLI: trellis refs command Tests
 *
 * Tests the refs command output by invoking it as a subprocess.
 *
 * @see TRL-15
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TrellisVcsEngine } from '../../src/engine.js';

// ---------------------------------------------------------------------------
// Test fixture: create a temp TrellisVCS repo with wiki-link refs
// ---------------------------------------------------------------------------

let repoPath: string;
let engine: TrellisVcsEngine;

beforeAll(async () => {
  repoPath = mkdtempSync(join(tmpdir(), 'trellis-refs-cli-'));

  // Create some source files and markdown with [[...]] refs
  mkdirSync(join(repoPath, 'src'), { recursive: true });
  mkdirSync(join(repoPath, 'docs'), { recursive: true });

  writeFileSync(
    join(repoPath, 'src', 'engine.ts'),
    `/**
 * Main engine module.
 * See [[TRL-11]] for wiki-link spec.
 */
export function createIssue() {}
export function deleteIssue() {}
`,
  );

  writeFileSync(
    join(repoPath, 'docs', 'design.md'),
    `# Design

See [[TRL-5]] for the Python parser.
The main module is [[src/engine.ts]].
Check [[src/engine.ts#createIssue]] for issue creation.
Also references [[identity:trentbrew]] and [[TRL-999]] (broken).
`,
  );

  writeFileSync(
    join(repoPath, 'docs', 'empty.md'),
    `# Empty

No wiki links here.
`,
  );

  // Initialize TrellisVCS repo
  engine = new TrellisVcsEngine({ rootPath: repoPath });
  await engine.initRepo();

  // Create an issue so TRL-5 resolves
  await engine.createIssue('Add Python parser', {
    priority: 'high',
    labels: ['parser'],
  });
});

afterAll(() => {
  try {
    rmSync(repoPath, { recursive: true, force: true });
  } catch {}
});

// ---------------------------------------------------------------------------
// Helper to run trellis refs CLI
// ---------------------------------------------------------------------------

async function runRefs(...args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const cliPath = join(__dirname, '..', '..', 'src', 'cli', 'index.ts');
  const proc = Bun.spawn(['bun', 'run', cliPath, 'refs', ...args, '-p', repoPath], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

// ---------------------------------------------------------------------------
// trellis refs <file>
// ---------------------------------------------------------------------------

describe('trellis refs <file>', () => {
  it('lists outgoing refs for a file', async () => {
    const { stdout, exitCode } = await runRefs('docs/design.md');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('References in');
    expect(stdout).toContain('design.md');
    // Should find refs (TRL-5, src/engine.ts, etc.)
    expect(stdout).toContain('TRL-5');
    expect(stdout).toContain('src/engine.ts');
  });

  it('reports no refs for a file without wiki-links', async () => {
    const { stdout, exitCode } = await runRefs('docs/empty.md');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No [[...]] references found');
  });
});

// ---------------------------------------------------------------------------
// trellis refs --backlinks
// ---------------------------------------------------------------------------

describe('trellis refs --backlinks', () => {
  it('shows files referencing an entity', async () => {
    const { stdout, exitCode } = await runRefs('--backlinks', 'TRL-5');
    expect(exitCode).toBe(0);
    // TRL-5 is referenced from docs/design.md
    expect(stdout).toContain('docs/design.md');
  });

  it('reports nothing for unreferenced entity', async () => {
    const { stdout, exitCode } = await runRefs('--backlinks', 'TRL-42');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No references found');
  });
});

// ---------------------------------------------------------------------------
// trellis refs --broken
// ---------------------------------------------------------------------------

describe('trellis refs --broken', () => {
  it('lists broken references', async () => {
    const { stdout, exitCode } = await runRefs('--broken');
    expect(exitCode).toBe(0);
    // TRL-999 doesn't exist, should show as broken
    // identity:trentbrew may also be broken (no identity in test repo)
    expect(stdout).toContain('Broken references');
  });
});

// ---------------------------------------------------------------------------
// trellis refs --stats
// ---------------------------------------------------------------------------

describe('trellis refs --stats', () => {
  it('shows index statistics', async () => {
    const { stdout, exitCode } = await runRefs('--stats');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Reference Index Stats');
    expect(stdout).toContain('Files with refs');
    expect(stdout).toContain('Total refs');
  });
});
