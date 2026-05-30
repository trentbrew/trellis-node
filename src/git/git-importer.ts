/**
 * Git Importer
 *
 * Converts a Git repository's commit history into TrellisVCS operations.
 * Each Git commit becomes:
 *   1. A sequence of Tier 0 file-level ops (vcs:fileAdd, vcs:fileModify, etc.)
 *   2. A vcs:milestoneCreate op (commit message → milestone)
 *
 * The importer reads from the Git repo, writes into a TrellisVCS engine,
 * and leaves the original Git repo untouched.
 */

import {
  GitReader,
  type GitCommitWithChanges,
  type GitFileChange,
} from './git-reader.js';
import { TrellisVcsEngine } from '../engine.js';
import { createVcsOp } from '../vcs/ops.js';
import type { VcsOp, VcsOpKind } from '../vcs/types.js';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportOptions {
  /** Path to the source Git repository. */
  from: string;

  /** Path to the target TrellisVCS repository (defaults to cwd). */
  to: string;

  /** Agent ID for the import. Defaults to Git author info. */
  agentId?: string;

  /** Callback for progress reporting. */
  onProgress?: (progress: ImportProgress) => void;
}

export interface ImportProgress {
  phase: 'reading' | 'importing' | 'done';
  current: number;
  total: number;
  message: string;
}

export interface ImportResult {
  commitsImported: number;
  opsCreated: number;
  filesTracked: number;
  branches: string[];
  duration: number;
}

// ---------------------------------------------------------------------------
// Importer
// ---------------------------------------------------------------------------

export async function importFromGit(
  opts: ImportOptions,
): Promise<ImportResult> {
  const startTime = Date.now();
  const gitReader = new GitReader(opts.from);

  if (!gitReader.isGitRepo()) {
    throw new Error(`Not a Git repository: ${opts.from}`);
  }

  // --- Phase 1: Read Git history ---
  opts.onProgress?.({
    phase: 'reading',
    current: 0,
    total: 0,
    message: 'Reading Git history…',
  });

  const history = gitReader.readFullHistory();
  const branches = gitReader.branches();
  const defaultBranch = gitReader.currentBranch();

  opts.onProgress?.({
    phase: 'reading',
    current: history.length,
    total: history.length,
    message: `Read ${history.length} commits`,
  });

  // --- Phase 2: Create TrellisVCS repo and import ---
  const engine = new TrellisVcsEngine({
    rootPath: opts.to,
    agentId: opts.agentId ?? `git-import:${opts.from}`,
    defaultBranch,
  });

  // Initialize the target repo (creates .trellis/ but skip file scan)
  const trellisDir = join(opts.to, '.trellis');
  if (!existsSync(trellisDir)) {
    mkdirSync(trellisDir, { recursive: true });
  }

  // We need to manually initialize since we don't want the default file scan.
  // Create branch op + import commits.
  const importEngine = new ImportEngine(engine, opts);

  await importEngine.createBranch(defaultBranch);

  let opsCreated = 1; // branch op
  const trackedFiles = new Set<string>();

  for (let i = 0; i < history.length; i++) {
    const commit = history[i];

    opts.onProgress?.({
      phase: 'importing',
      current: i + 1,
      total: history.length,
      message: `Importing commit ${i + 1}/${history.length}: ${commit.message.slice(0, 60)}`,
    });

    // Convert each file change to a VcsOp
    for (const change of commit.changes) {
      const op = await importEngine.convertChange(change, commit);
      opsCreated++;

      if (
        change.status === 'A' ||
        change.status === 'M' ||
        change.status === 'R'
      ) {
        trackedFiles.add(change.path);
      }
      if (change.status === 'D') {
        trackedFiles.delete(change.path);
      }
      if (change.status === 'R' && change.oldPath) {
        trackedFiles.delete(change.oldPath);
      }
    }

    // Create a milestone for this commit
    await importEngine.createMilestone(commit);
    opsCreated++;
  }

  opts.onProgress?.({
    phase: 'done',
    current: history.length,
    total: history.length,
    message: `Imported ${history.length} commits → ${opsCreated} ops`,
  });

  return {
    commitsImported: history.length,
    opsCreated,
    filesTracked: trackedFiles.size,
    branches,
    duration: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Internal Import Engine
// ---------------------------------------------------------------------------

class ImportEngine {
  private engine: TrellisVcsEngine;
  private opts: ImportOptions;
  private lastOpHash: string | undefined;
  private ops: VcsOp[] = [];

  constructor(engine: TrellisVcsEngine, opts: ImportOptions) {
    this.engine = engine;
    this.opts = opts;
  }

  async createBranch(name: string): Promise<void> {
    const op = await createVcsOp('vcs:branchCreate', {
      agentId: this.agentId(),
      previousHash: this.lastOpHash,
      vcs: { branchName: name },
    });
    this.append(op);
  }

  async convertChange(
    change: GitFileChange,
    commit: GitCommitWithChanges,
  ): Promise<VcsOp> {
    const agentId = `identity:${commit.authorEmail}`;
    let kind: VcsOpKind;

    switch (change.status) {
      case 'A':
        kind = 'vcs:fileAdd';
        break;
      case 'M':
        kind = 'vcs:fileModify';
        break;
      case 'D':
        kind = 'vcs:fileDelete';
        break;
      case 'R':
        kind = 'vcs:fileRename';
        break;
    }

    // Hash the file content at this commit for content-addressability
    let contentHash: string | undefined;
    if (change.status !== 'D') {
      contentHash = await this.hashFileAtCommit(commit.hash, change.path);
    }

    let oldContentHash: string | undefined;
    if (change.status === 'M' && commit.parentHashes[0]) {
      oldContentHash = await this.hashFileAtCommit(
        commit.parentHashes[0],
        change.path,
      );
    }

    const op = await createVcsOp(kind, {
      agentId,
      previousHash: this.lastOpHash,
      vcs: {
        filePath: change.path,
        oldFilePath: change.oldPath,
        contentHash,
        oldContentHash,
      },
    });

    // Override timestamp to match Git commit time
    (op as any).timestamp = commit.timestamp;

    this.append(op);
    return op;
  }

  async createMilestone(commit: GitCommitWithChanges): Promise<void> {
    const agentId = `identity:${commit.authorEmail}`;
    const milestoneId = `milestone:git:${commit.hash.slice(0, 12)}`;

    const op = await createVcsOp('vcs:milestoneCreate', {
      agentId,
      previousHash: this.lastOpHash,
      vcs: {
        milestoneId,
        message: commit.message,
      },
    });

    // Override timestamp to match Git commit time
    (op as any).timestamp = commit.timestamp;

    this.append(op);
  }

  private append(op: VcsOp): void {
    this.lastOpHash = op.hash;
    this.ops.push(op);

    // Write ops to the engine's op log
    this.flushOps();
  }

  private flushOps(): void {
    const opsPath = join(this.opts.to, '.trellis', 'ops.json');
    const configPath = join(this.opts.to, '.trellis', 'config.json');
    const trellisDir = join(this.opts.to, '.trellis');

    if (!existsSync(trellisDir)) {
      mkdirSync(trellisDir, { recursive: true });
    }

    // Write config if it doesn't exist
    if (!existsSync(configPath)) {
      const config = {
        rootPath: this.opts.to,
        ignorePatterns: [
          'node_modules',
          '.git',
          '.trellis',
          'dist',
          'build',
          '.DS_Store',
          '*.log',
        ],
        debounceMs: 300,
        defaultBranch: 'main',
        agentId: this.agentId(),
        createdAt: new Date().toISOString(),
      };
      const { writeFileSync } = require('fs');
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    }

    // Write full ops array
    const { writeFileSync } = require('fs');
    writeFileSync(opsPath, JSON.stringify(this.ops, null, 2));
  }

  private async hashFileAtCommit(
    commitHash: string,
    filePath: string,
  ): Promise<string | undefined> {
    try {
      const reader = new GitReader(this.opts.from);
      const content = reader.readFileContent(commitHash, filePath);
      if (!content) {
        return undefined;
      }

      const hashBuffer = await crypto.subtle.digest(
        'SHA-256',
        content as unknown as ArrayBuffer,
      );
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return undefined;
    }
  }

  private agentId(): string {
    return this.opts.agentId ?? `git-import:${this.opts.from}`;
  }
}
