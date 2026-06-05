/**
 * JSON-file-backed op log (P0).
 * Shared by integration journal and per-lane journals (ADR 0001, ADR 0005).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  openSync,
  closeSync,
  unlinkSync,
  renameSync,
} from 'fs';
import { dirname } from 'path';
import type { VcsOp } from './types.js';

/**
 * Backend-agnostic op log surface.
 *
 * Implementations may persist to filesystem (`JsonOpLog`), IndexedDB
 * (`IdbOpLog`), or any other store. The contract:
 *
 * - `load()` returns `void | Promise<void>` so filesystem backends can stay
 *   synchronous while browser backends (IndexedDB, OPFS) are async. Callers
 *   that may use either backend should `await opLog.load()`.
 * - `append()`, `readAll()`, `getLastOp()`, `count()` are sync — they
 *   operate on an in-memory cache the backend maintains. Sync reads are
 *   required by the engine, which does not await op-log access on hot paths.
 * - `flush()` is optional — when present, awaiting it guarantees durability
 *   for backends with deferred writes (e.g. IndexedDB). Filesystem backends
 *   that write synchronously may omit it.
 *
 * Implementations are responsible for hash-deduplication on `append`.
 */
export interface OpLog {
  load(): void | Promise<void>;
  append(op: VcsOp): void;
  readAll(): VcsOp[];
  getLastOp(): VcsOp | undefined;
  count(): number;
  flush?(): Promise<void>;
}

function lockTimeoutMs(): number {
  const raw = process.env.TRELLIS_OPLOG_LOCK_MS;
  if (!raw) return 5000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
}

export class JsonOpLog implements OpLog {
  private ops: VcsOp[] = [];
  private filePath: string;
  private lockPath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
  }

  get path(): string {
    return this.filePath;
  }

  load(): void {
    if (existsSync(this.filePath)) {
      const raw = readFileSync(this.filePath, 'utf-8');
      try {
        this.ops = JSON.parse(raw);
      } catch {
        const backupPath = this.filePath + '.bak';
        if (existsSync(backupPath)) {
          const backupRaw = readFileSync(backupPath, 'utf-8');
          this.ops = JSON.parse(backupRaw);
          writeFileSync(this.filePath, backupRaw);
        } else {
          throw new Error(
            `Corrupted ops log at ${this.filePath} and no backup found. Run \`trellis repair\` to attempt recovery.`,
          );
        }
      }
    }
  }

  append(op: VcsOp): void {
    this.withLock(() => {
      const diskOps = this.readOpsFromDisk();
      this.ops = diskOps;

      if (this.ops.some((existing) => existing.hash === op.hash)) {
        return;
      }

      this.ops.push(op);
      this.writeOpsToDisk();
    });
  }

  readAll(): VcsOp[] {
    return [...this.ops];
  }

  getLastOp(): VcsOp | undefined {
    return this.ops.length > 0 ? this.ops[this.ops.length - 1] : undefined;
  }

  count(): number {
    return this.ops.length;
  }

  private writeOpsToDisk(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(this.filePath)) {
      const backupPath = this.filePath + '.bak';
      try {
        copyFileSync(this.filePath, backupPath);
      } catch {
        // best-effort
      }
    }
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(this.ops, null, 2));
    renameSync(tempPath, this.filePath);
  }

  private readOpsFromDisk(): VcsOp[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const raw = readFileSync(this.filePath, 'utf-8');
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      const backupPath = this.filePath + '.bak';
      if (existsSync(backupPath)) {
        const backupRaw = readFileSync(backupPath, 'utf-8');
        const parsedBackup = JSON.parse(backupRaw);
        writeFileSync(this.filePath, backupRaw);
        return Array.isArray(parsedBackup) ? parsedBackup : [];
      }
      throw new Error(
        `Corrupted ops log at ${this.filePath} and no backup found. Run \`trellis repair\` to attempt recovery.`,
      );
    }
  }

  private withLock(fn: () => void): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const deadline = Date.now() + lockTimeoutMs();
    let lockFd: number | undefined;

    while (Date.now() < deadline) {
      try {
        lockFd = openSync(this.lockPath, 'wx');
        break;
      } catch (err: any) {
        if (err?.code !== 'EEXIST') {
          throw err;
        }
      }
    }

    if (lockFd === undefined) {
      throw new Error(
        `Timed out waiting for ops log lock: ${this.lockPath}. Another Trellis process may be stalled.`,
      );
    }

    try {
      fn();
    } finally {
      closeSync(lockFd);
      try {
        unlinkSync(this.lockPath);
      } catch {
        // best-effort
      }
    }
  }

  static repair(filePath: string): { recovered: number; lost: number } {
    if (!existsSync(filePath)) {
      return { recovered: 0, lost: 0 };
    }

    const raw = readFileSync(filePath, 'utf-8');

    try {
      const ops = JSON.parse(raw);
      return { recovered: ops.length, lost: 0 };
    } catch {
      // corrupted — attempt truncation repair
    }

    const lastHash = raw.lastIndexOf('"hash": "trellis:op:');
    if (lastHash === -1) {
      const bakPath = filePath + '.bak';
      if (existsSync(bakPath)) {
        const bakRaw = readFileSync(bakPath, 'utf-8');
        try {
          const ops = JSON.parse(bakRaw);
          writeFileSync(filePath, bakRaw);
          return { recovered: ops.length, lost: 0 };
        } catch {
          // backup also corrupted
        }
      }
      writeFileSync(filePath, '[]');
      return { recovered: 0, lost: -1 };
    }

    const endOfLine = raw.indexOf('\n', lastHash);
    const closingBrace = raw.indexOf('  }', endOfLine);
    if (closingBrace === -1) {
      writeFileSync(filePath, '[]');
      return { recovered: 0, lost: -1 };
    }

    const fixed = raw.slice(0, closingBrace + 3) + '\n]';
    try {
      const ops = JSON.parse(fixed);
      writeFileSync(filePath + '.corrupted', raw);
      writeFileSync(filePath, fixed);
      return { recovered: ops.length, lost: 0 };
    } catch {
      writeFileSync(filePath + '.corrupted', raw);
      writeFileSync(filePath, '[]');
      return { recovered: 0, lost: -1 };
    }
  }
}

/** Lane journal op log — same implementation, distinct path (ADR 0001, ADR 0005). */
export class LaneOpLog extends JsonOpLog {
  constructor(laneDir: string) {
    super(`${laneDir}/ops.json`);
  }
}
