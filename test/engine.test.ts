import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { TrellisVcsEngine } from '../src/engine.js';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const TEST_DIR = '/tmp/trellis-engine-test';

function setupTestRepo() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, 'src'), { recursive: true });
  writeFileSync(join(TEST_DIR, 'src', 'index.ts'), 'export const x = 1;');
  writeFileSync(
    join(TEST_DIR, 'src', 'utils.ts'),
    'export function add(a: number, b: number) { return a + b; }',
  );
  writeFileSync(join(TEST_DIR, 'README.md'), '# Test Project');
}

describe('TrellisVcsEngine', () => {
  beforeEach(() => {
    setupTestRepo();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('isRepo returns false before init', () => {
    expect(TrellisVcsEngine.isRepo(TEST_DIR)).toBe(false);
  });

  test('initRepo creates .trellis directory and config', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    expect(existsSync(join(TEST_DIR, '.trellis', 'config.json'))).toBe(true);
    expect(existsSync(join(TEST_DIR, '.trellis', 'ops.json'))).toBe(true);
    expect(TrellisVcsEngine.isRepo(TEST_DIR)).toBe(true);
  });

  test('initRepo creates .gitignore with .trellis entry when missing', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    expect(readFileSync(join(TEST_DIR, '.gitignore'), 'utf-8')).toBe(
      '.trellis/\n',
    );
  });

  test('initRepo appends .trellis entry to existing .gitignore', async () => {
    writeFileSync(join(TEST_DIR, '.gitignore'), 'dist\n');
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    expect(readFileSync(join(TEST_DIR, '.gitignore'), 'utf-8')).toBe(
      'dist\n.trellis/\n',
    );
  });

  test('initRepo does not duplicate existing .trellis gitignore entry', async () => {
    writeFileSync(join(TEST_DIR, '.gitignore'), 'dist\n.trellis\n');
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    expect(readFileSync(join(TEST_DIR, '.gitignore'), 'utf-8')).toBe(
      'dist\n.trellis\n',
    );
  });

  test('initRepo scans existing files and creates ops', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    const result = await engine.initRepo();

    // 1 branch op + 3 file ops (index.ts, utils.ts, README.md)
    expect(result.opsCreated).toBe(4);
  });

  test('initRepo reports progress while scanning and recording files', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    const phases: string[] = [];
    const messages: string[] = [];

    await engine.initRepo({
      onProgress: (progress) => {
        phases.push(progress.phase);
        messages.push(progress.message);
      },
    });

    expect(phases).toContain('discovering');
    expect(phases).toContain('hashing');
    expect(phases).toContain('recording');
    expect(phases).toContain('done');
    expect(messages).toContain('Discovering existing files…');
    expect(messages).toContain('Hashing 3 existing files…');
    expect(messages).toContain('Scanning 3 initial file operations…');
  });

  test('status reports correct counts after init', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    // Re-open to verify persistence
    const engine2 = new TrellisVcsEngine({ rootPath: TEST_DIR });
    engine2.open();
    const st = engine2.status();

    expect(st.branch).toBe('main');
    expect(st.totalOps).toBe(7);
    expect(st.trackedFiles).toBe(3);
  });

  test('open replays ops into EAV store', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    const engine2 = new TrellisVcsEngine({ rootPath: TEST_DIR });
    const { opsReplayed } = engine2.open();

    expect(opsReplayed).toBe(7);

    const files = engine2.trackedFiles();
    expect(files).toHaveLength(3);

    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(['README.md', 'src/index.ts', 'src/utils.ts']);
  });

  test('trackedFiles returns content hashes', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    const engine2 = new TrellisVcsEngine({ rootPath: TEST_DIR });
    engine2.open();

    const files = engine2.trackedFiles();
    for (const f of files) {
      expect(f.contentHash).toBeTruthy();
      expect(typeof f.contentHash).toBe('string');
    }
  });

  test('log returns ops in order', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    const engine2 = new TrellisVcsEngine({ rootPath: TEST_DIR });
    engine2.open();

    const ops = engine2.log();
    expect(ops).toHaveLength(7);
    expect(ops[0].kind).toBe('vcs:branchCreate');
    expect(ops[1].kind).toBe('vcs:fileAdd');
    expect(ops[2].kind).toBe('vcs:branchAdvance');
    expect(ops[3].kind).toBe('vcs:fileAdd');
    expect(ops[4].kind).toBe('vcs:branchAdvance');
    expect(ops[5].kind).toBe('vcs:fileAdd');
    expect(ops[6].kind).toBe('vcs:branchAdvance');
  });

  test('log filters by file path', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    const engine2 = new TrellisVcsEngine({ rootPath: TEST_DIR });
    engine2.open();

    const ops = engine2.log({ filePath: 'README.md' });
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('vcs:fileAdd');
    expect(ops[0].vcs?.filePath).toBe('README.md');
  });

  test('log respects limit', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    const engine2 = new TrellisVcsEngine({ rootPath: TEST_DIR });
    engine2.open();

    const ops = engine2.log({ limit: 2 });
    expect(ops).toHaveLength(2);
  });

  test('ops have causal chain (previousHash linkage)', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    const engine2 = new TrellisVcsEngine({ rootPath: TEST_DIR });
    engine2.open();

    const ops = engine2.getOps();
    // First op has no previousHash
    expect(ops[0].previousHash).toBeUndefined();

    // Subsequent ops chain to their predecessor
    for (let i = 1; i < ops.length; i++) {
      expect(ops[i].previousHash).toBe(ops[i - 1].hash);
    }
  });

  test('each op has a unique content-addressed hash', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    const ops = engine.getOps();
    const hashes = ops.map((o) => o.hash);
    const unique = new Set(hashes);
    expect(unique.size).toBe(hashes.length);
  });

  test('EAV store contains branch entity', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    const store = engine.getStore();
    const branchFacts = store.getFactsByEntity('branch:main');
    const types = branchFacts.filter((f) => f.a === 'type');
    expect(types).toHaveLength(1);
    expect(types[0].v).toBe('Branch');
  });

  test('watch() reconciles scan against op log for untracked files', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    // Verify initial state: 3 tracked files
    expect(engine.trackedFiles()).toHaveLength(3);
    const opsBefore = engine.getOpCount();

    // Add a new file while watcher is NOT running (simulates offline addition)
    writeFileSync(join(TEST_DIR, 'src', 'new-file.ts'), 'export const y = 2;');

    // Start watching — scan should detect untracked file and emit fileAdd
    engine.watch();

    // Give scan + reconciliation time to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    engine.stop();

    // Should now have 4 tracked files
    const tracked = engine.trackedFiles();
    expect(tracked).toHaveLength(4);
    expect(tracked.some((f) => f.path === 'src/new-file.ts')).toBe(true);

    // Should have created a new fileAdd op
    expect(engine.getOpCount()).toBeGreaterThan(opsBefore);

    // Latest fileAdd for the reconciled path (followed by branchAdvance in the log)
    const fileOps = engine.log({ filePath: 'src/new-file.ts' });
    expect(fileOps).toHaveLength(1);
    expect(fileOps[0].kind).toBe('vcs:fileAdd');
    expect(fileOps[0].vcs?.filePath).toBe('src/new-file.ts');
  });

  test('watch() does NOT duplicate ops for already-tracked files', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    const opsBefore = engine.getOpCount();

    // Start watching — no new files, so no new ops should be created
    engine.watch();
    await new Promise((resolve) => setTimeout(resolve, 500));
    engine.stop();

    // Op count should be unchanged (no spurious fileAdd ops)
    expect(engine.getOpCount()).toBe(opsBefore);
    expect(engine.trackedFiles()).toHaveLength(3);
  });

  test('EAV store contains directory entities with contains links', async () => {
    const engine = new TrellisVcsEngine({ rootPath: TEST_DIR });
    await engine.initRepo();

    const store = engine.getStore();
    const links = store.getLinksByAttribute('contains');
    expect(links.length).toBeGreaterThan(0);

    // src directory should contain src/index.ts
    const srcLinks = links.filter((l) => l.e1 === 'dir:src');
    expect(srcLinks.length).toBeGreaterThanOrEqual(2);
  });
});
