import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TrellisVcsEngine } from '../../src/engine.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const cli = join(repoRoot, 'bin/trellis.mjs');

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8'
  });
}

describe('trellis issue CLI', () => {
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'trellis-issue-cli-'));
    root = realpathSync(root);
    const eng = new TrellisVcsEngine({ rootPath: root });
    await eng.initRepo();
  });

  afterAll(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  it('lists issues without error', () => {
    const r = run(['issue', 'list'], root);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('creates, updates, describes, and adds acceptance criteria', () => {
    const created = run(
      [
        'issue',
        'create',
        '-t',
        'CLI smoke',
        '--ac',
        'criterion one',
        '--ac',
        'criterion two'
      ],
      root
    );
    expect(created.status).toBe(0);
    expect(created.stdout).toMatch(/TRL-1/);

    const updated = run(['issue', 'update', 'TRL-1', '--title', 'CLI smoke updated'], root);
    expect(updated.status).toBe(0);
    expect(updated.stdout).toContain('Updated TRL-1');

    const described = run(['issue', 'describe', 'TRL-1', 'short desc'], root);
    expect(described.status).toBe(0);

    const ac = run(['issue', 'ac', 'TRL-1', 'criterion three'], root);
    expect(ac.status).toBe(0);

    const shown = run(['issue', 'show', 'TRL-1'], root);
    expect(shown.status).toBe(0);
    expect(shown.stdout).toContain('CLI smoke updated');
    expect(shown.stdout).toContain('short desc');
  });

  it('surfaces errors for missing parent and empty update', () => {
    const badParent = run(['issue', 'create', '-t', 'orphan', '--parent', 'TRL-999'], root);
    expect(badParent.status).toBe(1);
    expect(badParent.stderr + badParent.stdout).toMatch(/not found/i);

    const emptyUpdate = run(['issue', 'update', 'TRL-1'], root);
    expect(emptyUpdate.status).toBe(1);
    expect(emptyUpdate.stderr + emptyUpdate.stdout).toMatch(/No updates specified/i);
  });
});
