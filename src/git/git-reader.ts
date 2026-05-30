/**
 * Git Reader
 *
 * Reads a Git repository's commit graph and file-level diffs
 * by shelling out to `git`. No libgit2 dependency.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitCommit {
  hash: string;
  authorName: string;
  authorEmail: string;
  timestamp: string; // ISO 8601
  message: string;
  parentHashes: string[];
}

export interface GitFileChange {
  status: 'A' | 'M' | 'D' | 'R'; // Added, Modified, Deleted, Renamed
  path: string;
  oldPath?: string; // only for renames
}

export interface GitCommitWithChanges extends GitCommit {
  changes: GitFileChange[];
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

export class GitReader {
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  /**
   * Verifies this is a valid Git repository.
   */
  isGitRepo(): boolean {
    return existsSync(join(this.repoPath, '.git'));
  }

  /**
   * Returns all commits in topological order (oldest first).
   */
  readCommits(): GitCommit[] {
    // Format: hash|authorName|authorEmail|isoTimestamp|parentHashes|subject
    const SEP = '‖'; // unlikely to appear in commit messages
    const format = `%H${SEP}%an${SEP}%ae${SEP}%aI${SEP}%P${SEP}%s`;

    const raw = this.git(`log --all --reverse --format="${format}"`);
    if (!raw.trim()) {
      return [];
    }

    return raw
      .trim()
      .split('\n')
      .map((line) => {
        const parts = line.split(SEP);
        return {
          hash: parts[0],
          authorName: parts[1],
          authorEmail: parts[2],
          timestamp: parts[3],
          parentHashes: parts[4] ? parts[4].split(' ').filter(Boolean) : [],
          message: parts[5] ?? '',
        };
      });
  }

  /**
   * Returns file changes for a specific commit.
   * For the root commit (no parents), diffs against empty tree.
   */
  readChanges(commitHash: string, parentHash?: string): GitFileChange[] {
    let raw: string;

    if (parentHash) {
      // Diff between parent and this commit
      raw = this.git(
        `diff-tree -r --name-status --no-commit-id -M ${parentHash} ${commitHash}`,
      );
    } else {
      // Root commit: use --root flag to diff against empty tree
      raw = this.git(
        `diff-tree -r --root --name-status --no-commit-id -M ${commitHash}`,
      );
    }

    if (!raw.trim()) {
      return [];
    }

    return raw
      .trim()
      .split('\n')
      .map((line) => {
        const parts = line.split('\t');
        const statusCode = parts[0].charAt(0) as 'A' | 'M' | 'D' | 'R';

        if (statusCode === 'R') {
          // Rename: R100\toldPath\tnewPath
          return { status: 'R', oldPath: parts[1], path: parts[2] };
        }

        return { status: statusCode, path: parts[1] };
      });
  }

  /**
   * Returns the full content of a file at a specific commit.
   */
  readFileContent(commitHash: string, filePath: string): Buffer | null {
    try {
      return Buffer.from(this.gitBuffer(`show ${commitHash}:${filePath}`));
    } catch {
      return null;
    }
  }

  /**
   * Reads all commits with their file changes in topological order.
   * This is the main entry point for the import pipeline.
   */
  readFullHistory(): GitCommitWithChanges[] {
    const commits = this.readCommits();

    return commits.map((commit) => {
      const parentHash = commit.parentHashes[0]; // first parent for changes
      const changes = this.readChanges(commit.hash, parentHash);
      return { ...commit, changes };
    });
  }

  /**
   * Returns the total number of commits.
   */
  commitCount(): number {
    const raw = this.git('rev-list --all --count');
    return parseInt(raw.trim(), 10) || 0;
  }

  /**
   * Returns the current branch name.
   */
  currentBranch(): string {
    try {
      return this.git('rev-parse --abbrev-ref HEAD').trim();
    } catch {
      return 'main';
    }
  }

  /**
   * Returns all branch names.
   */
  branches(): string[] {
    const raw = this.git('branch --format="%(refname:short)"');
    return raw.trim().split('\n').filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private git(args: string): string {
    return execSync(`git -C "${this.repoPath}" ${args}`, {
      encoding: 'utf-8',
      maxBuffer: 100 * 1024 * 1024, // 100MB for large repos
    });
  }

  private gitBuffer(args: string): Buffer {
    return execSync(`git -C "${this.repoPath}" ${args}`, {
      maxBuffer: 100 * 1024 * 1024,
    });
  }
}
