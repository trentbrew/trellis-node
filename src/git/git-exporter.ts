/**
 * Git Exporter
 *
 * Serializes TrellisVCS milestones back to Git commits.
 * Each milestone becomes a Git commit with:
 *   - The milestone message as the commit message
 *   - File states reconstructed from the blob store
 *   - Author info from the milestone's createdBy identity
 *
 * The exporter creates a new Git repo (or uses an existing one)
 * and leaves the TrellisVCS repo untouched.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { TrellisVcsEngine } from '../engine.js';
import { BlobStore } from '../vcs/blob-store.js';
import type { VcsOp } from '../vcs/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportOptions {
  /** Path to the TrellisVCS repository to export from. */
  from: string;

  /** Path to the target Git repository. */
  to: string;

  /** Author name for commits (default: "TrellisVCS Export"). */
  authorName?: string;

  /** Author email for commits (default: "export@trellis.dev"). */
  authorEmail?: string;

  /** Callback for progress reporting. */
  onProgress?: (progress: ExportProgress) => void;
}

export interface ExportProgress {
  phase: 'preparing' | 'exporting' | 'done';
  current: number;
  total: number;
  message: string;
}

export interface ExportResult {
  milestonesExported: number;
  commitsCreated: number;
  duration: number;
}

// ---------------------------------------------------------------------------
// Exporter
// ---------------------------------------------------------------------------

export async function exportToGit(opts: ExportOptions): Promise<ExportResult> {
  const startTime = Date.now();

  // Open the TrellisVCS repo
  const engine = new TrellisVcsEngine({ rootPath: opts.from });
  engine.open();

  const blobStore = engine.getBlobStore();
  if (!blobStore) {
    throw new Error('Blob store not available. Re-open the repo first.');
  }

  // Get all milestones and ops
  const milestones = engine.listMilestones();
  const allOps = engine.getOps();

  opts.onProgress?.({
    phase: 'preparing',
    current: 0,
    total: milestones.length,
    message: `Found ${milestones.length} milestones to export`,
  });

  if (milestones.length === 0) {
    return {
      milestonesExported: 0,
      commitsCreated: 0,
      duration: Date.now() - startTime,
    };
  }

  // Initialize target Git repo
  if (!existsSync(opts.to)) {
    mkdirSync(opts.to, { recursive: true });
  }

  const isGitRepo = existsSync(join(opts.to, '.git'));
  if (!isGitRepo) {
    git(opts.to, 'init');
    git(
      opts.to,
      `config user.email "${opts.authorEmail ?? 'export@trellis.dev'}"`,
    );
    git(
      opts.to,
      `config user.name "${opts.authorName ?? 'TrellisVCS Export'}"`,
    );
  }

  let commitsCreated = 0;

  // Build a milestone-ordered export by walking the op stream sequentially.
  // Each milestone op marks a commit boundary. Ops between milestones are
  // applied to the working directory, then committed with the milestone's
  // message. This works regardless of whether milestones have
  // fromOpHash/toOpHash (imported milestones often don't).

  // Build milestone lookup: milestoneId → milestone metadata
  const milestoneMap = new Map(milestones.map((m) => [m.id, m]));

  // Cumulative file state tracker
  const fileStates = new Map<string, FileState>();
  let pendingChanges = false;
  let milestoneIdx = 0;

  for (const op of allOps) {
    // Track file changes
    if (op.vcs?.filePath) {
      switch (op.kind) {
        case 'vcs:fileAdd':
        case 'vcs:fileModify':
          fileStates.set(op.vcs.filePath, { contentHash: op.vcs.contentHash });
          pendingChanges = true;
          break;
        case 'vcs:fileDelete':
          fileStates.set(op.vcs.filePath, { deleted: true });
          pendingChanges = true;
          break;
        case 'vcs:fileRename':
          if (op.vcs.oldFilePath) {
            fileStates.set(op.vcs.oldFilePath, { deleted: true });
          }
          fileStates.set(op.vcs.filePath, { contentHash: op.vcs.contentHash });
          pendingChanges = true;
          break;
      }
    }

    // Check if this op is a milestone boundary
    if (op.kind !== 'vcs:milestoneCreate') continue;

    const milestoneId = op.vcs?.milestoneId;
    const milestone = milestoneId ? milestoneMap.get(milestoneId) : undefined;
    milestoneIdx++;

    opts.onProgress?.({
      phase: 'exporting',
      current: milestoneIdx,
      total: milestones.length,
      message: `Exporting milestone ${milestoneIdx}/${milestones.length}: ${(op.vcs?.message ?? '').slice(0, 60)}`,
    });

    // Write current file state snapshot to the git working directory
    for (const [filePath, state] of fileStates.entries()) {
      const absPath = join(opts.to, filePath);

      if (state.deleted) {
        if (existsSync(absPath)) {
          unlinkSync(absPath);
        }
      } else if (state.contentHash && blobStore) {
        const content = blobStore.get(state.contentHash);
        if (content) {
          const dir = dirname(absPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(absPath, content);
        }
      }
    }

    // Stage all changes
    git(opts.to, 'add -A');

    // Check if there are changes to commit
    const status = git(opts.to, 'status --porcelain');
    if (status.trim().length === 0 && commitsCreated > 0) {
      continue;
    }

    // Extract author info
    const authorName =
      opts.authorName ?? extractAuthorName(milestone?.createdBy ?? op.agentId);
    const authorEmail =
      opts.authorEmail ??
      extractAuthorEmail(milestone?.createdBy ?? op.agentId);
    const message =
      op.vcs?.message ?? milestone?.message ?? `Milestone ${milestoneId}`;
    const date =
      milestone?.createdAt ?? op.timestamp ?? new Date().toISOString();

    try {
      gitWithEnv(
        opts.to,
        `commit --allow-empty --author="${authorName} <${authorEmail}>" -m "${escapeMessage(message)}"`,
        {
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
        },
      );
      commitsCreated++;
      pendingChanges = false;
    } catch {
      // If commit fails, skip
    }
  }

  opts.onProgress?.({
    phase: 'done',
    current: milestones.length,
    total: milestones.length,
    message: `Exported ${commitsCreated} commits from ${milestones.length} milestones`,
  });

  return {
    milestonesExported: milestones.length,
    commitsCreated,
    duration: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(repoPath: string, command: string): string {
  try {
    return execSync(`git -C "${repoPath}" ${command}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    if (err.stdout) return err.stdout;
    throw err;
  }
}

function gitWithEnv(
  repoPath: string,
  command: string,
  extraEnv: Record<string, string>,
): string {
  return execSync(`git -C "${repoPath}" ${command}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
  });
}

function escapeMessage(msg: string): string {
  return msg.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function extractAuthorName(createdBy?: string): string {
  if (!createdBy) return 'TrellisVCS Export';
  // createdBy is typically "identity:alice@example.com" or "identity:alice"
  const id = createdBy.replace('identity:', '');
  // If it looks like an email, extract the name part
  if (id.includes('@')) {
    return id.split('@')[0];
  }
  return id;
}

function extractAuthorEmail(createdBy?: string): string {
  if (!createdBy) return 'export@trellis.dev';
  const id = createdBy.replace('identity:', '');
  if (id.includes('@')) {
    return id;
  }
  return `${id}@trellis.dev`;
}

interface FileState {
  contentHash?: string;
  deleted?: boolean;
}
