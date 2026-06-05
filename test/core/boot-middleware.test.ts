import { describe, expect, test, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { BetterSqliteKernelBackend } from '../../src/core/persist/better-sqlite-backend.js';
import { attachStandardMiddleware } from '../../src/core/kernel/boot-middleware.js';

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

  afterEach(() => {
    kernel?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });
});
