/**
 * Kernel backend factory.
 *
 * Picks the right `KernelBackend` for the host runtime:
 *   - Node + better-sqlite3 loadable → BetterSqliteKernelBackend
 *   - Otherwise                      → SqlJsKernelBackend (pure WASM)
 *
 * Use this when you want runtime portability (e.g. WebContainer, browser,
 * restricted Node hosts). Callers that construct a specific backend directly
 * are unaffected.
 *
 * @module trellis/core/persist
 */

import type { KernelBackend } from './backend.js';

export interface CreateKernelBackendOptions {
  /**
   * Override automatic detection. Useful for tests and for environments
   * where the runtime check would pick the wrong backend.
   */
  backend?: 'better-sqlite' | 'sqljs';
  /** Forwarded to `SqlJsKernelBackend` when that backend is selected. */
  sqljs?: { autoFlushEvery?: number };
}

export async function createKernelBackend(
  dbPath: string,
  opts: CreateKernelBackendOptions = {},
): Promise<KernelBackend> {
  const choice = opts.backend ?? detectBackend();

  if (choice === 'better-sqlite') {
    const { BetterSqliteKernelBackend } = await import(
      './better-sqlite-backend.js'
    );
    const backend = new BetterSqliteKernelBackend(dbPath);
    backend.init();
    return backend;
  }

  const { SqlJsKernelBackend } = await import('./sqljs-backend.js');
  const backend = await SqlJsKernelBackend.create({
    dbPath,
    autoFlushEvery: opts.sqljs?.autoFlushEvery,
  });
  backend.init();
  return backend;
}

function detectBackend(): 'better-sqlite' | 'sqljs' {
  try {
    const { createRequire } = require('module');
    const req = createRequire(import.meta.url);
    // Actually load the module, not just resolve — native addons fail to load
    // in WebContainer and other restricted environments even when the package
    // is present on disk.
    req('better-sqlite3');
    return 'better-sqlite';
  } catch {
    return 'sqljs';
  }
}
