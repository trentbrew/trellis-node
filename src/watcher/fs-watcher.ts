/**
 * Filesystem Watcher
 *
 * Monitors a directory tree for changes using Bun's fs.watch.
 * Debounces rapid events and filters ignored paths.
 * Emits FileChangeEvents to a callback.
 */

import { watch, type FSWatcher } from 'fs';
import { readdir, stat, readFile } from 'fs/promises';
import { join, relative } from 'path';
import type { FileChangeEvent } from '../vcs/types.js';

export interface FileWatcherConfig {
  rootPath: string;
  ignorePatterns: string[];
  debounceMs: number;
  onEvent: (event: FileChangeEvent) => void | Promise<void>;
}

export interface ScanProgress {
  phase: 'discovering' | 'hashing' | 'done';
  current: number;
  total: number;
  message: string;
}

/**
 * Computes SHA-256 content hash for a file.
 */
async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  const hashBuffer = await crypto.subtle.digest('SHA-256', content as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Checks if a path matches any ignore pattern (simple glob-like matching).
 */
function shouldIgnore(relPath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Simple matching: exact segment match or extension glob
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1); // e.g. '.log'
      if (relPath.endsWith(ext)) return true;
    } else if (relPath.includes(pattern)) {
      return true;
    }
  }
  return false;
}

export class FileWatcher {
  private config: FileWatcherConfig;
  private watchers: FSWatcher[] = [];
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private knownFiles = new Map<string, string>(); // relPath → contentHash
  private running = false;

  constructor(config: FileWatcherConfig) {
    this.config = config;
  }

  /**
   * Scans the directory tree and builds an initial map of all tracked files.
   * Returns the list of FileChangeEvents for the initial state (all adds).
   */
  async scan(opts?: {
    onProgress?: (progress: ScanProgress) => void;
  }): Promise<FileChangeEvent[]> {
    const events: FileChangeEvent[] = [];
    opts?.onProgress?.({
      phase: 'discovering',
      current: 0,
      total: 0,
      message: 'Discovering existing files…',
    });
    const entries = await this.walkDir(this.config.rootPath);
    opts?.onProgress?.({
      phase: 'hashing',
      current: 0,
      total: entries.length,
      message: `Hashing ${entries.length} existing files…`,
    });

    for (let i = 0; i < entries.length; i++) {
      const absPath = entries[i];
      const relPath = relative(this.config.rootPath, absPath);
      if (shouldIgnore(relPath, this.config.ignorePatterns)) continue;

      try {
        const hash = await hashFile(absPath);
        const stats = await stat(absPath);
        this.knownFiles.set(relPath, hash);
        events.push({
          type: 'add',
          path: relPath,
          contentHash: hash,
          size: stats.size,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // File may have been deleted between scan and hash
      }

      if ((i + 1) % 25 === 0 || i === entries.length - 1) {
        opts?.onProgress?.({
          phase: 'hashing',
          current: i + 1,
          total: entries.length,
          message: `Hashed ${i + 1}/${entries.length} files`,
        });
      }
    }

    opts?.onProgress?.({
      phase: 'done',
      current: events.length,
      total: events.length,
      message: `Discovered ${events.length} trackable files`,
    });

    return events;
  }

  /**
   * Starts watching the directory tree for changes.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    try {
      const watcher = watch(
        this.config.rootPath,
        { recursive: true },
        (eventType, filename) => {
          if (!filename) return;
          const relPath = filename.toString();
          if (shouldIgnore(relPath, this.config.ignorePatterns)) return;
          this.debouncedHandle(relPath);
        },
      );
      this.watchers.push(watcher);
    } catch {
      // recursive watch not supported on all platforms; fall back gracefully
      console.warn('Recursive watch not supported; using scan-based polling.');
    }
  }

  /**
   * Stops all watchers.
   */
  stop(): void {
    this.running = false;
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Returns the current known file map (path → contentHash).
   */
  getKnownFiles(): Map<string, string> {
    return new Map(this.knownFiles);
  }

  private debouncedHandle(relPath: string): void {
    const existing = this.debounceTimers.get(relPath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(relPath);
      await this.handleChange(relPath);
    }, this.config.debounceMs);

    this.debounceTimers.set(relPath, timer);
  }

  private async handleChange(relPath: string): Promise<void> {
    const absPath = join(this.config.rootPath, relPath);
    const known = this.knownFiles.get(relPath);

    try {
      const stats = await stat(absPath);
      if (!stats.isFile()) return;

      const hash = await hashFile(absPath);

      if (!known) {
        // New file
        this.knownFiles.set(relPath, hash);
        await this.config.onEvent({
          type: 'add',
          path: relPath,
          contentHash: hash,
          size: stats.size,
          timestamp: new Date().toISOString(),
        });
      } else if (known !== hash) {
        // Modified file
        const oldHash = known;
        this.knownFiles.set(relPath, hash);
        await this.config.onEvent({
          type: 'modify',
          path: relPath,
          contentHash: hash,
          oldContentHash: oldHash,
          size: stats.size,
          timestamp: new Date().toISOString(),
        });
      }
      // If hash is the same, no event (unchanged)
    } catch {
      // File doesn't exist → it was deleted
      if (known) {
        this.knownFiles.delete(relPath);
        await this.config.onEvent({
          type: 'delete',
          path: relPath,
          contentHash: known,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  private async walkDir(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relFromRoot = relative(this.config.rootPath, fullPath);
        if (shouldIgnore(relFromRoot, this.config.ignorePatterns)) continue;

        if (entry.isDirectory()) {
          const sub = await this.walkDir(fullPath);
          results.push(...sub);
        } else if (entry.isFile()) {
          results.push(fullPath);
        }
      }
    } catch {
      // Permission error or deleted dir
    }
    return results;
  }
}
