/**
 * Tests for SqliteKernelBackend
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteKernelBackend } from '../../src/core/persist/sqlite-backend.js';
import type { KernelOp } from '../../src/core/persist/backend.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function makeOp(
  hash: string,
  kind: string = 'addFacts',
  previousHash?: string,
): KernelOp {
  return {
    hash,
    kind: kind as any,
    timestamp: new Date().toISOString(),
    agentId: 'test-agent',
    previousHash,
    facts: [{ e: `entity:${hash}`, a: 'name', v: `test-${hash}` }],
  };
}

describe('SqliteKernelBackend', () => {
  let tmpDir: string;
  let backend: SqliteKernelBackend;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    backend = new SqliteKernelBackend(join(tmpDir, 'test.db'));
    backend.init();
  });

  afterEach(() => {
    backend.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should initialize without error', () => {
    expect(backend).toBeDefined();
  });

  it('should append and read ops', () => {
    const op1 = makeOp('trellis:op:aaa');
    const op2 = makeOp('trellis:op:bbb', 'addFacts', 'trellis:op:aaa');

    backend.append(op1);
    backend.append(op2);

    const all = backend.readAll();
    expect(all).toHaveLength(2);
    expect(all[0].hash).toBe('trellis:op:aaa');
    expect(all[1].hash).toBe('trellis:op:bbb');
    expect(all[1].previousHash).toBe('trellis:op:aaa');
  });

  it('should read until a specific op', () => {
    const op1 = makeOp('trellis:op:aaa');
    const op2 = makeOp('trellis:op:bbb', 'addFacts', 'trellis:op:aaa');
    const op3 = makeOp('trellis:op:ccc', 'addFacts', 'trellis:op:bbb');

    backend.append(op1);
    backend.append(op2);
    backend.append(op3);

    const until = backend.readUntil('trellis:op:bbb');
    expect(until).toHaveLength(2);
    expect(until[0].hash).toBe('trellis:op:aaa');
    expect(until[1].hash).toBe('trellis:op:bbb');
  });

  it('should read after a specific op', () => {
    const op1 = makeOp('trellis:op:aaa');
    const op2 = makeOp('trellis:op:bbb', 'addFacts', 'trellis:op:aaa');
    const op3 = makeOp('trellis:op:ccc', 'addFacts', 'trellis:op:bbb');

    backend.append(op1);
    backend.append(op2);
    backend.append(op3);

    const after = backend.readAfter('trellis:op:aaa');
    expect(after).toHaveLength(2);
    expect(after[0].hash).toBe('trellis:op:bbb');
    expect(after[1].hash).toBe('trellis:op:ccc');
  });

  it('should get the last op', () => {
    expect(backend.getLastOp()).toBeUndefined();

    backend.append(makeOp('trellis:op:aaa'));
    backend.append(makeOp('trellis:op:bbb'));

    const last = backend.getLastOp();
    expect(last?.hash).toBe('trellis:op:bbb');
  });

  it('should return op count', () => {
    expect(backend.count()).toBe(0);
    backend.append(makeOp('trellis:op:aaa'));
    backend.append(makeOp('trellis:op:bbb'));
    expect(backend.count()).toBe(2);
  });

  it('should find common ancestor', () => {
    const op1 = makeOp('trellis:op:aaa');
    const op2 = makeOp('trellis:op:bbb', 'addFacts', 'trellis:op:aaa');
    const op3 = makeOp('trellis:op:ccc', 'addFacts', 'trellis:op:aaa');

    backend.append(op1);
    backend.append(op2);
    backend.append(op3);

    const ancestor = backend.findCommonAncestor(
      'trellis:op:bbb',
      'trellis:op:ccc',
    );
    expect(ancestor?.hash).toBe('trellis:op:aaa');
  });

  it('should save and load snapshots', () => {
    backend.append(makeOp('trellis:op:aaa'));

    const data = { facts: [{ e: 'e1', a: 'name', v: 'test' }], links: [] };
    backend.saveSnapshot('trellis:op:aaa', data);

    const loaded = backend.loadLatestSnapshot();
    expect(loaded).toBeDefined();
    expect(loaded!.lastOpHash).toBe('trellis:op:aaa');
    expect(loaded!.data.facts).toHaveLength(1);
  });

  it('should store and retrieve blobs', () => {
    const content = new TextEncoder().encode('hello world');
    backend.putBlob('sha256:abc', content);

    expect(backend.hasBlob('sha256:abc')).toBe(true);
    expect(backend.hasBlob('sha256:xyz')).toBe(false);

    const retrieved = backend.getBlob('sha256:abc');
    expect(retrieved).toBeDefined();
    expect(new TextDecoder().decode(retrieved!)).toBe('hello world');
  });

  it('should batch append ops', () => {
    const ops = [
      makeOp('trellis:op:aaa'),
      makeOp('trellis:op:bbb', 'addFacts', 'trellis:op:aaa'),
      makeOp('trellis:op:ccc', 'addFacts', 'trellis:op:bbb'),
    ];

    backend.appendBatch(ops);
    expect(backend.count()).toBe(3);
    expect(backend.readAll()).toHaveLength(3);
  });

  it('should ignore duplicate ops on append', () => {
    const op = makeOp('trellis:op:aaa');
    backend.append(op);
    backend.append(op); // duplicate
    expect(backend.count()).toBe(1);
  });

  it('should preserve facts in op payload', () => {
    const op: KernelOp = {
      hash: 'trellis:op:aaa',
      kind: 'addFacts',
      timestamp: new Date().toISOString(),
      agentId: 'test-agent',
      facts: [
        { e: 'entity:1', a: 'name', v: 'Alice' },
        { e: 'entity:1', a: 'age', v: 30 },
      ],
      links: [{ e1: 'entity:1', a: 'knows', e2: 'entity:2' }],
    };

    backend.append(op);
    const loaded = backend.readAll();
    expect(loaded[0].facts).toHaveLength(2);
    expect(loaded[0].links).toHaveLength(1);
  });
});
