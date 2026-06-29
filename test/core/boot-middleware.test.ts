import { describe, expect, test, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { BetterSqliteKernelBackend } from '../../src/core/persist/better-sqlite-backend.js';
import { z } from 'zod';
import { attachStandardMiddleware } from '../../src/core/kernel/boot-middleware.js';
import { defineType } from '../../src/schema/define.js';

const ChatMessage = defineType(
  'message',
  {
    room: z.string(),
    author: z.string(),
    color: z.string(),
    text: z.string(),
    createdAt: z.number(),
  },
  { title: 'text' },
);

describe('attachStandardMiddleware', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;

  test('registers logic-computation middleware once', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-boot-mw-'));
    kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'test.db')),
      agentId: 'test',
    });
    kernel.boot();
    attachStandardMiddleware(kernel);
    attachStandardMiddleware(kernel);

    const query = {
      select: ['e'],
      where: [],
      filters: [],
      aggregates: [],
      orderBy: [],
      limit: 0,
      offset: 0,
    };

    const result = await kernel.query(query);
    expect(Array.isArray(result.bindings)).toBe(true);
  });

  test('allows numeric createdAt on types that declare it', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-boot-mw-chat-'));
    kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'test.db')),
      agentId: 'test',
    });
    kernel.boot();
    kernel.createOntology(ChatMessage.definition);
    attachStandardMiddleware(kernel);

    const ts = Date.now();
    await expect(
      kernel.createEntity('message:1', 'message', {
        room: 'lobby',
        author: 'Test',
        color: '#ff0000',
        text: 'hello',
        createdAt: ts,
      }),
    ).resolves.toBeDefined();

    const createdFacts = kernel.getEntity('message:1')!.facts.filter((f) => f.a === 'createdAt');
    expect(createdFacts).toHaveLength(1);
    expect(createdFacts[0].v).toBe(ts);
  });

  afterEach(() => {
    kernel?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });
});
