import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { exportToGit } from '../../src/git/git-exporter.js';
import { importFromGit } from '../../src/git/git-importer.js';
import { TrellisVcsEngine } from '../../src/engine.js';
import { BlobStore } from '../../src/vcs/blob-store.js';
import { execSync } from 'child_process';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'fs';
import { join } from 'path';

const GIT_REPO = '/tmp/trellis-git-export-src';
const TRELLIS_REPO = '/tmp/trellis-git-export-trellis';
const EXPORT_REPO = '/tmp/trellis-git-export-dest';

function git(cmd: string, cwd: string = GIT_REPO) {
  return execSync(`git -C "${cwd}" ${cmd}`, { encoding: 'utf-8' }).trim();
}

describe('exportToGit', () => {
  beforeAll(async () => {
    // Clean up
    rmSync(GIT_REPO, { recursive: true, force: true });
    rmSync(TRELLIS_REPO, { recursive: true, force: true });
    rmSync(EXPORT_REPO, { recursive: true, force: true });

    // Create a test Git repo with 3 commits
    mkdirSync(GIT_REPO, { recursive: true });
    execSync(`git init "${GIT_REPO}"`);
    git('config user.email "alice@example.com"');
    git('config user.name "Alice"');

    // Commit 1
    writeFileSync(join(GIT_REPO, 'README.md'), '# Export Test');
    writeFileSync(join(GIT_REPO, 'index.ts'), 'console.log("hello");');
    git('add .');
    git('commit -m "init: scaffold project"');

    // Commit 2
    writeFileSync(join(GIT_REPO, 'index.ts'), 'console.log("updated");');
    mkdirSync(join(GIT_REPO, 'src'), { recursive: true });
    writeFileSync(join(GIT_REPO, 'src', 'app.ts'), 'export default {};');
    git('add .');
    git('commit -m "feat: add app module"');

    // Commit 3
    execSync(`rm "${join(GIT_REPO, 'README.md')}"`);
    git('add -A');
    git('commit -m "chore: remove README"');

    // Now import into TrellisVCS (with blob store)
    mkdirSync(TRELLIS_REPO, { recursive: true });

    // We need to do a proper import that also stores blobs
    await importFromGit({
      from: GIT_REPO,
      to: TRELLIS_REPO,
    });

    // The standard importer doesn't store blobs yet, so let's store them
    // manually by opening the engine and storing each file's content
    const engine = new TrellisVcsEngine({ rootPath: TRELLIS_REPO });
    engine.open();
    const blobStore = engine.getBlobStore()!;

    // Store blobs for files at each commit
    const commits = execSync(`git -C "${GIT_REPO}" log --reverse --format=%H`, {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n');

    for (const commitHash of commits) {
      // Get list of files at this commit
      const files = execSync(
        `git -C "${GIT_REPO}" ls-tree -r --name-only ${commitHash}`,
        { encoding: 'utf-8' },
      )
        .trim()
        .split('\n')
        .filter(Boolean);

      for (const filePath of files) {
        try {
          const content = execSync(
            `git -C "${GIT_REPO}" show ${commitHash}:${filePath}`,
          );
          await blobStore.put(content);
        } catch {}
      }
    }
  });

  afterAll(() => {
    rmSync(GIT_REPO, { recursive: true, force: true });
    rmSync(TRELLIS_REPO, { recursive: true, force: true });
    rmSync(EXPORT_REPO, { recursive: true, force: true });
  });

  test('exports milestones to Git commits', async () => {
    const result = await exportToGit({
      from: TRELLIS_REPO,
      to: EXPORT_REPO,
    });

    expect(result.milestonesExported).toBeGreaterThanOrEqual(1);
    expect(result.commitsCreated).toBeGreaterThanOrEqual(1);
    expect(result.duration).toBeGreaterThan(0);
  });

  test('creates a valid Git repository', () => {
    expect(existsSync(join(EXPORT_REPO, '.git'))).toBe(true);

    // Should be able to run git log
    const log = git('log --oneline', EXPORT_REPO);
    expect(log.length).toBeGreaterThan(0);
  });

  test('commit messages match milestone messages', () => {
    const log = git('log --format=%s --reverse', EXPORT_REPO);
    const messages = log.split('\n').filter(Boolean);

    // Should contain the original Git commit messages
    expect(messages.some((m) => m.includes('scaffold project'))).toBe(true);
    expect(messages.some((m) => m.includes('app module'))).toBe(true);
    expect(messages.some((m) => m.includes('remove README'))).toBe(true);
  });

  test('exported repo has files from the final state', () => {
    // After all 3 commits: index.ts and src/app.ts should exist,
    // README.md should NOT exist (deleted in commit 3)
    expect(existsSync(join(EXPORT_REPO, 'index.ts'))).toBe(true);
    expect(existsSync(join(EXPORT_REPO, 'src', 'app.ts'))).toBe(true);
    expect(existsSync(join(EXPORT_REPO, 'README.md'))).toBe(false);
  });

  test('exported file content matches original', () => {
    const exportedIndex = readFileSync(
      join(EXPORT_REPO, 'index.ts'),
      'utf-8',
    );
    // Should match the latest version from commit 2
    expect(exportedIndex).toBe('console.log("updated");');

    const exportedApp = readFileSync(
      join(EXPORT_REPO, 'src', 'app.ts'),
      'utf-8',
    );
    expect(exportedApp).toBe('export default {};');
  });

  test('reports progress callbacks', async () => {
    const exportRepo2 = '/tmp/trellis-git-export-dest2';
    rmSync(exportRepo2, { recursive: true, force: true });

    const phases: string[] = [];
    await exportToGit({
      from: TRELLIS_REPO,
      to: exportRepo2,
      onProgress: (p) => {
        if (!phases.includes(p.phase)) {
          phases.push(p.phase);
        }
      },
    });

    expect(phases).toContain('preparing');
    expect(phases).toContain('exporting');
    expect(phases).toContain('done');

    rmSync(exportRepo2, { recursive: true, force: true });
  });

  test('handles empty milestone list gracefully', async () => {
    const emptyRepo = '/tmp/trellis-git-export-empty';
    rmSync(emptyRepo, { recursive: true, force: true });
    mkdirSync(emptyRepo, { recursive: true });

    const engine = new TrellisVcsEngine({ rootPath: emptyRepo });
    await engine.initRepo();

    const exportDest = '/tmp/trellis-git-export-empty-dest';
    rmSync(exportDest, { recursive: true, force: true });

    const result = await exportToGit({
      from: emptyRepo,
      to: exportDest,
    });

    expect(result.milestonesExported).toBe(0);
    expect(result.commitsCreated).toBe(0);

    rmSync(emptyRepo, { recursive: true, force: true });
    rmSync(exportDest, { recursive: true, force: true });
  });
});
