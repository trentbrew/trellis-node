import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { BlobStore } from '../../src/vcs/blob-store.js';
import { TrellisVcsEngine } from '../../src/engine.js';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_ROOT = '/tmp/trellis-p2-blob-test';

describe('BlobStore', () => {
  let store: BlobStore;

  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(join(TEST_ROOT, '.trellis'), { recursive: true });
    store = new BlobStore(join(TEST_ROOT, '.trellis'));
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('put stores content and returns hash', async () => {
    const content = Buffer.from('hello world');
    const hash = await store.put(content);
    expect(hash).toHaveLength(64); // SHA-256 hex = 64 chars
    expect(store.has(hash)).toBe(true);
  });

  test('get retrieves stored content', async () => {
    const content = Buffer.from('test content 123');
    const hash = await store.put(content);
    const retrieved = store.get(hash);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.toString()).toBe('test content 123');
  });

  test('get returns null for missing hash', () => {
    expect(store.get('nonexistent')).toBeNull();
  });

  test('has returns false for missing hash', () => {
    expect(store.has('nonexistent')).toBe(false);
  });

  test('put is idempotent', async () => {
    const content = Buffer.from('deduplicated');
    const hash1 = await store.put(content);
    const hash2 = await store.put(content);
    expect(hash1).toBe(hash2);
    expect(store.count()).toBe(1);
  });

  test('putSync works synchronously', () => {
    const content = Buffer.from('sync content');
    const hash = store.putSync(content);
    expect(hash).toHaveLength(64);
    expect(store.get(hash)!.toString()).toBe('sync content');
  });

  test('hash and hashSync produce identical results', async () => {
    const content = Buffer.from('consistent hashing');
    const asyncHash = await store.hash(content);
    const syncHash = store.hashSync(content);
    expect(asyncHash).toBe(syncHash);
  });

  test('count returns correct number of blobs', async () => {
    expect(store.count()).toBe(0);
    await store.put(Buffer.from('a'));
    expect(store.count()).toBe(1);
    await store.put(Buffer.from('b'));
    expect(store.count()).toBe(2);
    // Duplicate should not increase count
    await store.put(Buffer.from('a'));
    expect(store.count()).toBe(2);
  });

  test('totalSize returns correct byte count', async () => {
    expect(store.totalSize()).toBe(0);
    await store.put(Buffer.from('hello')); // 5 bytes
    await store.put(Buffer.from('world!')); // 6 bytes
    expect(store.totalSize()).toBe(11);
  });
});

describe('BlobStore integration with engine', () => {
  const REPO_ROOT = '/tmp/trellis-p2-blob-engine-test';

  afterEach(() => {
    rmSync(REPO_ROOT, { recursive: true, force: true });
  });

  test('initRepo stores blobs for tracked files', async () => {
    rmSync(REPO_ROOT, { recursive: true, force: true });
    mkdirSync(REPO_ROOT, { recursive: true });
    writeFileSync(join(REPO_ROOT, 'hello.txt'), 'hello world');
    writeFileSync(join(REPO_ROOT, 'foo.ts'), 'export const x = 1;');

    const engine = new TrellisVcsEngine({ rootPath: REPO_ROOT });
    await engine.initRepo();

    const blobStore = engine.getBlobStore();
    expect(blobStore).not.toBeNull();
    expect(blobStore!.count()).toBeGreaterThanOrEqual(2);

    // Verify we can retrieve content by hash
    const trackedFiles = engine.trackedFiles();
    for (const file of trackedFiles) {
      if (file.contentHash) {
        const content = blobStore!.get(file.contentHash);
        expect(content).not.toBeNull();
      }
    }
  });

  test('open() initializes blob store', async () => {
    rmSync(REPO_ROOT, { recursive: true, force: true });
    mkdirSync(REPO_ROOT, { recursive: true });
    writeFileSync(join(REPO_ROOT, 'test.ts'), 'const a = 1;');

    const engine1 = new TrellisVcsEngine({ rootPath: REPO_ROOT });
    await engine1.initRepo();

    // Re-open
    const engine2 = new TrellisVcsEngine({ rootPath: REPO_ROOT });
    engine2.open();

    expect(engine2.getBlobStore()).not.toBeNull();
    // Blobs from init should still be accessible
    expect(engine2.getBlobStore()!.count()).toBeGreaterThanOrEqual(1);
  });

  test('blobs directory is created inside .trellis', async () => {
    rmSync(REPO_ROOT, { recursive: true, force: true });
    mkdirSync(REPO_ROOT, { recursive: true });
    writeFileSync(join(REPO_ROOT, 'x.ts'), 'x');

    const engine = new TrellisVcsEngine({ rootPath: REPO_ROOT });
    await engine.initRepo();

    expect(existsSync(join(REPO_ROOT, '.trellis', 'blobs'))).toBe(true);
  });
});
