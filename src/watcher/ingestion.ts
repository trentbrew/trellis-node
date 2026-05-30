/**
 * Ingestion Pipeline
 *
 * Bridges the file watcher and the kernel: converts FileChangeEvents
 * into VcsOps and applies them to the kernel via mutate().
 */

import type { FileChangeEvent, VcsOpKind } from '../vcs/types.js';
import { createVcsOp } from '../vcs/ops.js';
import type { VcsOp } from '../vcs/types.js';
import { extname } from 'path';

// Simple language detection from file extension
const EXT_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.rb': 'ruby',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

function detectLanguage(filePath: string): string | undefined {
  const ext = extname(filePath).toLowerCase();
  return EXT_LANGUAGE[ext];
}

export class Ingestion {
  private agentId: string;
  private lastOpHash: string | undefined;
  private onOp: (op: VcsOp) => void | Promise<void>;

  constructor(opts: {
    agentId: string;
    lastOpHash?: string;
    onOp: (op: VcsOp) => void | Promise<void>;
  }) {
    this.agentId = opts.agentId;
    this.lastOpHash = opts.lastOpHash;
    this.onOp = opts.onOp;
  }

  /**
   * Processes a single FileChangeEvent, producing and emitting a VcsOp.
   */
  async process(event: FileChangeEvent): Promise<VcsOp> {
    let kind: VcsOpKind;

    switch (event.type) {
      case 'add':
        kind = 'vcs:fileAdd';
        break;
      case 'modify':
        kind = 'vcs:fileModify';
        break;
      case 'delete':
        kind = 'vcs:fileDelete';
        break;
      case 'rename':
        kind = 'vcs:fileRename';
        break;
    }

    const op = await createVcsOp(kind, {
      agentId: this.agentId,
      previousHash: this.lastOpHash,
      vcs: {
        filePath: event.path,
        oldFilePath: event.oldPath,
        contentHash: event.contentHash,
        oldContentHash: event.oldContentHash,
        size: event.size,
        language: detectLanguage(event.path),
      },
    });

    this.lastOpHash = op.hash;
    await this.onOp(op);
    return op;
  }

  /**
   * Processes a batch of FileChangeEvents in order.
   */
  async processBatch(events: FileChangeEvent[]): Promise<VcsOp[]> {
    const ops: VcsOp[] = [];
    for (const event of events) {
      ops.push(await this.process(event));
    }
    return ops;
  }

  getLastOpHash(): string | undefined {
    return this.lastOpHash;
  }

  setLastOpHash(hash: string | undefined): void {
    this.lastOpHash = hash;
  }
}
