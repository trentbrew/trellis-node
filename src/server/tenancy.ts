/**
 * Trellis Server — Multi-Tenant Kernel Pool
 *
 * Manages a pool of `TrellisKernel` instances, one per tenant.
 * Each tenant gets an isolated SQLite database file in `<dbPath>/tenants/<tenantId>.sqlite`.
 *
 * The default tenant uses `<dbPath>/default.sqlite`.
 *
 * @module trellis/server
 */

import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { TrellisKernel } from '../core/kernel/trellis-kernel.js';
import { attachStandardMiddleware } from '../core/kernel/boot-middleware.js';
import { SqliteKernelBackend } from '../core/persist/sqlite-backend.js';
import type { KernelBackend } from '../core/persist/backend.js';
import type { CreateKernelBackendOptions } from '../core/persist/factory.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_TENANT = 'default';
const TENANTS_DIR = 'tenants';

// ---------------------------------------------------------------------------
// TenantPool
// ---------------------------------------------------------------------------

/**
 * A pool of `TrellisKernel` instances keyed by tenant ID.
 *
 * - Kernels are lazily created on first access.
 * - Each tenant's data lives in `<dbPath>/tenants/<tenantId>.sqlite`.
 * - The default tenant lives at `<dbPath>/default.sqlite`.
 */
export interface TenantPoolOptions {
  agentId?: string;
  /**
   * Backend selection forwarded to `createKernelBackend`. Only consulted by
   * `preload()` — `get()` always uses the synchronous bun:sqlite backend
   * for back-compat.
   */
  backend?: CreateKernelBackendOptions;
}

export class TenantPool {
  private pool: Map<string, TrellisKernel> = new Map();
  private dbPath: string;
  private agentId: string;
  private backendOpts: CreateKernelBackendOptions | undefined;

  constructor(
    dbPath: string,
    agentIdOrOpts: string | TenantPoolOptions = 'trellis-db',
  ) {
    this.dbPath = resolve(dbPath);
    if (typeof agentIdOrOpts === 'string') {
      this.agentId = agentIdOrOpts;
      this.backendOpts = undefined;
    } else {
      this.agentId = agentIdOrOpts.agentId ?? 'trellis-db';
      this.backendOpts = agentIdOrOpts.backend;
    }
    this._ensureDirs();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Get (or create) the kernel for a tenant.
   * Pass `null` or `undefined` to get the default tenant.
   *
   * Uses the synchronous bun:sqlite backend. To use an async backend
   * (better-sqlite3, sql.js) call `preload(tenantId)` first; subsequent
   * `get()` calls will return the preloaded kernel from the pool.
   */
  get(tenantId?: string | null): TrellisKernel {
    const id = tenantId ?? DEFAULT_TENANT;
    if (!this.pool.has(id)) {
      this.pool.set(id, this._createKernelSync(id));
    }
    return this.pool.get(id)!;
  }

  /**
   * Pre-create a tenant's kernel using the runtime-selected backend.
   * Required when running with an async-only backend (sql.js / WebContainer
   * / browser). Idempotent — safe to call multiple times.
   *
   * After `preload()`, subsequent `get(tenantId)` returns the same kernel
   * synchronously from the pool.
   */
  async preload(tenantId?: string | null): Promise<TrellisKernel> {
    const id = tenantId ?? DEFAULT_TENANT;
    const cached = this.pool.get(id);
    if (cached) return cached;
    const kernel = await this._createKernelAsync(id);
    this.pool.set(id, kernel);
    return kernel;
  }

  /**
   * Check whether a tenant has been initialized (kernel created).
   */
  has(tenantId: string): boolean {
    return this.pool.has(tenantId);
  }

  /**
   * List all active tenant IDs (those with open kernels).
   */
  activeTenants(): string[] {
    return Array.from(this.pool.keys());
  }

  /**
   * Close a specific tenant's kernel and remove it from the pool.
   */
  close(tenantId: string): void {
    const kernel = this.pool.get(tenantId);
    if (kernel) {
      kernel.close();
      this.pool.delete(tenantId);
    }
  }

  /**
   * Close all kernels and clear the pool.
   */
  closeAll(): void {
    for (const kernel of this.pool.values()) {
      kernel.close();
    }
    this.pool.clear();
  }

  /** Absolute path to the tenant data directory. */
  dataPath(): string {
    return this.dbPath;
  }

  /**
   * Return the SQLite file path for a given tenant.
   */
  dbFilePath(tenantId?: string | null): string {
    const id = tenantId ?? DEFAULT_TENANT;
    if (id === DEFAULT_TENANT) {
      return join(this.dbPath, 'default.sqlite');
    }
    return join(this.dbPath, TENANTS_DIR, `${id}.sqlite`);
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _createKernelSync(tenantId: string): TrellisKernel {
    const sqlitePath = this.dbFilePath(tenantId);
    const backend = new SqliteKernelBackend(sqlitePath);
    return this._wrapKernel(backend);
  }

  private async _createKernelAsync(tenantId: string): Promise<TrellisKernel> {
    const sqlitePath = this.dbFilePath(tenantId);
    const { createKernelBackend } = await import(
      '../core/persist/factory.js'
    );
    const backend = await createKernelBackend(sqlitePath, this.backendOpts);
    return this._wrapKernel(backend);
  }

  private _wrapKernel(backend: KernelBackend): TrellisKernel {
    const kernel = new TrellisKernel({
      backend,
      agentId: this.agentId,
      snapshotThreshold: 1000,
    });
    kernel.boot();
    attachStandardMiddleware(kernel);
    return kernel;
  }

  private _ensureDirs(): void {
    if (!existsSync(this.dbPath)) {
      mkdirSync(this.dbPath, { recursive: true });
    }
    const tenantsPath = join(this.dbPath, TENANTS_DIR);
    if (!existsSync(tenantsPath)) {
      mkdirSync(tenantsPath, { recursive: true });
    }
  }
}
