import { test } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TrellisKernel } from '../src/core/kernel/trellis-kernel';
import { BetterSqliteKernelBackend } from '../src/core/persist/better-sqlite-backend';

test('checkpoint via kernel debug', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
  const backend = new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db'));
  const kernel = new TrellisKernel({
    backend,
    agentId: 'test-agent',
    snapshotThreshold: 0,
  });
  kernel.boot();
  await kernel.createEntity('user:1', 'User', { name: 'Alice' });
  
  const lastOp = backend.getLastOp();
  const snapshot = kernel.getStore().snapshot();
  console.log('lastOp:', lastOp);
  console.log('snapshot type:', typeof snapshot, 'is string?', typeof snapshot === 'string');
  console.log('_stmts keys:', Object.keys((backend as any)._stmts));
  
  // Try calling directly
  backend.saveSnapshot(lastOp!.hash, JSON.stringify(snapshot));
  console.log('direct saveSnapshot OK');
  
  // Now try via kernel.checkpoint
  kernel.checkpoint();
  console.log('kernel.checkpoint OK');
  
  kernel.close();
  rmSync(tmpDir, { recursive: true, force: true });
});
