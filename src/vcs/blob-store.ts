/**
 * Content-Addressable Blob Store
 *
 * Stores file content indexed by SHA-256 hash. Provides the source of truth
 * for file reconstruction at any point in history. The EAV graph stores
 * structural metadata; the blob store stores byte-exact content.
 *
 * Storage format: `.trellis/blobs/{hash}` files on disk.
 * Future: migrate to SQLite `blobs(hash TEXT PRIMARY KEY, content BLOB)`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export class BlobStore {
  private blobDir: string;

  constructor(trellisDir: string) {
    this.blobDir = join(trellisDir, 'blobs');
    if (!existsSync(this.blobDir)) {
      mkdirSync(this.blobDir, { recursive: true });
    }
  }

  /**
   * Store content and return its SHA-256 hash.
   * Idempotent — storing the same content twice is a no-op.
   */
  async put(content: Buffer | Uint8Array): Promise<string> {
    const hash = await this.hash(content);
    const blobPath = join(this.blobDir, hash);
    if (!existsSync(blobPath)) {
      writeFileSync(blobPath, content);
    }
    return hash;
  }

  /**
   * Synchronous put — uses Bun's sync crypto if available.
   */
  putSync(content: Buffer | Uint8Array): string {
    const hash = this.hashSync(content);
    const blobPath = join(this.blobDir, hash);
    if (!existsSync(blobPath)) {
      writeFileSync(blobPath, content);
    }
    return hash;
  }

  /**
   * Retrieve content by hash. Returns null if not found.
   */
  get(hash: string): Buffer | null {
    const blobPath = join(this.blobDir, hash);
    if (!existsSync(blobPath)) {
      return null;
    }
    return readFileSync(blobPath);
  }

  /**
   * Check if a blob exists.
   */
  has(hash: string): boolean {
    return existsSync(join(this.blobDir, hash));
  }

  /**
   * Compute SHA-256 hash of content (async).
   */
  async hash(content: Buffer | Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      content as unknown as ArrayBuffer,
    );
    return this.hexFromBuffer(hashBuffer);
  }

  /**
   * Compute SHA-256 hash of content (sync).
   * Uses Bun.CryptoHasher when running under Bun, else node:crypto.
   */
  hashSync(content: Buffer | Uint8Array): string {
    const { createHash } = require('crypto');
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Returns the number of blobs stored.
   */
  count(): number {
    try {
      const { readdirSync } = require('fs');
      return readdirSync(this.blobDir).length;
    } catch {
      return 0;
    }
  }

  /**
   * Returns the total size of all blobs in bytes.
   */
  totalSize(): number {
    try {
      const { readdirSync, statSync } = require('fs');
      const files: string[] = readdirSync(this.blobDir);
      return files.reduce((sum: number, f: string) => {
        try {
          return sum + statSync(join(this.blobDir, f)).size;
        } catch {
          return sum;
        }
      }, 0);
    } catch {
      return 0;
    }
  }

  private hexFromBuffer(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
