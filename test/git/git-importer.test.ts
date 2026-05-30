import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { importFromGit } from '../../src/git/git-importer.js';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const GIT_REPO = '/tmp/trellis-importer-git';
const TRELLIS_REPO = '/tmp/trellis-importer-target';

function git(args: string) {
  execSync(`git -C "${GIT_REPO}" ${args}`, { encoding: 'utf-8' });
}

describe('importFromGit', () => {
  beforeAll(() => {
    rmSync(GIT_REPO, { recursive: true, force: true });
    rmSync(TRELLIS_REPO, { recursive: true, force: true });
    mkdirSync(GIT_REPO, { recursive: true });
    mkdirSync(TRELLIS_REPO, { recursive: true });

    // Create a test Git repo
    execSync(`git init "${GIT_REPO}"`);
    git('config user.email "alice@example.com"');
    git('config user.name "Alice"');

    // Commit 1
    writeFileSync(join(GIT_REPO, 'README.md'), '# Test');
    writeFileSync(join(GIT_REPO, 'index.ts'), 'console.log("hello");');
    git('add .');
    git('commit -m "init: scaffold project"');

    // Commit 2
    writeFileSync(join(GIT_REPO, 'index.ts'), 'console.log("world");');
    mkdirSync(join(GIT_REPO, 'src'), { recursive: true });
    writeFileSync(join(GIT_REPO, 'src', 'app.ts'), 'export default {};');
    git('add .');
    git('commit -m "feat: add app module"');

    // Commit 3
    execSync(`rm "${join(GIT_REPO, 'README.md')}"`);
    git('add -A');
    git('commit -m "chore: remove README"');
  });

  afterAll(() => {
    rmSync(GIT_REPO, { recursive: true, force: true });
    rmSync(TRELLIS_REPO, { recursive: true, force: true });
  });

  test('imports a Git repo into a TrellisVCS repo', async () => {
    const result = await importFromGit({
      from: GIT_REPO,
      to: TRELLIS_REPO,
    });

    expect(result.commitsImported).toBe(3);
    expect(result.opsCreated).toBeGreaterThan(3); // file ops + milestones + branch
    expect(result.filesTracked).toBe(2); // index.ts + src/app.ts (README deleted)
    expect(result.duration).toBeGreaterThan(0);
  });

  test('creates .trellis directory with config and ops', async () => {
    expect(existsSync(join(TRELLIS_REPO, '.trellis', 'config.json'))).toBe(true);
    expect(existsSync(join(TRELLIS_REPO, '.trellis', 'ops.json'))).toBe(true);
  });

  test('ops.json contains valid JSON array', async () => {
    const raw = readFileSync(join(TRELLIS_REPO, '.trellis', 'ops.json'), 'utf-8');
    const ops = JSON.parse(raw);
    expect(Array.isArray(ops)).toBe(true);
    expect(ops.length).toBeGreaterThan(0);
  });

  test('first op is a branch creation', async () => {
    const ops = JSON.parse(
      readFileSync(join(TRELLIS_REPO, '.trellis', 'ops.json'), 'utf-8'),
    );
    expect(ops[0].kind).toBe('vcs:branchCreate');
  });

  test('milestones are created for each Git commit', async () => {
    const ops = JSON.parse(
      readFileSync(join(TRELLIS_REPO, '.trellis', 'ops.json'), 'utf-8'),
    );
    const milestones = ops.filter((o: any) => o.kind === 'vcs:milestoneCreate');
    expect(milestones).toHaveLength(3);

    expect(milestones[0].vcs.message).toBe('init: scaffold project');
    expect(milestones[1].vcs.message).toBe('feat: add app module');
    expect(milestones[2].vcs.message).toBe('chore: remove README');
  });

  test('file ops match Git changes', async () => {
    const ops = JSON.parse(
      readFileSync(join(TRELLIS_REPO, '.trellis', 'ops.json'), 'utf-8'),
    );

    const fileAdds = ops.filter((o: any) => o.kind === 'vcs:fileAdd');
    const fileMods = ops.filter((o: any) => o.kind === 'vcs:fileModify');
    const fileDels = ops.filter((o: any) => o.kind === 'vcs:fileDelete');

    // Commit 1: 2 adds (README.md, index.ts)
    // Commit 2: 1 modify (index.ts) + 1 add (src/app.ts)
    // Commit 3: 1 delete (README.md)
    expect(fileAdds.length).toBe(3);
    expect(fileMods.length).toBe(1);
    expect(fileDels.length).toBe(1);

    expect(fileDels[0].vcs.filePath).toBe('README.md');
  });

  test('ops have causal chain via previousHash', async () => {
    const ops = JSON.parse(
      readFileSync(join(TRELLIS_REPO, '.trellis', 'ops.json'), 'utf-8'),
    );

    // First op has no previousHash
    expect(ops[0].previousHash).toBeUndefined();

    // Every subsequent op chains to its predecessor
    for (let i = 1; i < ops.length; i++) {
      expect(ops[i].previousHash).toBe(ops[i - 1].hash);
    }
  });

  test('milestone IDs reference Git commit hashes', async () => {
    const ops = JSON.parse(
      readFileSync(join(TRELLIS_REPO, '.trellis', 'ops.json'), 'utf-8'),
    );
    const milestones = ops.filter((o: any) => o.kind === 'vcs:milestoneCreate');

    for (const m of milestones) {
      expect(m.vcs.milestoneId).toStartWith('milestone:git:');
    }
  });

  test('agent IDs reference Git author emails', async () => {
    const ops = JSON.parse(
      readFileSync(join(TRELLIS_REPO, '.trellis', 'ops.json'), 'utf-8'),
    );

    // Skip branch op (uses import agent), check file ops
    const fileOps = ops.filter((o: any) => o.kind.startsWith('vcs:file'));
    for (const op of fileOps) {
      expect(op.agentId).toBe('identity:alice@example.com');
    }
  });

  test('throws for non-Git repos', async () => {
    expect(
      importFromGit({ from: '/tmp/nonexistent', to: '/tmp/out' }),
    ).rejects.toThrow('Not a Git repository');
  });

  test('reports progress callbacks', async () => {
    rmSync(TRELLIS_REPO, { recursive: true, force: true });
    mkdirSync(TRELLIS_REPO, { recursive: true });

    const phases: string[] = [];
    await importFromGit({
      from: GIT_REPO,
      to: TRELLIS_REPO,
      onProgress: (p) => {
        if (!phases.includes(p.phase)) { phases.push(p.phase); }
      },
    });

    expect(phases).toContain('reading');
    expect(phases).toContain('importing');
    expect(phases).toContain('done');
  });
});
