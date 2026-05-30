import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { TrellisDb } from '../../src/client/sdk.js';
import { writeConfig } from '../../src/client/config.js';

const TMP = join(import.meta.dir, '__tmp_sdk_test');
const DB_PATH = join(TMP, 'data');

beforeEach(() => {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

describe('TrellisDb (local mode)', () => {
  it('creates and reads an entity', async () => {
    const db = new TrellisDb({ path: DB_PATH });

    const id = await db.create('Post', { title: 'Hello World', body: 'Content' });
    expect(typeof id).toBe('string');
    expect(id.startsWith('post:')).toBe(true);

    const entity = await db.read(id);
    expect(entity).not.toBeNull();
    expect(entity!.type).toBe('Post');
    expect(entity!.title).toBe('Hello World');

    db.close();
  });

  it('returns null for non-existent entity', async () => {
    const db = new TrellisDb({ path: DB_PATH });
    const entity = await db.read('post:nonexistent');
    expect(entity).toBeNull();
    db.close();
  });

  it('updates an entity', async () => {
    const db = new TrellisDb({ path: DB_PATH });

    const id = await db.create('Post', { title: 'Original' });
    await db.update(id, { title: 'Updated' });

    const entity = await db.read(id);
    expect(entity!.title).toBe('Updated');

    db.close();
  });

  it('deletes an entity', async () => {
    const db = new TrellisDb({ path: DB_PATH });

    const id = await db.create('Post', { title: 'To Delete' });
    await db.delete(id);

    const entity = await db.read(id);
    expect(entity).toBeNull();

    db.close();
  });

  it('lists entities by type', async () => {
    const db = new TrellisDb({ path: DB_PATH });

    await db.create('Post', { title: 'Post 1' });
    await db.create('Post', { title: 'Post 2' });
    await db.create('Comment', { body: 'A comment' });

    const posts = await db.list('Post');
    expect(posts.data.length).toBe(2);
    expect(posts.total).toBe(2);

    const comments = await db.list('Comment');
    expect(comments.data.length).toBe(1);

    db.close();
  });

  it('lists all entities when no type filter', async () => {
    const db = new TrellisDb({ path: DB_PATH });

    await db.create('Post', { title: 'Post 1' });
    await db.create('Comment', { body: 'Comment' });

    const all = await db.list();
    expect(all.data.length).toBeGreaterThanOrEqual(2);

    db.close();
  });

  it('uploads and downloads a file', async () => {
    const db = new TrellisDb({ path: DB_PATH });

    const data = new TextEncoder().encode('hello trellis db');
    const result = await db.upload(data, 'text/plain');

    expect(result.hash.startsWith('blob:')).toBe(true);
    expect(result.size).toBe(data.length);

    const downloaded = await db.getFile(result.hash);
    expect(downloaded).not.toBeNull();
    expect(new TextDecoder().decode(downloaded!)).toBe('hello trellis db');

    db.close();
  });

  it('returns null for non-existent blob', async () => {
    const db = new TrellisDb({ path: DB_PATH });
    const file = await db.getFile('blob:nonexistent');
    expect(file).toBeNull();
    db.close();
  });

  it('fromConfig reads local config', async () => {
    writeConfig({ mode: 'local', dbPath: DB_PATH }, TMP);
    const db = TrellisDb.fromConfig(TMP);
    const id = await db.create('Thing', { name: 'test' });
    expect(typeof id).toBe('string');
    db.close();
  });

  it('fromConfig throws when no config', () => {
    expect(() => TrellisDb.fromConfig(TMP + '/missing')).toThrow();
  });
});

describe('TrellisDb pagination', () => {
  it('respects limit and offset', async () => {
    const db = new TrellisDb({ path: DB_PATH });

    for (let i = 0; i < 10; i++) {
      await db.create('Item', { index: i });
    }

    const page1 = await db.list('Item', { limit: 3, offset: 0 });
    expect(page1.data.length).toBe(3);
    expect(page1.total).toBe(10);

    const page2 = await db.list('Item', { limit: 3, offset: 3 });
    expect(page2.data.length).toBe(3);

    db.close();
  });
});
