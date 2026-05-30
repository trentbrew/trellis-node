import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { GitReader } from '../../src/git/git-reader.js';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_REPO = '/tmp/trellis-git-reader-test';

function git(args: string) {
  execSync(`git -C "${TEST_REPO}" ${args}`, { encoding: 'utf-8' });
}

describe('GitReader', () => {
  beforeAll(() => {
    rmSync(TEST_REPO, { recursive: true, force: true });
    mkdirSync(TEST_REPO, { recursive: true });

    // Create a test Git repo with 3 commits
    execSync(`git init "${TEST_REPO}"`);
    git('config user.email "test@test.com"');
    git('config user.name "Test User"');

    // Commit 1: initial files
    writeFileSync(join(TEST_REPO, 'README.md'), '# Hello');
    writeFileSync(join(TEST_REPO, 'index.ts'), 'export const x = 1;');
    git('add .');
    git('commit -m "initial commit"');

    // Commit 2: modify + add
    writeFileSync(join(TEST_REPO, 'index.ts'), 'export const x = 2;');
    mkdirSync(join(TEST_REPO, 'src'), { recursive: true });
    writeFileSync(join(TEST_REPO, 'src', 'utils.ts'), 'export function add(a: number, b: number) { return a + b; }');
    git('add .');
    git('commit -m "add utils, update index"');

    // Commit 3: delete + rename
    execSync(`rm "${join(TEST_REPO, 'README.md')}"`);
    git('add -A');
    git('commit -m "remove README"');
  });

  afterAll(() => {
    rmSync(TEST_REPO, { recursive: true, force: true });
  });

  test('isGitRepo returns true for a Git repo', () => {
    const reader = new GitReader(TEST_REPO);
    expect(reader.isGitRepo()).toBe(true);
  });

  test('isGitRepo returns false for a non-Git directory', () => {
    const reader = new GitReader('/tmp');
    expect(reader.isGitRepo()).toBe(false);
  });

  test('readCommits returns commits in topological order', () => {
    const reader = new GitReader(TEST_REPO);
    const commits = reader.readCommits();

    expect(commits).toHaveLength(3);
    expect(commits[0].message).toBe('initial commit');
    expect(commits[1].message).toBe('add utils, update index');
    expect(commits[2].message).toBe('remove README');
  });

  test('commits have correct structure', () => {
    const reader = new GitReader(TEST_REPO);
    const commits = reader.readCommits();

    for (const c of commits) {
      expect(c.hash).toMatch(/^[a-f0-9]{40}$/);
      expect(c.authorName).toBe('Test User');
      expect(c.authorEmail).toBe('test@test.com');
      expect(c.timestamp).toBeTruthy();
    }

    // First commit has no parents
    expect(commits[0].parentHashes).toHaveLength(0);
    // Later commits chain
    expect(commits[1].parentHashes).toHaveLength(1);
    expect(commits[1].parentHashes[0]).toBe(commits[0].hash);
  });

  test('readChanges returns file changes for root commit', () => {
    const reader = new GitReader(TEST_REPO);
    const commits = reader.readCommits();
    const changes = reader.readChanges(commits[0].hash);

    expect(changes).toHaveLength(2);
    const statuses = changes.map(c => c.status).sort();
    expect(statuses).toEqual(['A', 'A']);
    const paths = changes.map(c => c.path).sort();
    expect(paths).toEqual(['README.md', 'index.ts']);
  });

  test('readChanges returns modifications and additions', () => {
    const reader = new GitReader(TEST_REPO);
    const commits = reader.readCommits();
    const changes = reader.readChanges(commits[1].hash, commits[0].hash);

    expect(changes.length).toBeGreaterThanOrEqual(2);
    const modified = changes.find(c => c.path === 'index.ts');
    expect(modified?.status).toBe('M');
    const added = changes.find(c => c.path === 'src/utils.ts');
    expect(added?.status).toBe('A');
  });

  test('readChanges returns deletions', () => {
    const reader = new GitReader(TEST_REPO);
    const commits = reader.readCommits();
    const changes = reader.readChanges(commits[2].hash, commits[1].hash);

    const deleted = changes.find(c => c.path === 'README.md');
    expect(deleted?.status).toBe('D');
  });

  test('readFullHistory includes changes per commit', () => {
    const reader = new GitReader(TEST_REPO);
    const history = reader.readFullHistory();

    expect(history).toHaveLength(3);
    for (const commit of history) {
      expect(commit.changes.length).toBeGreaterThan(0);
    }
  });

  test('commitCount returns correct count', () => {
    const reader = new GitReader(TEST_REPO);
    expect(reader.commitCount()).toBe(3);
  });

  test('currentBranch returns branch name', () => {
    const reader = new GitReader(TEST_REPO);
    const branch = reader.currentBranch();
    // Git init defaults to main or master depending on config
    expect(['main', 'master']).toContain(branch);
  });

  test('readFileContent returns file at a specific commit', () => {
    const reader = new GitReader(TEST_REPO);
    const commits = reader.readCommits();

    // index.ts at first commit
    const content1 = reader.readFileContent(commits[0].hash, 'index.ts');
    expect(content1?.toString()).toBe('export const x = 1;');

    // index.ts at second commit (modified)
    const content2 = reader.readFileContent(commits[1].hash, 'index.ts');
    expect(content2?.toString()).toBe('export const x = 2;');
  });

  test('readFileContent returns null for deleted files', () => {
    const reader = new GitReader(TEST_REPO);
    const commits = reader.readCommits();

    const content = reader.readFileContent(commits[2].hash, 'README.md');
    expect(content).toBeNull();
  });
});
